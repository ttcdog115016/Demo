"""
API - 三攻擊（DP）端點 整合測試
涵蓋：POST /risk/dp
  - 正常評估回三攻擊指標、不含 CAP
  - 子群體前篩（處理前篩原始）：正常縮小範圍、空群降級告知前後筆數
  - 子群體條件錯誤（欄位不存在／形狀不對）→ 422／400
  - 缺 differential_privacy 區塊 → 422

與 K-匿名端點的差別僅在去識別方法：改開 differential_privacy 區塊、無鹽值需求。
實驗參數與子群體隨 risk_attacks 區塊提供，端點不收表單欄位。
"""
import pytest

# differential_privacy 區塊：年齡連續型加 Laplace、地區類別型走 k-RR，
# 使自產 syn 與原始有差異。
DP_SYN_BLOCK = {
    "column_budgets": {
        "年齡": {
            "type": "continuous",
            "epsilon_budget": 1.0,
            "delta_budget": 0.0,
            "sensitivity": 30.0,
        },
        "地區": {"type": "categorical", "epsilon_budget": 1.0},
    }
}

URL = "/api/v1/risk/dp"


@pytest.fixture
def files(bundle, risk_block, sample_csv_bytes):
    """原始資料 ＋ 一份同時開 risk_attacks 與 differential_privacy 的大包設定檔。"""

    def _make(dp_block=None, **risk_params):
        payload = bundle(
            risk_attacks=risk_block(**risk_params),
            differential_privacy=dp_block or DP_SYN_BLOCK,
        )
        return {
            "original": ("original.csv", sample_csv_bytes, "text/csv"),
            "config": ("config.json", payload, "application/json"),
        }

    return _make


def test_attacks_dp_success(client, files):
    """正常流程：回三攻擊指標、不含 CAP 欄位。"""
    resp = client.post(URL, files=files(n_iter=30))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    for key in ("singling_out_risk", "linkability_risk", "inference_risk"):
        assert key in data
        assert data[key] == -1.0 or 0.0 <= data[key] <= 1.0
    # 三攻擊報告不含 CAP
    assert "cap_before" not in data
    assert "cap_after" not in data


def test_attacks_dp_subgroup_filters(client, files):
    """子群體前篩：限定年齡區間後，報告揭露篩選前後筆數。"""
    resp = client.post(
        URL, files=files(n_iter=30, subgroup={"年齡": {"min": 30, "max": 45}})
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # 樣本中年齡落在 [30,45] 閉區間者為 7 筆
    assert "篩選前 12 筆、篩選後 7 筆" in data["message"]


def test_attacks_dp_subgroup_empty_degrades(client, files):
    """子群體篩完為空 → 不崩，降級 -1.0 並據實告知前後筆數。"""
    resp = client.post(URL, files=files(subgroup={"年齡": {"min": 200}}))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["singling_out_risk"] == -1.0
    assert "篩選後 0 筆" in data["message"]


def test_attacks_dp_subgroup_bad_column(client, files):
    """子群體條件引用不存在欄位：語法讀得懂但對不上資料 → 422（fail fast）。"""
    resp = client.post(URL, files=files(subgroup={"不存在的欄": [1, 2]}))
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ERR_CONFIG_DATA_MISMATCH"


def test_attacks_dp_subgroup_not_an_object(client, files):
    """subgroup 不是「欄位: 條件」的物件＝條件本身不成立 → 400，於解析設定檔時即擋。"""
    resp = client.post(URL, files=files(subgroup="不是物件"))
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "ERR_SUBSET_COND_MALFORMED"


def test_attacks_dp_accumulated_budget_from_config(client, files):
    """DP 區塊自帶的累計預算會被採用：設定檔即可完整重現一次評估。"""
    resp = client.post(
        URL,
        files=files({**DP_SYN_BLOCK, "accumulated_epsilon": 0.5}, n_iter=30),
    )
    assert resp.status_code == 200, resp.text


def test_attacks_dp_missing_dp_block(client, sample_csv_bytes, bundle, risk_block):
    """只開 risk_attacks、沒開 differential_privacy → 沒有產 syn 的規則可用，擋。"""
    resp = client.post(
        URL,
        files={
            "original": ("original.csv", sample_csv_bytes, "text/csv"),
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
    assert "differential_privacy" in body["message"]


def test_attacks_dp_missing_config(client, sample_csv_bytes):
    """缺設定檔 → 422。"""
    resp = client.post(
        URL,
        files={"original": ("original.csv", sample_csv_bytes, "text/csv")},
    )
    assert resp.status_code == 422
