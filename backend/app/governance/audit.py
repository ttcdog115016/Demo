import os
import json
import hmac
import hashlib
import logging
import threading
import warnings
from contextlib import contextmanager
from datetime import datetime, UTC
from typing import Any, NamedTuple
from collections.abc import Iterator

from app.core.errors import PetsError
from app.core.settings import get_data_dir, get_system_master_key

# ★此 logger 記的是「這支程式跑得如何」（金鑰未設定、日誌檔毀損、未預期例外），
# 不是稽核事件本身。稽核事件一律走 log_operation 直接寫入 audit.jsonl，
# 不經過 logging——稽核不可遺失、不可被日誌等級或外部設定關掉。
logger = logging.getLogger(__name__)

# ★ TTC 2026-11-02：同一行程內所有 AuditLogger 共用一把鎖（各端點各自建立實例，鎖不能掛在實例上）
_WRITE_LOCK = threading.Lock()


class AuditVerification(NamedTuple):
    """審計日誌的校驗結果。

    問題與說明分成兩欄：`problems` 是使結論不通過的事由（鏈結斷裂、簽章不符、
    無法驗證），`notes` 是不影響結論、但閱讀者需要知道的事實（如日誌尚無紀錄）。
    兩者共用一欄時，通過的結論仍會附帶一則訊息，讀者無從分辨那是不是錯誤。
    """

    is_valid: bool
    problems: list[str]
    notes: list[str]


def _resolve_master_key() -> str | None:
    """解析審計 HMAC 主金鑰；未設定時回傳 None 並告知，不以任何寫死字串頂替。

    寫死於原始碼的金鑰等同公開（本專案開源），任何人都能重算簽章補簽，防篡改
    形同虛設卻看似正常運作。故未設定時一律不簽章（見 log_operation），日誌照記。
    """
    key = get_system_master_key()
    if key:
        return key
    # 報告透明：系統替使用者做的決定（本次不簽章）須告知。
    # warnings 預設同一位置只顯示一次，不會逐筆洗版。
    message = (
        "未設定環境變數 OPEN_PETS_SYSTEM_MASTER_KEY，審計日誌僅記錄不簽章，"
        "無防篡改保護。請部署者於 .env 設定該金鑰以啟用。"
    )
    # 防篡改保護未啟用是驗收時查得到的事實，須留檔而不只是印在畫面上。
    logger.warning(message)
    warnings.warn(message, stacklevel=2)
    return None


