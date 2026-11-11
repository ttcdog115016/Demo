"""
API - 資料來源二擇一 整合測試
涵蓋：吃資料的端點皆可以連線字串指定伺服器本機的 SQLite 來源（/preprocess 見 test_api_preprocess）
  - /k-anonymity、/dp、/risk/k-anonymity、/risk/dp 各一份資料
  - /risk/cap 兩份資料各自選來源，四種組合皆合法
  - 同一份資料上傳與來源都給／都不給 → 400
  - 來源為 SQLite 但缺資料表名 → 400（擋在連線之前）

對齊 CLI：CLI 的 --input 同時收檔案路徑與 sqlite:///…，API 的上傳與連線字串
分屬檔案欄位與文字欄位，故拆成兩個欄位二擇一，規則與 CLI 一致。
"""
import json

import pytest

BASE = "/api/v1"

DP_BUDGETS = {
    "column_budgets": {
        "年齡": {
            "type": "continuous",
            "epsilon_budget": 0.5,
            "delta_budget": 0.0,
            "sensitivity": 30.0,
        }
    }
}

# 三攻擊要切分與產 syn，12 筆的標準測試資料只需最小可行的實驗參數
ATTACK_PARAMS = {"n_iter": 2, "n_subset": 2, "n_repeats": 1}


@pytest.fixture(autouse=True)
def env_salt(monkeypatch):
    """K-匿名相關端點只認 .env 的鹽值。"""
    monkeypatch.setenv("OPEN_PETS_DEFAULT_SALT", "test_salt")


def _config(payload):
    return ("config.json", payload, "application/json")


# ── 單一資料集的四個端點 ────────────────────────────────────────────────


def test_k_anonymity_accepts_sqlite_source(client, sqlite_source, kanon_bundle):
    """/k-anonymity 以連線字串指定來源：正常處理，且輸出退回 CSV。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={"config": _config(kanon_bundle)},
        data={"source": sqlite_source.url, "table": sqlite_source.table},
    )
    assert resp.status_code == 200, resp.text
    # 資料庫來源無對應的檔案格式語意，一律輸出 CSV，下載檔名以資料表名充當
    assert resp.headers.get("content-type", "").startswith("text/csv")
    assert "anonymized_patients.csv" in resp.headers["Content-Disposition"]
    assert "suppression_rate_percent" in json.loads(resp.headers["X-Quality-Report"])


def test_dp_accepts_sqlite_source(client, sqlite_source, bundle):
    """/dp 以連線字串指定來源：正常加噪並回預算報告。"""
    resp = client.post(
        f"{BASE}/dp",
        files={"config": _config(bundle(differential_privacy=DP_BUDGETS))},
        data={"source": sqlite_source.url, "table": sqlite_source.table},
    )
    assert resp.status_code == 200, resp.text
    assert "dp_patients.csv" in resp.headers["Content-Disposition"]
    assert "consumed_epsilon" in json.loads(resp.headers["X-Budget-Report"])


def test_risk_k_anonymity_accepts_sqlite_source(
    client, sqlite_source, bundle, risk_block, kanon_block
):
    """/risk/k-anonymity 以連線字串指定來源：正常回三攻擊指標。"""
    resp = client.post(
        f"{BASE}/risk/k-anonymity",
        files={
            "config": _config(
                bundle(
                    risk_attacks=risk_block(**ATTACK_PARAMS),
                    k_anonymity=kanon_block(),
                )
            )
        },
        data={"source": sqlite_source.url, "table": sqlite_source.table},
    )
    assert resp.status_code == 200, resp.text
    assert "singling_out_risk" in resp.json()


def test_risk_dp_accepts_sqlite_source(client, sqlite_source, bundle, risk_block):
    """/risk/dp 以連線字串指定來源：正常回三攻擊指標。"""
    resp = client.post(
        f"{BASE}/risk/dp",
        files={
            "config": _config(
                bundle(
                    risk_attacks=risk_block(**ATTACK_PARAMS),
                    differential_privacy=DP_BUDGETS,
                )
            )
        },
        data={"source": sqlite_source.url, "table": sqlite_source.table},
    )
    assert resp.status_code == 200, resp.text
    assert "singling_out_risk" in resp.json()


# ── CAP：兩份資料各自選來源，四種組合 ───────────────────────────────────


@pytest.fixture
def cap_config(bundle, risk_block):
    return _config(bundle(risk_cap=risk_block()))


@pytest.fixture
def cap_upload(sample_csv_bytes, processed_csv_bytes):
    """CAP 的兩份上傳三元組。"""
    return {
        "original": ("original.csv", sample_csv_bytes, "text/csv"),
        "processed": ("processed.csv", processed_csv_bytes, "text/csv"),
    }


def _cap_source(sqlite_source, which):
    """組出 CAP 其中一份的來源欄位。"""
    table = sqlite_source.table if which == "original" else sqlite_source.processed_table
    return {f"{which}_source": sqlite_source.url, f"{which}_table": table}


@pytest.mark.parametrize(
    "from_source",
    [(), ("original",), ("processed",), ("original", "processed")],
    ids=["upload+upload", "source+upload", "upload+source", "source+source"],
)
def test_cap_four_source_combinations(
    client, cap_config, cap_upload, sqlite_source, from_source
):
    """兩份各自選來源、互不相干，故四種組合都要能跑完並回前後 CAP。"""
    files = {"config": cap_config}
    data: dict[str, str] = {}
    for which in ("original", "processed"):
        if which in from_source:
            data.update(_cap_source(sqlite_source, which))
        else:
            files[which] = cap_upload[which]

    resp = client.post(f"{BASE}/risk/cap", files=files, data=data)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "cap_before" in body and "cap_after" in body


# ── 擋的條件 ────────────────────────────────────────────────────────────


def test_both_upload_and_source_rejected(
    client, sqlite_source, sample_csv_bytes, kanon_bundle
):
    """同一份資料兩種都給＝意圖不明，擋下而非擅自挑一種。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(kanon_bundle),
        },
        data={"source": sqlite_source.url, "table": sqlite_source.table},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error_code"] == "ERR_INVALID_PARAM"


def test_neither_upload_nor_source_rejected(client, kanon_bundle):
    """兩種都不給＝沒有資料可處理。"""
    resp = client.post(f"{BASE}/k-anonymity", files={"config": _config(kanon_bundle)})
    assert resp.status_code == 400, resp.text
    assert resp.json()["error_code"] == "ERR_INVALID_PARAM"


def test_sqlite_source_without_table_rejected(client, sqlite_source, kanon_bundle):
    """SQLite 來源缺資料表名：擋在連線之前，不等到讀取才失敗。"""
    resp = client.post(
        f"{BASE}/k-anonymity",
        files={"config": _config(kanon_bundle)},
        data={"source": sqlite_source.url},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error_code"] == "ERR_INVALID_PARAM"
    assert "table" in resp.json()["message"]


def test_cap_error_message_names_the_offending_dataset(
    client, cap_config, cap_upload, sqlite_source
):
    """CAP 收兩份，訊息須指名是哪一份出錯（欄位名帶 original_／processed_ 前綴）。"""
    resp = client.post(
        f"{BASE}/risk/cap",
        files={"config": cap_config, "original": cap_upload["original"]},
        data=_cap_source(sqlite_source, "original"),
    )
    assert resp.status_code == 400, resp.text
    message = resp.json()["message"]
    assert "original_source" in message
    assert "processed" not in message
