"""
測試共用 Fixture 設定
所有 unit/ 和 api/ 底下的測試皆可直接使用此處定義的 fixture，不需自行 import。
"""
import copy
import os

# ★ TTC 2026-10-28：後端加了密碼長度下限（預設 12，見 app/governance/auth.py）。既有測試沿用短密碼，
#   這裡把下限放寬為 1；長度規則本身由 tests/unit/test_password_min_length.py 驗證。
os.environ.setdefault("OPEN_PETS_PASSWORD_MIN_LENGTH", "1")
# ★ TTC 2026-10-30：密碼複雜度與 source 目錄限制（見 auth.py、api/dataset_input.py）。既有測試沿用簡單密碼、
#   以暫存目錄的 SQLite 當資料來源，這裡關閉複雜度、開放暫存目錄；規則本身由 test_security_consistency.py 驗證。
import tempfile

os.environ.setdefault("OPEN_PETS_PASSWORD_REQUIRE_COMPLEXITY", "0")
os.environ.setdefault("OPEN_PETS_ALLOWED_SOURCE_DIRS", tempfile.gettempdir())
import gc
import json
import logging
from types import SimpleNamespace

import pytest
import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from app.api.server import app
from app.core.config import ColumnConfig, ColumnInfo
from app.governance.auth import AuthManager


# ──────────────────────────────────────────────────────────────
# 標準 12 筆 × 10 欄位測試資料（欄位名稱同 benchmarks/generate_data.py）
# ──────────────────────────────────────────────────────────────
SAMPLE_ROWS = [
    {"姓名": "user_0",  "身分證號": "A123456789", "年齡": 25, "地區": "大安區", "生日": "1999-03-15", "疾病": "感冒",   "薪資": 45000,  "職業": "工程師", "婚姻狀況": "未婚", "就醫次數": 2},
    {"姓名": "user_1",  "身分證號": "B234567890", "年齡": 27, "地區": "大安區", "生日": "1997-07-22", "疾病": "高血壓", "薪資": 52000,  "職業": "工程師", "婚姻狀況": "未婚", "就醫次數": 5},
    {"姓名": "user_2",  "身分證號": "C345678901", "年齡": 32, "地區": "中正區", "生日": "1992-11-08", "疾病": "心臟病", "薪資": 68000,  "職業": "教師",   "婚姻狀況": "已婚", "就醫次數": 8},
    {"姓名": "user_3",  "身分證號": "D456789012", "年齡": 35, "地區": "中正區", "生日": "1989-05-30", "疾病": "糖尿病", "薪資": 72000,  "職業": "教師",   "婚姻狀況": "已婚", "就醫次數": 12},
    {"姓名": "user_4",  "身分證號": "E567890123", "年齡": 41, "地區": "板橋區", "生日": "1983-09-14", "疾病": "過敏",   "薪資": 85000,  "職業": "醫師",   "婚姻狀況": "已婚", "就醫次數": 3},
    {"姓名": "user_5",  "身分證號": "F678901234", "年齡": 45, "地區": "板橋區", "生日": "1979-01-26", "疾病": "感冒",   "薪資": 91000,  "職業": "醫師",   "婚姻狀況": "離婚", "就醫次數": 1},
    {"姓名": "user_6",  "身分證號": "G789012345", "年齡": 29, "地區": "信義區", "生日": "1995-06-03", "疾病": "高血壓", "薪資": 55000,  "職業": "業務",   "婚姻狀況": "未婚", "就醫次數": 4},
    {"姓名": "user_7",  "身分證號": "H890123456", "年齡": 33, "地區": "信義區", "生日": "1991-12-19", "疾病": "過敏",   "薪資": 63000,  "職業": "業務",   "婚姻狀況": "已婚", "就醫次數": 6},
    {"姓名": "user_8",  "身分證號": "I901234567", "年齡": 38, "地區": "松山區", "生日": "1986-04-07", "疾病": "心臟病", "薪資": 77000,  "職業": "會計",   "婚姻狀況": "已婚", "就醫次數": 9},
    {"姓名": "user_9",  "身分證號": "J012345678", "年齡": 42, "地區": "松山區", "生日": "1982-08-25", "疾病": "糖尿病", "薪資": 82000,  "職業": "會計",   "婚姻狀況": "離婚", "就醫次數": 11},
    {"姓名": "user_10", "身分證號": "K123456780", "年齡": 50, "地區": "南港區", "生日": "1974-02-13", "疾病": "感冒",   "薪資": 95000,  "職業": "主管",   "婚姻狀況": "已婚", "就醫次數": 2},
    {"姓名": "user_11", "身分證號": "L234567891", "年齡": 55, "地區": "南港區", "生日": "1969-10-31", "疾病": "高血壓", "薪資": 110000, "職業": "主管",   "婚姻狀況": "已婚", "就醫次數": 7},
]

