"""CLI - 失敗時的錯誤碼與離開代碼。

守的是「同一個問題，API 與 CLI 講同一句話」：
CLI 沒有 HTTP 狀態碼可回，以離開代碼表達同一套分類，且印出的錯誤碼與 API 相同。
"""
import pandas as pd
import pytest
from typer.testing import CliRunner

from app.cli.main import cli
from app.core.errors import EXIT_UNEXPECTED, HTTP_STATUS_EXIT_CODE

runner = CliRunner()


@pytest.fixture(autouse=True)
def env_salt(monkeypatch):
    """假名化用的鹽值只由 .env 提供，指令列不收 --salt。"""
    monkeypatch.setenv("OPEN_PETS_DEFAULT_SALT", "test-salt")


@pytest.fixture
def data_csv(tmp_path, sample_df):
    path = tmp_path / "data.csv"
    sample_df.to_csv(path, index=False, encoding="utf-8")
    return str(path)


@pytest.fixture
def write_config(tmp_path):
    """把大包設定檔寫成檔案並回傳路徑（CLI 吃的是路徑不是 bytes）。"""

    def _write(payload: bytes, name: str = "config.json") -> str:
        path = tmp_path / name
        path.write_bytes(payload)
        return str(path)

    return _write


@pytest.fixture
def config_json(write_config, kanon_bundle):
    return write_config(kanon_bundle)


def _run(*args):
    return runner.invoke(cli, list(args))


def test_success_exits_zero(tmp_path, data_csv, config_json):
    """成功回 0。"""
    result = _run(
        "k-anonymity", "-i", data_csv, "-c", config_json,
        "-o", str(tmp_path / "out.csv"),
    )
    assert result.exit_code == 0


def test_missing_config_file_exits_with_param_code(tmp_path, data_csv):
    """設定檔路徑給錯＝呼叫方的輸入問題，回「請求畸形」那一格，不是未預期錯誤。"""
    result = _run(
        "k-anonymity", "-i", data_csv, "-c", str(tmp_path / "nope.yaml"),
        "-o", str(tmp_path / "out.csv"),
    )
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[400]
    assert "ERR_INVALID_PARAM" in result.output


def test_unsupported_config_format_exits_with_media_type_code(tmp_path, data_csv):
    """設定檔格式不收＝與 API 的 415 同一格，離開代碼也要跟著分開。"""
    bad = tmp_path / "config.txt"
    bad.write_text("columns: {}", encoding="utf-8")
    result = _run(
        "k-anonymity", "-i", data_csv, "-c", str(bad),
        "-o", str(tmp_path / "out.csv"),
    )
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[415]
    assert "ERR_UNSUPPORTED_CONFIG_FORMAT" in result.output


def test_config_data_mismatch_exits_with_unprocessable_code(
    tmp_path, data_csv, write_config, bundle
):
    """設定檔讀得懂但對不上資料＝與 API 的 422 同一格。"""
    cfg = write_config(
        bundle(
            k_anonymity={
                "columns": {"不存在的欄位": {"role": "quasi_identifier", "type": "numeric"}}
            }
        )
    )
    result = _run(
        "k-anonymity", "-i", data_csv, "-c", cfg,
        "-o", str(tmp_path / "out.csv"),
    )
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[422]
    assert "ERR_CONFIG_DATA_MISMATCH" in result.output


def test_missing_block_exits_with_unprocessable_code(
    tmp_path, data_csv, write_config, bundle, risk_block
):
    """設定檔沒開這次要用的區塊＝內容與請求講不通，與 API 的 422 同一格。"""
    cfg = write_config(bundle(risk_cap=risk_block()))
    result = _run(
        "k-anonymity", "-i", data_csv, "-c", cfg,
        "-o", str(tmp_path / "out.csv"),
    )
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[422]
    assert "ERR_CONFIG_BLOCK_REQUIRED" in result.output


