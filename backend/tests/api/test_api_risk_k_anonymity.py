"""
API - 三攻擊（K-匿名）端點 整合測試
涵蓋：POST /risk/k-anonymity
  - 正常評估回三攻擊指標、不含 CAP
  - 子群體前篩（處理前篩原始）：正常縮小範圍、空群降級告知前後筆數
  - 子群體條件錯誤（欄位不存在／形狀不對）→ 422／400
  - 缺 k_anonymity 區塊 → 422

一份大包設定檔同時開 risk_attacks（攻擊角色、實驗參數、子群體）與 k_anonymity
（產 syn 用的泛化階層與 K-匿名參數）兩個區塊，端點不收表單欄位；
鹽值只由部署環境的 .env 提供。
"""
import pytest

# k_anonymity 區塊：年齡四捨五入至 10 的倍數，k=2 時等價類足夠、不會整份被抑制，
# 讓引擎能在 12 筆樣本上自產出可評估的 syn。
KANON_SYN_BLOCK = {
    "k": 2,
    "columns": {
        "年齡": {"role": "quasi_identifier", "type": "numeric"},
        "疾病": {"role": "sensitive", "type": "categorical"},
    },
    "generalization_hierarchies": {"年齡": {"rounding": 10}},
}

URL = "/api/v1/risk/k-anonymity"


@pytest.fixture(autouse=True)
def env_salt(monkeypatch):
    """鹽值只認 .env（選填）；此處備妥一把，讓自產 syn 走加鹽的雜湊。"""
    monkeypatch.setenv("OPEN_PETS_DEFAULT_SALT", "test_salt")


@pytest.fixture
def files(bundle, risk_block, sample_csv_bytes):
    """原始資料 ＋ 一份同時開兩塊的大包設定檔。"""

    def _make(**risk_params):
        payload = bundle(
            risk_attacks=risk_block(**risk_params), k_anonymity=KANON_SYN_BLOCK
        )
        return {
            "original": ("original.csv", sample_csv_bytes, "text/csv"),
            "config": ("config.json", payload, "application/json"),
        }

    return _make


def test_attacks_kanon_success(client, files):
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
    # 回報本次執行耗時
    assert data["elapsed_seconds"] >= 0


def test_attacks_kanon_subgroup_filters(client, files):
    """子群體前篩：限定年齡區間後，報告揭露篩選前後筆數。"""
    resp = client.post(
        URL, files=files(n_iter=30, subgroup={"年齡": {"min": 30, "max": 45}})
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # 樣本中年齡落在 [30,45] 閉區間者為 7 筆（32,33,35,38,41,42,45）
    assert "篩選前 12 筆、篩選後 7 筆" in data["message"]


def test_attacks_kanon_subgroup_empty_degrades(client, files):
    """子群體篩完為空 → 不崩，降級 -1.0 並據實告知前後筆數。"""
    resp = client.post(URL, files=files(subgroup={"年齡": {"min": 200}}))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["singling_out_risk"] == -1.0
    assert "篩選後 0 筆" in data["message"]


def test_attacks_kanon_subgroup_bad_column(client, files):
    """子群體條件引用不存在欄位：語法讀得懂但對不上資料 → 422（fail fast）。"""
    resp = client.post(URL, files=files(subgroup={"不存在的欄": [1, 2]}))
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ERR_CONFIG_DATA_MISMATCH"


def test_attacks_kanon_subgroup_not_an_object(client, files):
    """subgroup 不是「欄位: 條件」的物件＝條件本身不成立 → 400，於解析設定檔時即擋。"""
    resp = client.post(URL, files=files(subgroup="不是物件"))
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "ERR_SUBSET_COND_MALFORMED"


def test_attacks_kanon_missing_kanon_block(
    client, sample_csv_bytes, bundle, risk_block
):
    """只開 risk_attacks、沒開 k_anonymity → 沒有產 syn 的規則可用，擋下並指名缺哪一塊。"""
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
    assert "k_anonymity" in body["message"]


def test_attacks_kanon_ignores_cap_block(
    client, sample_csv_bytes, bundle, risk_block
):
    """多開了本端點用不到的 risk_cap 區塊 → 略過，只取 risk_attacks 與 k_anonymity。"""
    resp = client.post(
        URL,
        files={
            "original": ("original.csv", sample_csv_bytes, "text/csv"),
            "config": (
                "config.json",
                bundle(
                    risk_attacks=risk_block(),
                    k_anonymity=KANON_SYN_BLOCK,
                    risk_cap=risk_block(),
                ),
                "application/json",
            ),
        },
    )
    assert resp.status_code == 200, resp.text


def test_attacks_kanon_rejects_experiment_param_in_kanon_block(
    client, sample_csv_bytes, bundle, risk_block
):
    """實驗參數是風險的東西，寫進 k_anonymity 區塊＝放錯地方，擋而非靜默忽略。"""
    resp = client.post(
        URL,
        files={
            "original": ("original.csv", sample_csv_bytes, "text/csv"),
            "config": (
                "config.json",
                bundle(
                    risk_attacks=risk_block(),
                    k_anonymity={**KANON_SYN_BLOCK, "n_iter": 30},
                ),
                "application/json",
            ),
        },
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error_code"] == "ERR_CONFIG_INVALID"
    assert "n_iter" in body["message"]


def test_attacks_kanon_missing_config(client, sample_csv_bytes):
    """缺設定檔 → 422。"""
    resp = client.post(
        URL,
        files={"original": ("original.csv", sample_csv_bytes, "text/csv")},
    )
    assert resp.status_code == 422
