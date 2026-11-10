"""API - 錯誤回應的狀態碼與形狀。

守兩件事：
  1. 狀態碼依性質區分——格式不收＝415、內容過大＝413、講不通＝422、畸形＝400。
  2. 不論錯誤從哪裡來（引擎、設定檔解析、框架自己），回應主體都是同一種形狀。
"""
import asyncio

import pytest

from app.api.server import app
from app.core.errors import ERROR_HTTP_STATUS

BASE = "/api/v1"


@pytest.fixture(autouse=True)
def env_salt(monkeypatch):
    """鹽值只認 .env；各測試要驗的是別的錯誤，故先把它備妥。"""
    monkeypatch.setenv("OPEN_PETS_DEFAULT_SALT", "test_salt")


def _assert_error_shape(resp):
    """所有錯誤回應共用的形狀檢查：錯誤碼須為已登記的碼，且與狀態碼一致。"""
    body = resp.json()
    assert "error_code" in body, "錯誤回應必須帶 error_code，整合方不該回頭比對字串"
    assert "message" in body and body["message"]
    assert body["error_code"] in ERROR_HTTP_STATUS
    assert ERROR_HTTP_STATUS[body["error_code"]] == resp.status_code
    return body


def _config(payload, filename="config.json"):
    """設定檔上傳三元組；大包一律以 JSON 寫出。"""
    return (filename, payload, "application/json")


def test_unsupported_data_file_format_returns_415(client, kanon_bundle):
    """上傳的資料檔副檔名不在支援清單內＝格式不收，回 415 而非籠統的 400。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.parquet", b"not really a parquet", "application/octet-stream"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 415
    assert _assert_error_shape(resp)["error_code"] == "ERR_UNSUPPORTED_FILE_FORMAT"


def test_no_extension_without_input_format_returns_415(
    client, sample_csv_bytes, kanon_bundle
):
    """上傳檔沒有副檔名又不指定 input_format＝無從判定，回 415 並提示可用參數指定。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("dataset_export", sample_csv_bytes, "application/octet-stream"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 415
    body = _assert_error_shape(resp)
    assert body["error_code"] == "ERR_UNSUPPORTED_FILE_FORMAT"
    assert "副檔名" in body["message"]


def test_input_format_sqlite_returns_415(client, sample_csv_bytes, bundle, kanon_block):
    """上傳的是檔案內容，沒有資料庫連線可用；sqlite 不是上傳檔案的合法格式。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(
                bundle(root={"input_format": "sqlite"}, k_anonymity=kanon_block())
            ),
        },
    )
    assert resp.status_code == 415
    assert _assert_error_shape(resp)["error_code"] == "ERR_UNSUPPORTED_FILE_FORMAT"


def test_unknown_input_format_returns_415(client, sample_csv_bytes, bundle, kanon_block):
    """設定檔指定了清單外的格式一律擋，不退回猜副檔名。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(
                bundle(root={"input_format": "parquet"}, k_anonymity=kanon_block())
            ),
        },
    )
    assert resp.status_code == 415
    assert _assert_error_shape(resp)["error_code"] == "ERR_UNSUPPORTED_FILE_FORMAT"


def test_unsupported_config_format_returns_415(client, sample_csv_bytes, kanon_bundle):
    """設定檔非 YAML／JSON 同屬格式不收，與資料檔走同一種判斷。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": ("config.txt", kanon_bundle, "text/plain"),
        },
    )
    assert resp.status_code == 415
    assert _assert_error_shape(resp)["error_code"] == "ERR_UNSUPPORTED_CONFIG_FORMAT"


def test_malformed_config_returns_400(client, sample_csv_bytes):
    """設定檔語法壞掉＝我讀不懂你送來的東西，這才是 400 該留的情境。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": ("config.yaml", b"k_anonymity: [unclosed\n  bad: :", "application/octet-stream"),
        },
    )
    assert resp.status_code == 400
    assert _assert_error_shape(resp)["error_code"] == "ERR_CONFIG_MALFORMED"


def test_duplicate_config_key_returns_400(client, sample_csv_bytes):
    """設定檔重複鍵：文件本身結構就不對，屬 400（且不靜默採用後者）。"""
    dup = b"""k_anonymity:
  enabled: true
  columns:
    A:
      role: quasi_identifier
      type: numeric
    A:
      role: sensitive
      type: numeric
"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": ("config.yaml", dup, "application/octet-stream"),
        },
    )
    assert resp.status_code == 400
    assert _assert_error_shape(resp)["error_code"] == "ERR_CONFIG_MALFORMED"


def test_config_content_invalid_returns_422(client, sample_csv_bytes, bundle):
    """設定檔語法沒問題、但 role 寫了不存在的值＝讀得懂但講不通，回 422。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(
                bundle(
                    k_anonymity={
                        "columns": {"年齡": {"role": "not_a_role", "type": "numeric"}}
                    }
                )
            ),
        },
    )
    assert resp.status_code == 422
    assert _assert_error_shape(resp)["error_code"] == "ERR_CONFIG_INVALID"