def test_unsupported_data_format_exits_with_media_type_code(tmp_path, config_json):
    """資料檔副檔名不收，與設定檔走同一種判斷與同一個離開代碼。"""
    weird = tmp_path / "data.parquet"
    weird.write_bytes(b"not a parquet")
    result = _run(
        "k-anonymity", "-i", str(weird), "-c", config_json,
        "-o", str(tmp_path / "out.csv"),
    )
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[415]
    assert "ERR_UNSUPPORTED_FILE_FORMAT" in result.output


def test_malformed_subgroup_exits_with_bad_request_code(
    data_csv, write_config, bundle, risk_block
):
    """設定檔的子群體條件不是「欄位: 條件」的物件＝請求本身畸形，對應 API 的 400。"""
    cfg = write_config(bundle(risk_cap=risk_block(subgroup="不是物件")))
    result = _run("risk-cap", "-i", data_csv, "-p", data_csv, "-c", cfg)
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[400]
    assert "ERR_SUBSET_COND_MALFORMED" in result.output


def test_suppression_exceeded_reports_same_code_and_advice(
    tmp_path, write_config, bundle, kanon_block
):
    """抑制率超限：CLI 印出的錯誤碼與建議，與 API 回的是同一份（說明寫在引擎）。"""
    # 每列 QI 組合都唯一 → k=5 必然大量抑制，觸發超限
    df = pd.DataFrame(
        {
            "姓名": [f"u{i}" for i in range(12)],
            "身分證號": [f"X{i:09d}" for i in range(12)],
            "年齡": list(range(20, 32)),
            "地區": [f"區{i}" for i in range(12)],
            "生日": [f"19{70 + i}-01-0{i % 9 + 1}" for i in range(12)],
            "疾病": ["感冒"] * 12,
            "薪資": list(range(40000, 52000, 1000)),
            "職業": [f"職{i}" for i in range(12)],
            "婚姻狀況": [f"狀{i}" for i in range(12)],
            "就醫次數": list(range(12)),
        }
    )
    data = tmp_path / "unique.csv"
    df.to_csv(data, index=False, encoding="utf-8")

    # 參數隨設定檔提供：k=5 搭配 10% 上限且超限即中止
    cfg = write_config(
        bundle(
            k_anonymity=kanon_block(
                k=5,
                suppression_limit_percent=10,
                limit_exceeded_action="stop_and_error",
            )
        ),
        "strict.json",
    )

    result = _run(
        "k-anonymity", "-i", str(data), "-c", cfg,
        "-o", str(tmp_path / "out.csv"),
    )
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[422]
    assert "ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED" in result.output
    assert "建議" in result.output


def test_report_without_any_input_exits_with_bad_request_code(tmp_path):
    """兩包報告都沒帶＝請求不成立，與 API 的 400 對應（不與未預期錯誤的 1 混在一起）。"""
    result = _run("report", "-o", str(tmp_path / "r.pdf"))
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[400]
    assert "ERR_BAD_REQUEST" in result.output


def test_duplicate_user_exits_non_zero(tmp_path, monkeypatch):
    """建立重複帳號回非零並帶錯誤碼，腳本不會誤判為成功。

    錯誤碼是 ERR_USER_EXISTS（對應 HTTP 409）而非籠統的參數錯誤：
    CLI 與 API 共用同一份建立邏輯，兩邊拿到的是同一個錯誤碼。
    """
    from app.governance.auth import AuthManager

    manager = AuthManager(db_path=str(tmp_path / "users.db"))
    # 換治理層那份共用實例：CLI 透過 get_auth_manager() 取得。
    monkeypatch.setattr("app.governance.auth._auth_manager", manager)

    assert _run("create-user", "-u", "dup", "-p", "pw123456").exit_code == 0
    again = _run("create-user", "-u", "dup", "-p", "pw123456")
    assert again.exit_code == HTTP_STATUS_EXIT_CODE[409]
    assert again.exit_code != EXIT_UNEXPECTED
    assert "ERR_USER_EXISTS" in again.output


def test_unknown_role_exits_non_zero(tmp_path, monkeypatch):
    """輸入端只收 admin／user：其他角色一律報錯。"""
    from app.governance.auth import AuthManager

    manager = AuthManager(db_path=str(tmp_path / "users.db"))
    monkeypatch.setattr("app.governance.auth._auth_manager", manager)

    result = _run("create-user", "-u", "who", "-p", "pw123456", "-r", "guest")
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[400]
    assert "ERR_INVALID_PARAM" in result.output