# ──────────────────────────────────────────────────────────────
# 大包設定檔（bundled config）：根層 ＋ 五個平行區塊，每塊自帶 enabled 開關。
# 測試只組出「這次要開的區塊」，其餘區塊連寫都不必寫（整塊省略＝關閉）。
# ──────────────────────────────────────────────────────────────
SAMPLE_KANON_COLUMNS = {
    "姓名":     {"role": "identifier",       "type": "string"},
    "身分證號": {"role": "identifier",       "type": "string"},
    "年齡":     {"role": "quasi_identifier", "type": "numeric"},
    "地區":     {"role": "quasi_identifier", "type": "categorical"},
    "生日":     {"role": "quasi_identifier", "type": "temporal"},
    "疾病":     {"role": "sensitive",        "type": "categorical"},
    "薪資":     {"role": "non_sensitive",    "type": "numeric"},
    "職業":     {"role": "quasi_identifier", "type": "categorical"},
    "婚姻狀況": {"role": "quasi_identifier", "type": "categorical"},
    "就醫次數": {"role": "non_sensitive",    "type": "numeric"},
}

# 風險評估的角色宣告：role 只有 quasi_identifier／sensitive 兩值（與 K-匿名分屬不同區塊）。
# QI 與 sensitive 集合刻意對齊 K-匿名區塊抽出的結果。
SAMPLE_RISK_COLUMNS = {
    "年齡":     {"role": "quasi_identifier", "type": "numeric"},
    "地區":     {"role": "quasi_identifier", "type": "categorical"},
    "生日":     {"role": "quasi_identifier", "type": "temporal"},
    "職業":     {"role": "quasi_identifier", "type": "categorical"},
    "婚姻狀況": {"role": "quasi_identifier", "type": "categorical"},
    "疾病":     {"role": "sensitive",        "type": "categorical"},
}


@pytest.fixture(scope="session")
def bundle():
    """把各區塊內容組成一份大包設定檔的 bytes（每塊自動補上 enabled: true）。

    用法：bundle(k_anonymity=kanon_block(k=6))；根層欄位（version／dataset／
    input_format）以 root= 帶入。一律寫成 JSON——JSON 是 YAML 的子集，
    字典、清單與中文都能正確表達，不必為每組參數各抄一份 YAML。
    """

    def _make(*, root: dict | None = None, **blocks) -> bytes:
        data: dict = dict(root or {})
        for name, body in blocks.items():
            data[name] = {"enabled": True, **body}
        return json.dumps(data, ensure_ascii=False).encode("utf-8")

    return _make


@pytest.fixture(scope="session")
def kanon_block():
    """標準 10 欄位的 k_anonymity 區塊內容；整體參數以關鍵字加入（如 k=6）。"""

    def _make(**params) -> dict:
        return {"columns": copy.deepcopy(SAMPLE_KANON_COLUMNS), **params}

    return _make


@pytest.fixture(scope="session")
def risk_block():
    """標準風險角色的區塊內容（risk_attacks／risk_cap 共用）；參數以關鍵字加入。"""

    def _make(**params) -> dict:
        return {"columns": copy.deepcopy(SAMPLE_RISK_COLUMNS), **params}

    return _make


