"""
API - 差分隱私端點 整合測試
涵蓋：POST /api/v1/dp 正常加噪、預算報告、欄位名稱不吻合、缺少設定檔、格式不支援

進出方式與 /k-anonymity 一致：上傳資料集 + 大包設定檔，逐欄預算與全域參數
同在設定檔的 differential_privacy 區塊內。
"""
import json
from urllib.parse import quote

import pytest

from app.governance.audit import AuditLogger


BUDGETS_WITHIN_LIMIT = {
    "column_budgets": {
        "年齡": {
            "type": "continuous",
            "epsilon_budget": 0.5,
            "delta_budget": 0.0,
            "sensitivity": 30.0,
        },
        "薪資": {
            "type": "continuous",
            "epsilon_budget": 0.5,
            "delta_budget": 0.0,
            "sensitivity": 100000.0,
        },
    }
}

BUDGETS_WRONG_COL = {
    "column_budgets": {
        "nonexistent_col": {
            "type": "continuous",
            "epsilon_budget": 0.5,
            "delta_budget": 0.0,
            "sensitivity": 10.0,
        }
    }
}

BUDGETS_INVALID_EPSILON = {
    "column_budgets": {
        "年齡": {"type": "continuous", "epsilon_budget": 0.0, "sensitivity": 30.0}
    }
}


@pytest.fixture
def dp_config(bundle):
    """把 DP 預算包成大包設定檔的上傳三元組（只開 differential_privacy 區塊）。"""

    def _make(block=None, filename="config.json", **root):
        payload = bundle(
            root=root or None, differential_privacy=block or BUDGETS_WITHIN_LIMIT
        )
        return (filename, payload, "application/json")

    return _make


def test_dp_success(client, sample_csv_bytes, dp_config):
    """正常加噪應回傳 200 與 CSV，並附帶 X-Budget-Report 標頭"""
    resp = client.post(
        "/api/v1/dp",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": dp_config(),
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("content-type", "").startswith("text/csv")
    assert "X-Budget-Report" in resp.headers


def test_dp_budget_report_is_valid_json(client, sample_csv_bytes, dp_config):
    """X-Budget-Report 標頭應可被解析為合法 JSON，並回報消耗與累計。

    累計預算由設定檔自帶（引擎只讀不寫）。
    """
    resp = client.post(
        "/api/v1/dp",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": dp_config({**BUDGETS_WITHIN_LIMIT, "accumulated_epsilon": 0.5}),
        },
    )
    assert resp.status_code == 200
    budget_report = json.loads(resp.headers["X-Budget-Report"])
    assert budget_report["consumed_epsilon"] == pytest.approx(1.0)
    # 自帶累計 0.5 + 本次 1.0 → 收據回報 1.5，供呼叫方下次自帶
    assert budget_report["accumulated_epsilon"] == pytest.approx(1.5)


def test_dp_column_not_in_data(client, sample_csv_bytes, dp_config):
    """設定檔中包含資料集不存在的欄位：語法讀得懂但對不上資料，應回 422"""
    resp = client.post(
        "/api/v1/dp",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": dp_config(BUDGETS_WRONG_COL),
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ERR_CONFIG_DATA_MISMATCH"


def test_dp_invalid_budget_in_config_rejected(client, sample_csv_bytes, dp_config):
    """設定檔本身值域不合法（ε=0）→ 解析時即擋（擋的檢查前置），回 422"""
    resp = client.post(
        "/api/v1/dp",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": dp_config(BUDGETS_INVALID_EPSILON),
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ERR_DP_INVALID_BUDGET"


def test_dp_unsupported_config_format_rejected(client, sample_csv_bytes, dp_config):
    """設定檔非 YAML/JSON（比照 /k-anonymity）→ 格式不收，回 415 並說明支援格式"""
    resp = client.post(
        "/api/v1/dp",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": dp_config(filename="budgets.txt"),
        },
    )
    assert resp.status_code == 415
    assert resp.json()["error_code"] == "ERR_UNSUPPORTED_CONFIG_FORMAT"


def test_dp_missing_config(client, sample_csv_bytes):
    """缺少必要的設定檔應回傳 422"""
    resp = client.post(
        "/api/v1/dp",
        files={"file": ("data.csv", sample_csv_bytes, "text/csv")},
    )
    assert resp.status_code == 422


def test_dp_requires_dp_block(client, sample_csv_bytes, bundle, kanon_block):
    """設定檔只開了 K-匿名區塊 → 本端點無預算可用，擋下並指名缺哪一塊。"""
    resp = client.post(
        "/api/v1/dp",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": ("config.json", bundle(k_anonymity=kanon_block()), "application/json"),
        },
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error_code"] == "ERR_CONFIG_BLOCK_REQUIRED"
    assert "differential_privacy" in body["message"]


def test_dp_content_disposition(client, sample_csv_bytes, dp_config):
    """回應標頭應包含 Content-Disposition 且帶有 dp_ 前綴的檔名"""
    resp = client.post(
        "/api/v1/dp",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": dp_config(),
        },
    )
    assert resp.status_code == 200
    disposition = resp.headers.get("content-disposition", "")
    assert "dp_data.csv" in disposition


def test_dp_success_is_audited(client, sample_csv_bytes, dp_config, tmp_path, monkeypatch):
    """加噪成功也要留痕：成功的處理行為同樣寫入稽核軌跡"""
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setattr(
        "app.governance.audit._audit_logger", AuditLogger(log_path=str(log_path))
    )

    resp = client.post(
        "/api/v1/dp",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": dp_config(),
        },
    )
    assert resp.status_code == 200

    entries = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
    assert [(e["operation"], e["status"]) for e in entries] == [("dp", "success")]
    assert entries[0]["parameters"]["dataset"] == "data.csv"
    assert entries[0]["parameters"]["consumed_epsilon"] == pytest.approx(1.0)


def test_dp_chinese_filename(client, sample_csv_bytes, dp_config):
    """中文檔名不得讓已加噪完成的結果在回傳時變成 500，原檔名並須編碼保留"""
    resp = client.post(
        "/api/v1/dp",
        files={
            "file": ("病患資料.csv", sample_csv_bytes, "text/csv"),
            "config": dp_config(),
        },
    )
    assert resp.status_code == 200
    disposition = resp.headers.get("content-disposition", "")
    assert quote("dp_病患資料.csv", safe="") in disposition
