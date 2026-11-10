"""
API - 去識別化端點 整合測試
涵蓋：POST /api/v1/k-anonymity 正常去識別、欄位不吻合錯誤、缺少設定檔

參數（k、抑制方式、輸入格式等）一律隨大包設定檔提供，端點不收表單欄位；
本端點只用 k_anonymity 區塊，其餘區塊開啟與否不影響本次處理。
鹽值為機密，只由部署環境的 .env 提供，故各測試以 monkeypatch 設定它。
"""
import json
from urllib.parse import quote

import pytest

from app.core.errors import PetsError

BASE = "/api/v1"


@pytest.fixture(autouse=True)
def env_salt(monkeypatch):
    """端點只認 .env 的鹽值，所有測試共用同一個測試鹽值。"""
    monkeypatch.setenv("OPEN_PETS_DEFAULT_SALT", "test_salt")


def _config(payload, filename="config.json"):
    """設定檔上傳三元組；大包一律以 JSON 寫出。"""
    return (filename, payload, "application/json")


def test_anonymize_success(client, sample_csv_bytes, kanon_bundle):
    """正常去識別化：應回傳 200 與 CSV 內容，且包含 X-Quality-Report 標頭"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("content-type", "").startswith("text/csv")
    assert "X-Quality-Report" in resp.headers

    # Quality Report 應可被解析為合法 JSON
    report = json.loads(resp.headers["X-Quality-Report"])
    assert "suppression_rate_percent" in report


def test_anonymize_no_extension_with_input_format(
    client, sample_csv_bytes, bundle, kanon_block
):
    """上傳檔沒有副檔名時，於設定檔根層明講格式即可正常處理（本欄位的主情境）。"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("dataset_export", sample_csv_bytes, "application/octet-stream"),
            "config": _config(
                bundle(root={"input_format": "csv"}, k_anonymity=kanon_block())
            ),
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("content-type", "").startswith("text/csv")
    assert "X-Quality-Report" in resp.headers


def test_anonymize_input_format_decides_output_format(
    client, sample_csv_bytes, bundle, kanon_block
):
    """輸出沿用「判定出來的」輸入格式：設定檔指定 csv 的無副檔名檔案，回的就是 CSV。"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("dataset_export", sample_csv_bytes, "application/octet-stream"),
            "config": _config(
                bundle(root={"input_format": "csv"}, k_anonymity=kanon_block())
            ),
        },
    )
    assert resp.status_code == 200
    assert resp.content.splitlines()[0].decode("utf-8").count(",") > 0


def test_anonymize_quality_report_suppression_rate_percent(
    client, sample_csv_bytes, kanon_bundle
):
    """Quality Report 的 suppression_rate_percent 應介於 0 到 100 之間（與上限同單位）"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 200
    report = json.loads(resp.headers["X-Quality-Report"])
    assert 0 <= report["suppression_rate_percent"] <= 100


def test_suppression_limit_exceeded_returns_error(
    client, sample_csv_bytes, bundle, kanon_block, mocker
):
    """
    列抑制率超限 + limit_exceeded_action=stop_and_error
    真實情境：透過 Mock 強制觸發抑制率超限錯誤，驗證外層 API 是否正確轉換為 HTTP 422 與對應錯誤碼。
    請求本身合法、引擎也跑完了，是結果違反呼叫方自訂的門檻，故屬「內容講不通」而非「請求畸形」。
    """
    # 【關鍵 Mock 步驟】引擎拋帶錯誤碼的 PetsError，Mock 亦比照，才測得到真實路徑
    mocker.patch(
        "app.api.deid_router.run_k_anonymity",
        side_effect=PetsError(
            "ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED",
            "去識別化失敗：計算之抑制率已超過設定的最高上限。",
            recommendations=["建議提高準識別符 (QI) 欄位的泛化層級 (Level)。"],
        ),
    )

    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(
                bundle(
                    k_anonymity=kanon_block(
                        k=6,
                        suppression_limit_percent=10,
                        limit_exceeded_action="stop_and_error",
                    )
                )
            ),
        },
    )

    # 驗證外層 API 是否因為內部拋出錯誤，而正確回傳 422
    assert resp.status_code == 422

    # 驗證回傳的 JSON 錯誤碼與建議是否原樣傳出（建議由引擎給，介面不自行複寫）
    body = resp.json()
    assert body["error_code"] == "ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED"
    assert body["recommendations"]


def test_anonymize_config_mismatch(client, sample_csv_bytes, bundle):
    """欄位名稱與資料不吻合的設定檔：語法讀得懂但內容對不上資料，應回 422 並帶錯誤碼"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(
                bundle(
                    k_anonymity={
                        "columns": {"wrong_col": {"role": "identifier", "type": "string"}}
                    }
                )
            ),
        },
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error_code"] == "ERR_CONFIG_DATA_MISMATCH"


def test_anonymize_invalid_param_in_config(
    client, sample_csv_bytes, bundle, kanon_block
):
    """設定檔內的參數值不合法，由引擎擋下並回對應的錯誤碼。"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(
                bundle(k_anonymity=kanon_block(suppression_method="不存在的方式"))
            ),
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "ERR_INVALID_PARAM"


