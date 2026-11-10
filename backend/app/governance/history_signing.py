"""處理紀錄的伺服器簽章（★ TTC 2026-10-29）。

前端原本以各自瀏覽器產生的金鑰簽章，公鑰隨紀錄保存——改得到資料庫的人可以連內容帶公鑰一起換掉，
簽章驗得過卻證明不了什麼。改為伺服器簽：金鑰只存在伺服器，紀錄一經改動（含操作者、結果數字）即驗不過。

演算法 HMAC-SHA256；金鑰由 .env 既有的 OPEN_PETS_SYSTEM_MASTER_KEY 衍生（與審計日誌同一把主金鑰，
以固定標籤衍生出用途專屬的子金鑰，兩邊的簽章不會互通）。未設定主金鑰時照常保存紀錄，但不簽章並註明原因。

簽署文件＝紀錄內容（去掉 integrity）＋輸入檔／輸出檔 SHA-256（由前端計算，伺服器不保留檔案）＋簽署時間＋金鑰 ID，
以鍵值排序的 JSON 序列化，同一份內容永遠得到同一串文字。
"""

import hashlib
import hmac
import json
from datetime import UTC, datetime
from typing import Any

from app.core.settings import get_system_master_key

ALGORITHM = "HMAC-SHA256"
INTEGRITY_VERSION = 2
_KEY_LABEL = b"open-pets/history-signing/v1"


def _signing_key() -> bytes | None:
    master = get_system_master_key()
    if not master:
        return None
    return hmac.new(master.encode("utf-8"), _KEY_LABEL, hashlib.sha256).digest()


def _key_id(key: bytes) -> str:
    return hashlib.sha256(key).hexdigest()[:16]


def _canonical(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _document(record: dict, integrity: dict) -> bytes:
    body = {key: value for key, value in record.items() if key != "integrity"}
    return _canonical({
        "record": body,
        "inputFileSha256": integrity.get("inputFileSha256"),
        "outputFileSha256": integrity.get("outputFileSha256"),
        "signedAt": integrity.get("signedAt"),
        "keyId": integrity.get("keyId"),
    })


def sign_record(record: dict) -> dict:
    """回傳 record 的 integrity 欄位內容；檔案指紋沿用前端送來的值。"""
    client_integrity = record.get("integrity") if isinstance(record.get("integrity"), dict) else {}
    key = _signing_key()
    integrity: dict[str, Any] = {
        "version": INTEGRITY_VERSION,
        "algorithm": ALGORITHM,
        "signedAt": datetime.now(UTC).isoformat(),
        "inputFileSha256": client_integrity.get("inputFileSha256"),
        "outputFileSha256": client_integrity.get("outputFileSha256"),
        "keyId": _key_id(key) if key else None,
    }
    document = _document(record, integrity)
    integrity["documentSha256"] = hashlib.sha256(document).hexdigest()
    if key:
        integrity["signature"] = hmac.new(key, document, hashlib.sha256).hexdigest()
    else:
        integrity["signature"] = None
        integrity["unsignedReason"] = "server_key_missing"
    return integrity


def verify_record(record: dict) -> dict:
    """重算比對。status：valid／tampered／unsigned／missing。"""
    integrity = record.get("integrity")
    if not isinstance(integrity, dict) or integrity.get("version") != INTEGRITY_VERSION:
        return {"status": "missing", "fingerprintMatches": None, "signatureValid": None}

    document = _document(record, integrity)
    fingerprint_matches = hashlib.sha256(document).hexdigest() == integrity.get("documentSha256")
    signature = integrity.get("signature")
    if not signature:
        return {
            "status": "unsigned" if fingerprint_matches else "tampered",
            "fingerprintMatches": fingerprint_matches,
            "signatureValid": None,
        }

    key = _signing_key()
    if key is None or _key_id(key) != integrity.get("keyId"):
        # 伺服器金鑰已更換或未設定：無法驗證簽章，只能回報指紋
        return {"status": "unverifiable", "fingerprintMatches": fingerprint_matches, "signatureValid": None}

    signature_valid = hmac.compare_digest(hmac.new(key, document, hashlib.sha256).hexdigest(), str(signature))
    return {
        "status": "valid" if fingerprint_matches and signature_valid else "tampered",
        "fingerprintMatches": fingerprint_matches,
        "signatureValid": signature_valid,
    }