@pytest.fixture(scope="session")
def kanon_bundle(bundle, kanon_block):
    """最常用的一包：只開 k_anonymity 區塊、內容為標準 10 欄位。"""
    return bundle(k_anonymity=kanon_block())


@pytest.fixture(scope="session")
def client():
    """FastAPI TestClient：不需啟動真實 Server 即可測試所有 API"""
    return TestClient(app)


@pytest.fixture(scope="session")
def sample_df():
    """標準 12 筆 × 10 欄位測試 DataFrame"""
    return pd.DataFrame(SAMPLE_ROWS)


@pytest.fixture(scope="session")
def processed_df(sample_df):
    """模擬去識別化後的 DataFrame（供風險評估測試使用）"""
    df = sample_df.copy()
    df["姓名"] = "*"
    df["身分證號"] = "***"
    df["年齡"] = (df["年齡"] // 10) * 10
    df["生日"] = df["生日"].str[:4]
    return df


@pytest.fixture(scope="session")
def sample_config():
    """標準 10 欄位 ColumnConfig 物件"""
    return ColumnConfig(
        columns={
            "姓名":     ColumnInfo(role="identifier",       type="string"),
            "身分證號": ColumnInfo(role="identifier",       type="string"),
            "年齡":     ColumnInfo(role="quasi_identifier", type="numeric"),
            "地區":     ColumnInfo(role="quasi_identifier", type="categorical"),
            "生日":     ColumnInfo(role="quasi_identifier", type="temporal"),
            "疾病":     ColumnInfo(role="sensitive",        type="categorical"),
            "薪資":     ColumnInfo(role="non_sensitive",    type="numeric"),
            "職業":     ColumnInfo(role="quasi_identifier", type="categorical"),
            "婚姻狀況": ColumnInfo(role="quasi_identifier", type="categorical"),
            "就醫次數": ColumnInfo(role="non_sensitive",    type="numeric"),
        }
    )


@pytest.fixture(scope="session")
def salt():
    """測試專用鹽值：引擎不提供寫死的預設鹽值，需要假名化的測試須明確帶入。"""
    return "unit-test-salt"


@pytest.fixture(scope="session")
def sample_csv_bytes(sample_df):
    """標準測試資料的 CSV bytes（供 API 上傳測試使用）"""
    return sample_df.to_csv(index=False).encode("utf-8")


@pytest.fixture(scope="session")
def processed_csv_bytes(processed_df):
    """去識別化後資料的 CSV bytes（供風險評估 API 測試使用）"""
    return processed_df.to_csv(index=False).encode("utf-8")


@pytest.fixture(scope="session")
def sqlite_source(tmp_path_factory, sample_df, processed_df):
    """一份含前後兩張表的 SQLite 檔，供「以連線字串指定資料來源」的測試使用。

    回傳 url／table／processed_table 三個屬性。SQLAlchemy 的 sqlite:/// 後接相對
    路徑、sqlite://// 後接絕對路徑；Windows 的磁碟機代號路徑（C:/…）在三個斜線
    後即為絕對路徑，故此處統一以三個斜線串接 tmp_path 產出的絕對路徑。
    """
    db_path = tmp_path_factory.mktemp("sqlite_source") / "sample.db"
    url = f"sqlite:///{db_path.as_posix()}"
    engine = create_engine(url)
    sample_df.to_sql("patients", engine, index=False)
    processed_df.to_sql("patients_deid", engine, index=False)
    # Windows 上未關閉的連線會鎖住檔案，讓 tmp_path 清理失敗
    engine.dispose()
    return SimpleNamespace(url=url, table="patients", processed_table="patients_deid")


@pytest.fixture
def app_logs(caplog, monkeypatch):
    """擷取本套件寫出的系統日誌。

    configure_logging() 會把 app 這個 logger 的 propagate 關掉（見 core/logging_setup），
    因此只要同一輪測試裡有人呼叫過 CLI 入口，caplog 掛在根 logger 上的處理器就再也
    收不到訊息——日誌相關的測試會變成依執行順序而定，單獨跑得過、整包跑就失敗。
    此處於測試期間恢復傳遞，結束後由 monkeypatch 自動還原。
    """
    monkeypatch.setattr(logging.getLogger("app"), "propagate", True)
    caplog.set_level(logging.WARNING, logger="app")
    return caplog


@pytest.fixture(scope="module")
def temp_dir(tmp_path_factory):
    """每個測試模組獨立的暫存目錄，測試完畢後自動清除"""
    path = tmp_path_factory.mktemp("test_temp")
    yield str(path)
    gc.collect()


# ──────────────────────────────────────────────────────────────
# 測試帳號：只存在於測試期間的暫存資料庫
# 主程式啟動時不自建任何帳號（寫死的預設帳密部署後刪不掉），
# 兩組角色帳號由以下 fixture 建立，正式環境請以 CLI create-user 建立管理員。
# ──────────────────────────────────────────────────────────────
TEST_ACCOUNTS = [
    ("admin", "admin123", "admin"),
    ("user", "user123", "user"),
]

# 測試用的 token 簽章金鑰。未設定時會員端點一律回 503（見 governance/token），
# 故凡是打 /auth 或 /users 的測試都必須先備妥這個環境變數。
TEST_JWT_SECRET = "unit-test-jwt-secret"


@pytest.fixture
def auth_manager(tmp_path):
    """備妥兩組角色帳號的 AuthManager（資料庫落在測試專屬暫存目錄）"""
    manager = AuthManager(db_path=str(tmp_path / "users.db"))
    for username, password, role in TEST_ACCOUNTS:
        manager.create_user(username, password, role)
    return manager


@pytest.fixture
def api_auth(monkeypatch, auth_manager):
    """把 API 端點用的 AuthManager 換成測試帳號版本，避免動到部署環境的使用者資料庫

    換的是治理層那份共用實例（延後建立，見 auth.get_auth_manager），
    路由檔本身不持有實例。
    refresh token 與帳號同一個資料庫檔，token 管理器會跟著這份實例走，不必另外替換。
    """
    monkeypatch.setattr("app.governance.auth._auth_manager", auth_manager)
    monkeypatch.setenv("OPEN_PETS_JWT_SECRET", TEST_JWT_SECRET)
    return auth_manager


@pytest.fixture
def login(client, api_auth):
    """以測試帳號登入並回傳可直接掛在請求上的 Authorization 標頭。"""

    def _login(username: str = "admin", password: str = "admin123") -> dict[str, str]:
        resp = client.post(
            "/api/v1/auth/login", json={"username": username, "password": password}
        )
        assert resp.status_code == 200, resp.text
        return {"Authorization": f"Bearer {resp.json()['access_token']}"}

    return _login


# ──────────────────────────────────────────────────────────────
# ★ TTC 2026-10-29：處理端點改須登入（見 app/api/processing_guard.py）
# 既有的處理端點測試專注在引擎行為，預設以假登入者通過；驗證登入要求本身的測試
# 使用 real_processing_auth fixture 取消這個覆寫。系統資料庫一律落在另一個暫存目錄（不污染各測試的 tmp_path）。
# ──────────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def _processing_auth_and_system_store(monkeypatch, tmp_path_factory):
    from fastapi import Request

    from app.api.processing_guard import require_processing_user
    from app.governance.system_store import SystemStore

    monkeypatch.setattr(
        "app.governance.system_store._system_store", SystemStore(db_path=str(tmp_path_factory.mktemp("system_store") / "system.db"))
    )

    def _fake_processing_user(request: Request) -> dict:
        request.state.processing_user = "test-processing-user"
        return {"username": "test-processing-user", "role": "user", "is_active": True}

    app.dependency_overrides[require_processing_user] = _fake_processing_user
    yield
    app.dependency_overrides.pop(require_processing_user, None)


@pytest.fixture
def real_processing_auth():
    """取消處理端點的假登入，改走真正的 token 驗證。"""
    from app.api.processing_guard import require_processing_user

    app.dependency_overrides.pop(require_processing_user, None)
