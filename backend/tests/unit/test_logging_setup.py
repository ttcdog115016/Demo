"""系統日誌設定（app.core.logging_setup）的測試。

驗的是「設定有沒有照說的生效」，不驗各模組記了什麼內容——記錄點會隨功能增減，
綁在測試裡只會讓日後加一行 logger 就得改測試。
"""
import json
import logging

import pytest

from app.core.logging_setup import (
    DEFAULT_LOG_LEVEL,
    ROOT_LOGGER_NAME,
    configure_logging,
)
from app.core.settings import LOG_CONFIG_ENV, LOG_FILE_ENV, LOG_LEVEL_ENV


@pytest.fixture(autouse=True)
def _restore_logging():
    """每個案例跑完把本套件的 logger 還原：dictConfig 改的是全域狀態，
    留著會讓後面的測試（與正式流程）拿到上一個案例掛的 handler。"""
    logger = logging.getLogger(ROOT_LOGGER_NAME)
    saved = (list(logger.handlers), logger.level, logger.propagate)
    yield
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
        handler.close()
    logger.handlers, logger.level, logger.propagate = saved


@pytest.fixture(autouse=True)
def _clear_log_env(monkeypatch):
    """三個環境變數一律由案例自己指定，避免開發機的 .env 影響結果。"""
    for name in (LOG_FILE_ENV, LOG_LEVEL_ENV, LOG_CONFIG_ENV):
        monkeypatch.delenv(name, raising=False)


