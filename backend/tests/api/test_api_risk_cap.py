"""
API - CAP 前後對比端點 整合測試
涵蓋：POST /risk/cap
  - 正常前後對比回 cap_before/after、不含攻擊指標
  - 子群體對前後各篩、報告揭露前後筆數
  - 原始子群體為空 → 降級告知不爆
  - 子群體條件錯誤（欄位不存在／形狀不對）→ 422／400
  - 缺處理後資料 → 400

子群體條件與去識別後資料的格式隨大包設定檔的 risk_cap 區塊提供，端點不收表單欄位。
"""
import pytest

URL = "/api/v1/risk/cap"


@pytest.fixture
def files(bundle, risk_block, sample_csv_bytes, processed_csv_bytes):
    """前後兩份資料 ＋ 只開 risk_cap 區塊的大包設定檔。"""

    def _make(processed_name="processed.csv", root=None, **cap_params):
        payload = bundle(root=root, risk_cap=risk_block(**cap_params))
        return {
            "original": ("original.csv", sample_csv_bytes, "text/csv"),
            "processed": (processed_name, processed_csv_bytes, "text/csv"),
            "config": ("config.json", payload, "application/json"),
        }

    return _make


def test_cap_success(client, files):
    """正常流程：回 cap_before/after，不含三攻擊指標。"""
    resp = client.post(URL, files=files())
    assert resp.status_code == 200, resp.text
    data = resp.json()
    for key in ("cap_before", "cap_after", "n_original", "n_processed"):
        assert key in data
    assert data["cap_before"] == -1.0 or 0.0 <= data["cap_before"] <= 1.0
    # CAP 獨立端點不含三攻擊指標
    assert "singling_out_risk" not in data
    # 回報本次執行耗時
    assert data["elapsed_seconds"] >= 0


def test_cap_subgroup_filters_both(client, files):
    """子群體對前後各篩：報告揭露原始與處理後的篩選前後筆數。"""
    resp = client.post(URL, files=files(subgroup={"年齡": {"min": 30, "max": 45}}))
    assert resp.status_code == 200, resp.text
    msg = resp.json()["message"]
    # 原始年齡落在 [30,45] 為 7 筆；處理後年齡被泛化成十位數，[30,45] 命中 30/40 兩組
    assert "原始篩選前 12 筆、篩選後 7 筆" in msg
    assert "處理後篩選前 12 筆" in msg


def test_cap_original_subgroup_empty_degrades(client, files):
    """原始子群體篩完為空 → 不崩，降級 -1.0 並告知。"""
    resp = client.post(URL, files=files(subgroup={"年齡": {"min": 200}}))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["cap_before"] == -1.0
    assert "篩選後 0 筆" in data["message"]


def test_cap_subgroup_bad_column(client, files):
    """子群體條件引用不存在欄位：語法讀得懂但對不上資料 → 422（fail fast）。"""
    resp = client.post(URL, files=files(subgroup={"不存在的欄": [1, 2]}))
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ERR_CONFIG_DATA_MISMATCH"


def test_cap_subgroup_not_an_object(client, files):
    """subgroup 不是「欄位: 條件」的物件＝條件本身不成立 → 400，於解析設定檔時即擋。"""
    resp = client.post(URL, files=files(subgroup="不是物件"))
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "ERR_SUBSET_COND_MALFORMED"


def test_cap_processed_format_from_config(client, files):
    """去識別後資料沒有副檔名時，以 risk_cap 區塊的 processed_format 明講格式即可處理。"""
    resp = client.post(
        URL, files=files(processed_name="processed_export", processed_format="csv")
    )
    assert resp.status_code == 200, resp.text


def test_cap_rejects_experiment_params(client, files):
    """CAP 不切分、不產 syn，七個實驗參數一個都用不到；寫了就擋，不靜默忽略。"""
    resp = client.post(URL, files=files(n_iter=30))
    assert resp.status_code == 422
    body = resp.json()
    assert body["error_code"] == "ERR_CONFIG_INVALID"
    assert "n_iter" in body["message"]


def test_cap_requires_cap_block(client, sample_csv_bytes, processed_csv_bytes, bundle, risk_block):
    """開的是 risk_attacks 而非 risk_cap → 擋，並指名本端點要哪一塊。"""
    resp = client.post(
        URL,
        files={
            "original": ("original.csv", sample_csv_bytes, "text/csv"),
            "processed": ("processed.csv", processed_csv_bytes, "text/csv"),
            "config": (
                "config.json",
                bundle(risk_attacks=risk_block()),
                "application/json",
            ),
        },
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error_code"] == "ERR_CONFIG_BLOCK_REQUIRED"
    assert "risk_cap" in body["message"]


def test_cap_missing_processed(client, sample_csv_bytes, bundle, risk_block):
    """缺處理後資料 → 400。

    processed 與 processed_source 二擇一、兩者皆為選填，故由端點自行擋
    （ERR_INVALID_PARAM），而非框架的必填欄位檢查。
    """
    resp = client.post(
        URL,
        files={
            "original": ("original.csv", sample_csv_bytes, "text/csv"),
            "config": (
                "config.json",
                bundle(risk_cap=risk_block()),
                "application/json",
            ),
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "ERR_INVALID_PARAM"