def test_missing_data_file_exits_with_param_code(tmp_path, config_json):
    """資料檔路徑給錯與設定檔路徑給錯同一格，不是未預期錯誤。"""
    result = _run(
        "k-anonymity", "-i", str(tmp_path / "nope.csv"), "-c", config_json,
        "-o", str(tmp_path / "out.csv"),
    )
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[400]
    assert "ERR_INVALID_PARAM" in result.output


@pytest.mark.parametrize(
    "content, code, status",
    [
        (None, "ERR_INVALID_PARAM", 400),            # 檔案不存在
        ("{bad", "ERR_BAD_REQUEST", 400),            # 語法壞掉
        ('{"singling_out_risk": "高"}', "ERR_VALIDATION_FAILED", 422),  # 不符報告格式
    ],
)
def test_report_input_problems_use_api_codes(tmp_path, content, code, status):
    """report 帶的報告檔有問題，錯誤碼與 API 同一套。"""
    path = tmp_path / "attack.json"
    if content is not None:
        path.write_text(content, encoding="utf-8")
    result = _run("report", "-o", str(tmp_path / "r.pdf"), "--attack-report", str(path))
    assert result.exit_code == HTTP_STATUS_EXIT_CODE[status]
    assert code in result.output


def _use_audit_log(monkeypatch, path):
    from app.governance.audit import AuditLogger

    logger = AuditLogger(log_path=str(path))
    monkeypatch.setattr("app.governance.audit._audit_logger", logger)
    return logger


def test_verify_log_exits_zero_when_chain_is_intact(tmp_path, monkeypatch):
    """日誌完整：離開代碼 0。"""
    monkeypatch.setenv("OPEN_PETS_SYSTEM_MASTER_KEY", "unit-test-master-key")
    _use_audit_log(monkeypatch, tmp_path / "audit.jsonl").log_operation("dp", "success", {})
    assert _run("verify-log").exit_code == 0


def test_verify_log_exits_non_zero_when_tampered(tmp_path, monkeypatch):
    """日誌遭變動：離開代碼為專用的非零值，只看離開代碼的腳本也分得出來。"""
    from app.core.errors import EXIT_AUDIT_UNVERIFIED

    monkeypatch.setenv("OPEN_PETS_SYSTEM_MASTER_KEY", "unit-test-master-key")
    path = tmp_path / "audit.jsonl"
    _use_audit_log(monkeypatch, path).log_operation("dp", "success", {"eps": 1.0})
    path.write_text(path.read_text(encoding="utf-8").replace("1.0", "9.0"), encoding="utf-8")

    result = _run("verify-log")
    assert result.exit_code == EXIT_AUDIT_UNVERIFIED
    assert result.exit_code not in (0, EXIT_UNEXPECTED)
    assert "簽章不符" in result.output


def test_verify_log_without_key_is_not_reported_as_passed(tmp_path, monkeypatch):
    """沒有金鑰無從驗證：同樣回非零，不把「沒驗成」當成「驗過了」。"""
    from app.core.errors import EXIT_AUDIT_UNVERIFIED

    monkeypatch.delenv("OPEN_PETS_SYSTEM_MASTER_KEY", raising=False)
    _use_audit_log(monkeypatch, tmp_path / "audit.jsonl").log_operation("dp", "success", {})
    assert _run("verify-log").exit_code == EXIT_AUDIT_UNVERIFIED


def test_create_user_defaults_to_user_role(tmp_path, monkeypatch):
    """未指定 --role 時預設建 user。"""
    from app.governance.auth import AuthManager

    manager = AuthManager(db_path=str(tmp_path / "users.db"))
    monkeypatch.setattr("app.governance.auth._auth_manager", manager)

    assert _run("create-user", "-u", "plain", "-p", "pw123456").exit_code == 0
    assert manager.get_user("plain")["role"] == "user"
