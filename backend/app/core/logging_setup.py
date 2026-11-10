"""系統日誌（application log）的設定入口。

與稽核軌跡（governance/audit.py）是兩件不同的事，刻意不混在一起：
稽核記的是「誰做了什麼」、不可遺失、不可關閉、有鏈式簽章；系統日誌記的是
「程式跑的時候發生什麼」，容許依部署需要調整等級與落點。故兩者各走各的路，
本模組完全不碰 audit.jsonl。

分層的方式是 Python logging 的通用寫法，模組與入口的責任切開：

    模組層   logger = logging.getLogger(__name__)   只負責講話，不知道輸出到哪
    入口層   configure_logging(...)                 只在啟動時呼叫一次，決定落點與格式

未呼叫 configure_logging 時（例如本套件被當函式庫 import），不加任何 handler，
訊息交由呼叫方的設定處理，不擅自寫檔、也不污染呼叫方的根 logger。
"""
import json
import logging
import logging.config
import os
import warnings
from datetime import datetime, UTC
from typing import Any

from app.core.settings import (
    LOG_CONFIG_ENV,
    LOG_FILE_ENV,
    LOG_LEVEL_ENV,
)

# 本套件的頂層 logger 名。取套件名 app，模組層寫 getLogger(__name__) 得到的
# 「app.engines.preprocess...」等名稱即自動歸屬於此，模組不必記住任何特殊字串。
ROOT_LOGGER_NAME = "app"

# 預設等級：WARNING。logger.info() 在此等級下不會顯示。
DEFAULT_LOG_LEVEL = "WARNING"

# 輪替參數固定，避免長跑的服務把磁碟寫滿；需要別的值可用外部設定檔整份覆寫。
_MAX_BYTES = 10 * 1024 * 1024
_BACKUP_COUNT = 5


class JsonLineFormatter(logging.Formatter):
    """把一筆日誌壓成一行 JSON，產出即 .jsonl。

    自己寫而不引入 python-json-logger：本案要離線地端部署，每多一個相依就多一份
    要隨附授權、要進離線套件包、要跟著掃描的東西，而這裡需要的只有下面十行。
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            # 未預期例外要能查到堆疊，否則只剩一句 str(exc) 無從追起
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _build_config(log_file: str | None, level: str) -> dict[str, Any]:
    """組出內建的 dictConfig；外部未提供設定檔時用這一份。"""
    handlers: dict[str, dict[str, Any]] = {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
            "stream": "ext://sys.stderr",
        }
    }
    if log_file:
        handlers["file"] = {
            "class": "logging.handlers.RotatingFileHandler",
            "formatter": "json",
            "filename": log_file,
            "maxBytes": _MAX_BYTES,
            "backupCount": _BACKUP_COUNT,
            "encoding": "utf-8",
        }

    return {
        "version": 1,
        # 不停用既有 logger：uvicorn 在我們之前就建好了它自己的 logger，
        # 設為 True 會把那些 logger 一併關掉，服務的存取紀錄跟著消失。
        "disable_existing_loggers": False,
        "formatters": {
            "json": {"()": f"{__name__}.JsonLineFormatter"},
        },
        "handlers": handlers,
        "loggers": {
            ROOT_LOGGER_NAME: {
                "level": level,
                "handlers": list(handlers),
                # 只掛在自己的頂層 logger 上，不接到 Python 的 root：
                # 接上去會把第三方套件的訊息一起吸進我方日誌檔。
                "propagate": False,
            }
        },
    }


def _load_external_config(path: str) -> dict[str, Any] | None:
    """讀取部署者指定的 logging 設定檔（JSON）；讀不出來時回傳 None 並告知。

    比照 settings.get_max_upload_bytes 的作法：一個打錯的環境變數不該擋下整台服務，
    退回內建預設即可，但必須出聲——靜靜換掉會讓部署者以為自己的設定生效了。
    """
    try:
        with open(path, encoding="utf-8") as f:
            loaded = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        warnings.warn(
            f"環境變數 {LOG_CONFIG_ENV} 指向的日誌設定檔 {path} 無法讀取"
            f"（{type(exc).__name__}: {exc}），已改用內建預設設定。",
            stacklevel=3,
        )
        return None

    if not isinstance(loaded, dict):
        warnings.warn(
            f"環境變數 {LOG_CONFIG_ENV} 指向的日誌設定檔 {path} 內容不是一個物件，"
            "無法作為 logging 設定，已改用內建預設設定。",
            stacklevel=3,
        )
        return None
    return loaded


def configure_logging(
    log_file: str | None = None,
    level: str | None = None,
) -> None:
    """設定本套件的系統日誌；由 API 與 CLI 的入口各呼叫一次。

    取值順序為「呼叫參數 > 環境變數 > 內建預設」——指令列選項是操作者當下的
    明示意圖，應蓋過部署環境的設定。

    部署者若以 OPEN_PETS_LOG_CONFIG 指定一份 logging 設定檔（JSON），則整份取代
    內建設定：格式（JSON 或純文字）、輸出位置（畫面、檔案、syslog）、各模組的
    等級都能自行決定，不必改動本套件的程式碼。此時 log_file 與 level 不再適用，
    因為那份設定檔自己就講完了這兩件事。
    """
    external_path = os.getenv(LOG_CONFIG_ENV)
    if external_path and external_path.strip():
        external = _load_external_config(external_path.strip())
        if external is not None:
            logging.config.dictConfig(external)
            return

    resolved_file = log_file or os.getenv(LOG_FILE_ENV) or None
    resolved_level = (level or os.getenv(LOG_LEVEL_ENV) or DEFAULT_LOG_LEVEL).upper()
    if resolved_level not in logging.getLevelNamesMapping():
        warnings.warn(
            f"日誌等級 {resolved_level!r} 不是有效的等級名稱，"
            f"已改用預設等級 {DEFAULT_LOG_LEVEL}。",
            stacklevel=2,
        )
        resolved_level = DEFAULT_LOG_LEVEL

    if resolved_file:
        # 日誌檔的目錄不存在時 RotatingFileHandler 會在設定當下就拋錯，
        # 比照 AuditLogger 先把上層目錄建出來。
        parent = os.path.dirname(os.path.abspath(resolved_file))
        os.makedirs(parent, exist_ok=True)

    logging.config.dictConfig(_build_config(resolved_file, resolved_level))