class AuditLogger:
    """鏈式防篡改審計日誌管理器"""

    def __init__(self, log_path: str | None = None):
        if log_path is None:
            # 日誌屬部署環境的資料，落在部署者指定的資料目錄，不寫進套件安裝目錄
            self.log_path = os.path.join(get_data_dir(), "audit.jsonl")
        else:
            self.log_path = log_path

        parent_dir = os.path.dirname(os.path.abspath(self.log_path))
        os.makedirs(parent_dir, exist_ok=True)

    def _read_last_line(self) -> str:
        """★ TTC 2026-11-02：由檔尾往前讀到最後一行為止，不再每寫一筆就把整個日誌讀進記憶體。"""
        with open(self.log_path, "rb") as f:
            f.seek(0, os.SEEK_END)
            pos = f.tell()
            block = 8192
            data = b""
            while pos > 0:
                step = min(block, pos)
                pos -= step
                f.seek(pos)
                data = f.read(step) + data
                stripped = data.rstrip(b"\r\n")
                if b"\n" in stripped:
                    return stripped.rsplit(b"\n", 1)[1].decode("utf-8")
                block *= 2
            return data.rstrip(b"\r\n").decode("utf-8")

    def _get_last_hash(self) -> str:
        """讀取最後一行日誌的雜湊值，若無則回傳初始雜湊值"""
        if not os.path.exists(self.log_path) or os.path.getsize(self.log_path) == 0:
            return "0" * 64

        last_text = self._read_last_line().strip()
        if not last_text:
            return "0" * 64
        try:
            last_line = json.loads(last_text)
            return last_line.get("hash", "0" * 64)
        except json.JSONDecodeError as exc:
            # 末行讀不出來就無鏈可接，只能由零重新起鏈（比照未簽章行的處理）。
            # 不中斷寫入——稽核日誌壞一行不該讓整個系統停擺——但必須告知：
            # 靜靜重新起鏈的話，這段斷裂要等有人主動跑 verify-log 才會被發現。
            message = (
                f"審計日誌 {self.log_path} 的最後一行無法解析（{exc}），"
                "雜湊鏈將由零重新起算，該處會在校驗時被報為鏈結斷裂。"
            )
            logger.warning(message)
            warnings.warn(message, stacklevel=2)
            return "0" * 64

    def _calculate_hash(self, content_str: str, last_hash: str, key: str) -> str:
        """計算 HMAC-SHA256 鏈式雜湊"""
        message = (content_str + last_hash).encode("utf-8")
        return hmac.new(key.encode("utf-8"), message, hashlib.sha256).hexdigest()

    def log_operation(
        self,
        operation: str,
        status: str,
        params: dict[str, Any],
        user: str | None = None,
    ) -> str:
        """記錄操作日誌並更新雜湊鏈。

        操作者（user）只在真的驗證過身分時才寫入，且由呼叫端傳入：
        會員系統的端點都要求登入，操作者是查證過的，故一律記；三大功能的端點不掛
        身分驗證，沒有可信的名字可寫，一律不記——寫個佔位字串會讓稽核人員誤以為
        那個名字經過查證。同一本日誌因此並存兩種形狀，這是事實，不是缺漏。

        欄位有無不影響驗證：核心內容依實際欄位重算，兩種形狀都驗得過
        （見 verify_audit_log）。
        """
        timestamp = datetime.now(UTC).isoformat()

        # 準備日誌核心內容
        log_entry = {
            "timestamp": timestamp,
            "operation": operation,
            "status": status,
            "parameters": params,
        }
        if user is not None:
            log_entry["user"] = user

        key = _resolve_master_key()
        if key is None:
            # 未設定金鑰：照常留痕，但不寫入簽章欄位——沒有金鑰就沒有防篡改，
            # 不以任何寫死字串頂替、不產生「看似驗得過」的假保護。
            with _WRITE_LOCK, open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")
            return ""

        content_str = json.dumps(log_entry, sort_keys=True, ensure_ascii=False)
        # ★ TTC 2026-11-02：「讀上一筆雜湊→計算→追加」須整段互斥。登入、帳號管理等同步端點在
        #   執行緒池並行，兩筆同時讀到同一個上一筆雜湊會寫出兩行同父的紀錄，校驗時被報為鏈結斷裂。
        with _WRITE_LOCK:
            last_hash = self._get_last_hash()
            current_hash = self._calculate_hash(content_str, last_hash, key)

            # 將雜湊值與前一行雜湊一併記入
            log_entry["last_hash"] = last_hash
            log_entry["hash"] = current_hash

            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")

        return current_hash

    @contextmanager
    def failures(self, operation: str) -> Iterator[None]:
        """把區塊內的失敗記進審計軌跡，再把例外原樣拋出交給上層處理。

        此處只負責「留痕」，狀態碼交給 API 的例外處理器、離開代碼交給 CLI 的收尾函式。

        可預期錯誤（帶錯誤碼）記為 blocked——是系統照規則擋下來的；
        其餘未預期錯誤記為 failed，兩者在稽核時意義不同，不混為一談。
        """
        try:
            yield
        except PetsError as exc:
            self.log_operation(
                operation,
                "blocked",
                {"error_code": exc.error_code, "reason": exc.message},
            )
            raise
        except Exception as exc:
            # 稽核只留得下一句 str(exc)，追不出是哪一行出的事；堆疊寫進系統日誌備查。
            logger.error("操作 %s 遇到未預期的錯誤", operation, exc_info=True)
            self.log_operation(operation, "failed", {"error": str(exc)})
            raise

    def verify_audit_log(self) -> AuditVerification:
        """
        校驗審計日誌是否遭到任何篡改、刪除或插入。
        回傳是否「完整驗證且全數通過」、不通過的事由，以及不影響結論的說明。

        只有在每一行都驗過且都對得上時才回傳 True。有任何一行無法驗證時一併回傳
        False——無法驗證與確認無誤是兩件事，兩者都回 True 會讓呼叫端把「沒驗成」
        當成「驗過了」。實際情形一律寫在訊息裡，由閱讀者判讀。

        未簽章的行分兩種情形處理：目前沒有金鑰時，本來就無從驗起，如實說明即可；
        但目前設有金鑰卻讀到未簽章的行，則列為疑慮——該行可能寫於設定金鑰之前，
        也可能是事後插入而無法補簽的偽造紀錄，日誌本身分辨不出，不能逕自視為無虞。
        簽章亦可能因金鑰更換而對不上，故訊息不逕自斷言為非法篡改。
        """
        if not os.path.exists(self.log_path) or os.path.getsize(self.log_path) == 0:
            # 沒有紀錄可驗不是錯誤，但也不能不說：日誌本該存在卻是空的，
            # 這件事要讓閱讀者看見，故記為說明而非事由。
            return AuditVerification(True, [], ["日誌為空或不存在，沒有紀錄可校驗。"])

        errors = []
        concerns = []
        unverifiable = 0
        master_key = get_system_master_key()
        expected_last_hash = "0" * 64

        with open(self.log_path, encoding="utf-8") as f:
            for idx, line in enumerate(f):
                line_str = line.strip()
                if not line_str:
                    continue
                try:
                    log_entry = json.loads(line_str)

                    # 0. 無簽章可對或無金鑰可驗：不進鏈式檢查，僅計數說明。
                    # 未簽章行不參與鏈結，其後續行由零重新起鏈（比照寫入端）。
                    if "hash" not in log_entry:
                        if master_key is None:
                            unverifiable += 1
                        else:
                            concerns.append(
                                f"第 {idx + 1} 行沒有簽章，但目前設有金鑰。"
                                f"該行可能寫於設定金鑰之前，也可能是事後插入的紀錄，"
                                f"僅憑日誌無法分辨，請另行佐證。"
                            )
                        expected_last_hash = "0" * 64
                        continue
                    if master_key is None:
                        unverifiable += 1
                        expected_last_hash = log_entry.get("hash")
                        continue

                    # 1. 驗證 last_hash 鏈條是否斷裂
                    if log_entry.get("last_hash") != expected_last_hash:
                        errors.append(
                            f"第 {idx + 1} 行發現雜湊鏈斷裂！預期 last_hash: {expected_last_hash[:10]}... 實際: {log_entry.get('last_hash')[:10]}..."
                        )

                    # 2. 重新計算當前行內容的 hash
                    # 核心內容＝該行「除了鏈結欄位以外的所有欄位」，不寫死欄位清單：
                    # 各行欄位不盡相同（有無 user），寫死會使欄位不同的行重算失敗、
                    # 被誤報為遭竄改。依實際欄位重算則各行皆可驗證。
                    core_entry = {
                        key: value
                        for key, value in log_entry.items()
                        if key not in ("last_hash", "hash")
                    }
                    content_str = json.dumps(
                        core_entry, sort_keys=True, ensure_ascii=False
                    )
                    recalculated_hash = self._calculate_hash(
                        content_str, log_entry["last_hash"], master_key
                    )

                    # 3. 驗證簽章是否相符
                    if log_entry.get("hash") != recalculated_hash:
                        errors.append(
                            f"第 {idx + 1} 行簽章不符（內容遭變動，或簽章當時使用的金鑰與目前不同）。"
                        )

                    # 更新下一行的 pre-hash
                    expected_last_hash = log_entry.get("hash")
                except Exception as e:
                    errors.append(
                        f"第 {idx + 1} 行解析失敗，格式可能已損壞。({str(e)})"
                    )

        problems = errors + concerns
        if unverifiable:
            problems.append(
                f"{unverifiable} 行無法驗證："
                f"目前未設定 OPEN_PETS_SYSTEM_MASTER_KEY，沒有金鑰可對簽章，"
                f"本次校驗無法確認這些紀錄的完整性。"
            )

        return AuditVerification(not problems, problems, [])


_audit_logger: AuditLogger | None = None


def get_audit_logger() -> AuditLogger:
    """回傳全專案共用的稽核日誌管理器；第一次呼叫時才建立。

    由治理層統一建立，API 各路由與 CLI 共用同一個實例。

    ★刻意採延後建立（不在模組載入時就建）：__init__ 會呼叫 get_data_dir() 並建出
    資料目錄，寫在模組層等於 import 就有副作用——連 `--help` 都會生出目錄，且該次
    告知發生在入口呼叫 configure_logging 之前，寫不進系統日誌。第一次真正要留痕
    時才建，兩者都不會發生。
    """
    global _audit_logger
    if _audit_logger is None:
        _audit_logger = AuditLogger()
    return _audit_logger