def test_unknown_config_field_returns_422(client, sample_csv_bytes, bundle, kanon_block):
    """不認識的欄位一律擋：打錯字被靜默吞掉的話，使用者會以為自己設過了。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(bundle(k_anonymity=kanon_block(kk=5))),
        },
    )
    assert resp.status_code == 422
    body = _assert_error_shape(resp)
    assert body["error_code"] == "ERR_CONFIG_INVALID"
    assert "kk" in body["message"]


def test_payload_too_large_returns_413(client, monkeypatch, kanon_bundle):
    """超過部署方設定的上傳上限＝講得清楚的拒絕（413），而不是整包讀完後才中斷。"""
    monkeypatch.setenv("OPEN_PETS_MAX_UPLOAD_MB", "1")
    oversized = ("A,B\n" + "1,2\n" * 400_000).encode("utf-8")  # 約 2 MB，超過上限
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", oversized, "text/csv"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 413
    assert _assert_error_shape(resp)["error_code"] == "ERR_PAYLOAD_TOO_LARGE"


def test_payload_too_large_without_content_length(client, monkeypatch):
    """未申報 Content-Length（分塊傳輸）同樣要擋——上限不能只靠對方填的數字。"""
    monkeypatch.setenv("OPEN_PETS_MAX_UPLOAD_MB", "1")
    boundary = "----pets-test"

    def body_chunks():
        yield (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; filename="data.csv"\r\n'
            "Content-Type: text/csv\r\n\r\n"
        ).encode()
        for _ in range(8):
            yield b"z" * (512 * 1024)  # 共 4 MB，超過 1 MB 上限
        yield f"\r\n--{boundary}--\r\n".encode()

    resp = client.post(
        f"{BASE}/k-anonymity",
        content=body_chunks(),
        headers={"content-type": f"multipart/form-data; boundary={boundary}"},
    )
    assert resp.status_code == 413
    assert _assert_error_shape(resp)["error_code"] == "ERR_PAYLOAD_TOO_LARGE"


def test_upload_limit_stops_reading_once_exceeded(monkeypatch):
    """超量必須邊收邊停：整包收完才判斷的話，記憶體早已被佔滿，限制形同虛設。

    測試客戶端會先把請求主體整包備妥再送出，看不出中途停在哪裡，
    故此處直接以 ASGI 介面驅動，數服務實際向下游拿了幾塊。
    """
    monkeypatch.setenv("OPEN_PETS_MAX_UPLOAD_MB", "1")
    boundary = "----pets-test"
    preamble = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="data.csv"\r\n'
        "Content-Type: text/csv\r\n\r\n"
    ).encode()
    chunk = b"z" * (256 * 1024)
    chunks_available = 200  # 全部收完＝50 MB
    pulled = 0

    async def receive():
        """先送出合法的多重表單開頭，之後源源不絕地送內容，數對方拿了幾塊。"""
        nonlocal pulled
        pulled += 1
        if pulled == 1:
            return {"type": "http.request", "body": preamble, "more_body": True}
        if pulled <= chunks_available:
            return {"type": "http.request", "body": chunk, "more_body": True}
        return {"type": "http.request", "body": b"", "more_body": False}

    sent = []

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": f"{BASE}/k-anonymity",
        "raw_path": f"{BASE}/k-anonymity".encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"testserver"),
            (
                b"content-type",
                f"multipart/form-data; boundary={boundary}".encode(),
            ),
        ],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }
    asyncio.run(app(scope, receive, send))

    start = next(m for m in sent if m["type"] == "http.response.start")
    assert start["status"] == 413
    assert pulled * len(chunk) < 4 * 1024 * 1024, "收到的位元組數應停在上限附近，而非整包收完"


def test_upload_limit_falls_back_when_env_unreadable(
    client, monkeypatch, sample_csv_bytes, kanon_bundle
):
    """環境變數打錯字不該擋下整台服務：回退內建預設，正常請求照過。"""
    monkeypatch.setenv("OPEN_PETS_MAX_UPLOAD_MB", "一千")
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 200


def test_upload_limit_can_be_disabled(client, monkeypatch, sample_csv_bytes, kanon_bundle):
    """上限設 0＝部署方明確要求不設限，此時不得攔截。"""
    monkeypatch.setenv("OPEN_PETS_MAX_UPLOAD_MB", "0")
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 200


def test_auth_failure_uses_same_error_shape(client, api_auth):
    """驗證失敗的 401 也是同一種主體，整合方不必為驗證錯誤另寫一套解析。"""
    resp = client.post(f"{BASE}/auth/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401
    assert _assert_error_shape(resp)["error_code"] == "ERR_UNAUTHORIZED"


def test_missing_required_field_uses_same_error_shape(client, sample_csv_bytes):
    """缺必填欄位由框架擋下（422），主體同樣收斂成 error_code／message。

    以缺設定檔為例：資料集欄位為「上傳或連線字串二擇一」皆為選填，缺漏由
    端點自行擋成 400（見 test_api_dataset_source），框架層的必填只剩 config。
    """
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={"file": ("data.csv", sample_csv_bytes, "text/csv")},
    )
    assert resp.status_code == 422
    assert _assert_error_shape(resp)["error_code"] == "ERR_VALIDATION_FAILED"


@pytest.mark.parametrize(
    "url, payload",
    [
        (f"{BASE}/report", {"task_id": "t"}),
    ],
)
def test_report_requires_at_least_one_report(client, url, payload):
    """兩包報告都沒帶＝請求本身不成立，回 400 並帶錯誤碼。"""
    resp = client.post(url, json=payload)
    assert resp.status_code == 400
    _assert_error_shape(resp)
