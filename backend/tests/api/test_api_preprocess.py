"""
API - 資料前處理 整合測試
涵蓋：
  - 上傳資料集：清單由上往下處理，回傳處理後的資料（沿用輸入格式）
  - 以連線字串指定 SQLite 來源（與上傳二擇一，規則與其他端點共用）
  - 沒有報告標頭：前處理只改資料、不產統計
  - 四類錯誤各自的錯誤碼與狀態碼，且與 CLI 講同一句話

設定檔與其他端點同一種大包，本端點只用 preprocess 區塊。
"""
import io
import json

import pandas as pd

BASE = "/api/v1"


def _config(block: dict, name: str = "config.json"):
    """把區塊內容包成一份只開 preprocess 的大包設定檔上傳三元組。"""
    payload = {"preprocess": {"enabled": True, **block}}
    return (name, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json")


def _upload(csv_bytes: bytes, name: str = "data.csv"):
    return (name, csv_bytes, "text/csv")


def _post(client, config_payload, **kwargs):
    return client.post(
        f"{BASE}/preprocess", files={"config": _config(config_payload), **kwargs.pop("files", {})}, **kwargs
    )


TRIM_THEN_SLICE = {
    "columns": [
        {
            "column": "地區",
            "actions": [
                {"action": "trim", "params": {"mode": "all"}},
                {"action": "slice", "params": {"side": "right", "count": 1}},
            ],
        },
        {"column": "薪資", "actions": [{"action": "clamp", "params": {"max": 90000}}]},
    ]
}


def test_upload_runs_actions_in_listed_order(client, sample_csv_bytes):
    """同一欄位排兩個動作，照清單順序做完後回傳處理後的資料。"""
    resp = _post(client, TRIM_THEN_SLICE, files={"file": _upload(sample_csv_bytes)})

    assert resp.status_code == 200, resp.text
    assert resp.headers.get("content-type", "").startswith("text/csv")
    assert "preprocessed_data.csv" in resp.headers["Content-Disposition"]

    df_out = pd.read_csv(io.BytesIO(resp.content))
    # 地區「大安區」去空白後刪去右邊 1 個字元 → 大安
    assert set(df_out["地區"]) == {"大安", "中正", "板橋", "信義", "松山", "南港"}
    assert df_out["薪資"].max() == 90000


def test_no_report_header(client, sample_csv_bytes):
    """前處理不產統計，故沒有 K-匿名／DP 那兩個報告標頭。"""
    resp = _post(client, TRIM_THEN_SLICE, files={"file": _upload(sample_csv_bytes)})

    assert resp.status_code == 200, resp.text
    assert "X-Quality-Report" not in resp.headers
    assert "X-Budget-Report" not in resp.headers


def test_accepts_sqlite_source(client, sqlite_source):
    """以連線字串指定來源：正常處理，輸出退回 CSV、檔名以資料表名充當。"""
    resp = client.post(
        f"{BASE}/preprocess",
        files={"config": _config(TRIM_THEN_SLICE)},
        data={"source": sqlite_source.url, "table": sqlite_source.table},
    )

    assert resp.status_code == 200, resp.text
    assert "preprocessed_patients.csv" in resp.headers["Content-Disposition"]
    assert pd.read_csv(io.BytesIO(resp.content))["薪資"].max() == 90000


def test_neither_upload_nor_source_rejected(client):
    """兩種來源都不給＝沒有資料可處理，與其他端點同一則訊息。"""
    resp = _post(client, TRIM_THEN_SLICE)

    assert resp.status_code == 400, resp.text
    assert resp.json()["error_code"] == "ERR_INVALID_PARAM"


def test_column_not_found_returns_unprocessable(client, sample_csv_bytes):
    """欄位名稱打錯＝設定檔對不上資料（422），且在動到資料之前擋下。"""
    cfg = {
        "columns": [
            {"column": "住址", "actions": [{"action": "trim", "params": {"mode": "all"}}]}
        ]
    }
    resp = _post(client, cfg, files={"file": _upload(sample_csv_bytes)})

    assert resp.status_code == 422, resp.text
    assert resp.json()["error_code"] == "ERR_PREPROCESS_COLUMN_NOT_FOUND"


def test_unknown_action_returns_bad_request(client, sample_csv_bytes):
    """功能名稱不認得＝請求本身不成立（400），訊息列出可用的功能。"""
    cfg = {"columns": [{"column": "地區", "actions": [{"action": "remove_digits"}]}]}
    resp = _post(client, cfg, files={"file": _upload(sample_csv_bytes)})

    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert body["error_code"] == "ERR_PREPROCESS_ACTION_UNKNOWN"
    assert "trim" in body["message"]


def test_invalid_param_returns_bad_request(client, sample_csv_bytes):
    """參數跑完等於沒跑（clamp 上下界都不給）＝設定寫錯（400）。"""
    cfg = {"columns": [{"column": "薪資", "actions": [{"action": "clamp", "params": {}}]}]}
    resp = _post(client, cfg, files={"file": _upload(sample_csv_bytes)})

    assert resp.status_code == 400, resp.text
    assert resp.json()["error_code"] == "ERR_PREPROCESS_PARAM_INVALID"


def test_type_mismatch_returns_unprocessable(client, sample_csv_bytes):
    """對字串欄用平均值填補＝用錯功能（422）。"""
    cfg = {
        "columns": [
            {"column": "職業", "actions": [{"action": "impute", "params": {"strategy": "mean"}}]}
        ]
    }
    resp = _post(client, cfg, files={"file": _upload(sample_csv_bytes)})

    assert resp.status_code == 422, resp.text
    assert resp.json()["error_code"] == "ERR_PREPROCESS_TYPE_MISMATCH"


def test_config_without_preprocess_block_is_blocked(
    client, sample_csv_bytes, kanon_bundle
):
    """開的是別的區塊＝拿錯設定檔，擋下並指名缺哪一塊。"""
    resp = client.post(
        f"{BASE}/preprocess",
        files={
            "file": _upload(sample_csv_bytes),
            "config": ("bundle.json", kanon_bundle, "application/json"),
        },
    )

    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["error_code"] == "ERR_CONFIG_BLOCK_REQUIRED"
    assert "preprocess" in body["message"]


def test_extra_enabled_block_is_ignored(client, sample_csv_bytes, bundle, kanon_block):
    """同一份設定檔可放多種處理的區塊：本端點只取 preprocess，其餘開著也照跑。"""
    payload = bundle(preprocess=TRIM_THEN_SLICE, k_anonymity=kanon_block())
    resp = client.post(
        f"{BASE}/preprocess",
        files={
            "file": _upload(sample_csv_bytes),
            "config": ("bundle.json", payload, "application/json"),
        },
    )

    assert resp.status_code == 200, resp.text