def test_anonymize_missing_file(client, kanon_bundle):
    """完全沒指定資料來源應回傳 400。

    file 與 source 二擇一、兩者皆為選填，故此情境由端點自行擋（ERR_INVALID_PARAM），
    而非框架的必填欄位檢查（422）。
    """
    resp = client.post(
        "/api/v1/k-anonymity",
        files={"config": _config(kanon_bundle)},
    )
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "ERR_INVALID_PARAM"


def test_anonymize_applied_defaults_reports_used_defaults(
    client, sample_csv_bytes, kanon_bundle
):
    """設定檔未填 k／抑制上限等參數 → 報告 applied_defaults 應逐一告知系統用了哪些預設"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 200
    report = json.loads(resp.headers["X-Quality-Report"])
    notes = "\n".join(report["applied_defaults"])
    assert "k=5" in notes           # 未填 k → 告知用了預設 5
    assert "抑制上限" in notes       # 未填 suppression_limit_percent → 告知
    assert "抑制方式" in notes       # 未填 suppression_method → 告知


def test_anonymize_without_env_salt_runs_unsalted(
    client, sample_csv_bytes, kanon_bundle, monkeypatch
):
    """伺服器未設定鹽值 → 不擋，改以無鹽雜湊照跑，並於報告載明本次沒加鹽。"""
    monkeypatch.delenv("OPEN_PETS_DEFAULT_SALT", raising=False)
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 200
    report = json.loads(resp.headers["X-Quality-Report"])
    assert report["hash_salted"] is False
    assert report["hash_algorithm"] == "sha3-256"


def test_anonymize_salt_key_in_form_is_not_accepted(
    client, sample_csv_bytes, kanon_bundle, monkeypatch
):
    """鹽值不接受由呼叫端傳入：表單帶了 salt_key 也不會被採用，仍以未設定論處。"""
    monkeypatch.delenv("OPEN_PETS_DEFAULT_SALT", raising=False)
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(kanon_bundle),
        },
        data={"salt_key": "caller_supplied_salt"},
    )
    assert resp.status_code == 200
    # 表單的 salt_key 未被採用：報告仍記為沒加鹽
    assert json.loads(resp.headers["X-Quality-Report"])["hash_salted"] is False


def test_anonymize_content_disposition(client, sample_csv_bytes, kanon_bundle):
    """回應標頭應包含 Content-Disposition 且帶有 anonymized_ 前綴的檔名"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 200
    disposition = resp.headers.get("content-disposition", "")
    assert "anonymized_data.csv" in disposition


def test_anonymize_chinese_filename(client, sample_csv_bytes, kanon_bundle):
    """中文檔名不得讓已算完的結果在回傳時變成 500，原檔名並須編碼保留"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("病患資料.csv", sample_csv_bytes, "text/csv"),
            "config": _config(kanon_bundle),
        },
    )
    assert resp.status_code == 200
    disposition = resp.headers.get("content-disposition", "")
    assert quote("anonymized_病患資料.csv", safe="") in disposition


# ── 大包設定檔：區塊開關與端點需求的對照 ────────────────────────────────────


def test_anonymize_requires_kanon_block(client, sample_csv_bytes, bundle, risk_block):
    """設定檔沒開 k_anonymity 區塊＝這次要跑什麼沒講清楚，擋下並指名缺哪一塊。"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(bundle(risk_cap=risk_block())),
        },
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error_code"] == "ERR_CONFIG_BLOCK_REQUIRED"
    assert "k_anonymity" in body["message"]


def test_anonymize_ignores_other_enabled_blocks(
    client, sample_csv_bytes, bundle, kanon_block, risk_block
):
    """同一份設定檔可放多種處理的區塊：本端點只取 k_anonymity，其餘開著也照跑。"""
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(
                bundle(k_anonymity=kanon_block(), risk_attacks=risk_block())
            ),
        },
    )
    assert resp.status_code == 200, resp.text


def test_anonymize_ignores_disabled_block_content(
    client, sample_csv_bytes, bundle, kanon_block
):
    """enabled: false 的區塊連內容都不看：裡面寫什麼都不該影響這次處理。"""
    payload = json.loads(bundle(k_anonymity=kanon_block()).decode("utf-8"))
    payload["differential_privacy"] = {"enabled": False, "亂寫的欄位": 123}
    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(json.dumps(payload, ensure_ascii=False).encode("utf-8")),
        },
    )
    assert resp.status_code == 200


def test_anonymize_config_version_is_audited(
    client, sample_csv_bytes, bundle, kanon_block, tmp_path, monkeypatch
):
    """設定檔版本寫進稽核紀錄，事後才查得到某次處理是用哪一版設定檔跑的。"""
    from app.governance.audit import AuditLogger

    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setattr(
        "app.governance.audit._audit_logger", AuditLogger(log_path=str(log_path))
    )

    resp = client.post(
        "/api/v1/k-anonymity",
        files={
            "file": ("data.csv", sample_csv_bytes, "text/csv"),
            "config": _config(
                bundle(root={"version": "2026-08-26_10-00-00"}, k_anonymity=kanon_block())
            ),
        },
    )
    assert resp.status_code == 200
    entries = [
        json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()
    ]
    assert entries[0]["parameters"]["config_version"] == "2026-08-26_10-00-00"