def _read_lines(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def test_no_log_file_means_no_file_written(tmp_path):
    """未指定落點時只輸出到畫面，不擅自建檔——唯讀環境下建檔會讓服務起不來。"""
    absent = tmp_path / "should_not_exist.jsonl"

    configure_logging()
    logging.getLogger(f"{ROOT_LOGGER_NAME}.demo").warning("僅輸出至畫面")

    assert not absent.exists()
    assert not list(tmp_path.iterdir())


def test_log_file_written_as_json_lines(tmp_path):
    """指定落點後每行都應是可解析的 JSON，欄位齊備。"""
    log_file = tmp_path / "app.jsonl"

    configure_logging(log_file=str(log_file), level="INFO")
    logging.getLogger(f"{ROOT_LOGGER_NAME}.demo").info("處理完成")
    logging.shutdown()

    records = _read_lines(log_file)
    assert len(records) == 1
    assert records[0]["level"] == "INFO"
    assert records[0]["logger"] == f"{ROOT_LOGGER_NAME}.demo"
    assert records[0]["message"] == "處理完成"
    assert records[0]["timestamp"]


def test_parent_directory_created(tmp_path):
    """落點的上層目錄不存在時要先建出來，否則設定當下就會拋錯。"""
    log_file = tmp_path / "nested" / "deeper" / "app.jsonl"

    configure_logging(log_file=str(log_file))
    logging.getLogger(f"{ROOT_LOGGER_NAME}.demo").warning("目錄應已建立")
    logging.shutdown()

    assert log_file.exists()


def test_exception_stack_recorded(tmp_path):
    """未預期例外要留得下堆疊，否則只剩一句錯誤訊息無從追查。"""
    log_file = tmp_path / "app.jsonl"
    configure_logging(log_file=str(log_file))

    try:
        raise ValueError("測試用例外")
    except ValueError:
        logging.getLogger(f"{ROOT_LOGGER_NAME}.demo").error("失敗", exc_info=True)
    logging.shutdown()

    record = _read_lines(log_file)[0]
    assert "ValueError: 測試用例外" in record["exception"]


def test_default_level_hides_info(tmp_path):
    """預設等級為 WARNING：info 不會出現。"""
    log_file = tmp_path / "app.jsonl"
    configure_logging(log_file=str(log_file))

    logger = logging.getLogger(f"{ROOT_LOGGER_NAME}.demo")
    logger.info("不該出現")
    logger.warning("應該出現")
    logging.shutdown()

    records = _read_lines(log_file)
    assert [r["message"] for r in records] == ["應該出現"]


def test_environment_variables_used(tmp_path, monkeypatch):
    """未帶參數時改讀環境變數，讓部署者不必改程式或指令就能調整。"""
    log_file = tmp_path / "from_env.jsonl"
    monkeypatch.setenv(LOG_FILE_ENV, str(log_file))
    monkeypatch.setenv(LOG_LEVEL_ENV, "DEBUG")

    configure_logging()
    logging.getLogger(f"{ROOT_LOGGER_NAME}.demo").debug("來自環境變數的設定")
    logging.shutdown()

    assert _read_lines(log_file)[0]["level"] == "DEBUG"


def test_arguments_override_environment(tmp_path, monkeypatch):
    """指令列給的值蓋過環境變數：操作者當下的明示意圖優先於部署環境的預設。"""
    from_env = tmp_path / "env.jsonl"
    from_arg = tmp_path / "arg.jsonl"
    monkeypatch.setenv(LOG_FILE_ENV, str(from_env))

    configure_logging(log_file=str(from_arg))
    logging.getLogger(f"{ROOT_LOGGER_NAME}.demo").warning("寫到參數指定的檔")
    logging.shutdown()

    assert from_arg.exists()
    assert not from_env.exists()


def test_invalid_level_falls_back_with_warning(tmp_path):
    """等級名稱打錯時退回預設並告知，不讓一個錯字擋下整台服務。"""
    log_file = tmp_path / "app.jsonl"

    with pytest.warns(UserWarning, match="不是有效的等級名稱"):
        configure_logging(log_file=str(log_file), level="VERBOSE")

    assert logging.getLogger(ROOT_LOGGER_NAME).level == logging.getLevelNamesMapping()[
        DEFAULT_LOG_LEVEL
    ]


def test_external_config_replaces_builtin(tmp_path, monkeypatch):
    """部署者自備的設定檔整份取代內建設定——這是「可換成其他格式」的實作方式：
    格式、落點、等級全由那份檔案決定，本套件的程式碼不必改動。"""
    log_file = tmp_path / "plain.log"
    config_file = tmp_path / "logging.json"
    config_file.write_text(
        json.dumps(
            {
                "version": 1,
                "disable_existing_loggers": False,
                "formatters": {"plain": {"format": "%(levelname)s|%(message)s"}},
                "handlers": {
                    "file": {
                        "class": "logging.FileHandler",
                        "formatter": "plain",
                        "filename": str(log_file),
                        "encoding": "utf-8",
                    }
                },
                "loggers": {
                    ROOT_LOGGER_NAME: {
                        "level": "DEBUG",
                        "handlers": ["file"],
                        "propagate": False,
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv(LOG_CONFIG_ENV, str(config_file))

    configure_logging()
    logging.getLogger(f"{ROOT_LOGGER_NAME}.demo").debug("純文字格式")
    logging.shutdown()

    # 輸出已不是 JSON，而是設定檔指定的純文字格式
    assert log_file.read_text(encoding="utf-8").strip() == "DEBUG|純文字格式"


def test_unreadable_external_config_falls_back(tmp_path, monkeypatch):
    """設定檔讀不到時退回內建預設並告知：靜靜換掉會讓部署者以為自己的設定生效了。"""
    monkeypatch.setenv(LOG_CONFIG_ENV, str(tmp_path / "missing.json"))
    log_file = tmp_path / "fallback.jsonl"

    with pytest.warns(UserWarning, match="無法讀取"):
        configure_logging(log_file=str(log_file))

    logging.getLogger(f"{ROOT_LOGGER_NAME}.demo").warning("退回內建設定")
    logging.shutdown()
    assert _read_lines(log_file)[0]["message"] == "退回內建設定"


def test_malformed_external_config_falls_back(tmp_path, monkeypatch):
    """設定檔內容不是一個物件時同樣退回內建預設。"""
    config_file = tmp_path / "logging.json"
    config_file.write_text(json.dumps(["not", "an", "object"]), encoding="utf-8")
    monkeypatch.setenv(LOG_CONFIG_ENV, str(config_file))

    with pytest.warns(UserWarning, match="不是一個物件"):
        configure_logging()
