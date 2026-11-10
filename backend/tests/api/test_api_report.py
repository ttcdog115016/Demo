"""
API - 報告產生端點 整合測試
涵蓋：POST /report 正常 PDF 產出、只帶一包、兩包皆缺
"""


ATTACK_REPORT = {
    "singling_out_risk": 0.07,
    "linkability_risk": 0.09,
    "inference_risk": 0.08,
    "sample_size": 1000,
    "linkability_evaluated": 500,
    "n_repeats": 1,
    "overlap_ratio": 0.0,
    "processing_config": {
        "method": "k-anon",
        "deid_params": {"k": 5, "suppression_limit_percent": 20},
        "risk_params": {"seed": 42, "ctrl_ratio": 0.2, "n_iter": 500, "n_subset": 500},
    },
    "message": "三攻擊風險評估完成。",
}

CAP_REPORT = {
    "cap_before": 0.82,
    "cap_after": 0.08,
    "n_original": 1000,
    "n_processed": 1000,
    "message": "CAP 前後對比完成。",
}

REPORT_PAYLOAD = {
    "task_id": "api-test-report-001",
    "attack_report": ATTACK_REPORT,
    "cap_report": CAP_REPORT,
}


def test_generate_report_success(client):
    """正常請求（三攻擊＋CAP）應回傳 200 與 PDF 內容"""
    resp = client.post("/api/v1/report", json=REPORT_PAYLOAD)
    assert resp.status_code == 200
    assert resp.headers.get("content-type", "").startswith("application/pdf")


def test_generate_report_starts_with_pdf_magic(client):
    """回傳的 PDF 應以 %PDF 魔術碼開頭"""
    resp = client.post("/api/v1/report", json=REPORT_PAYLOAD)
    assert resp.status_code == 200
    assert resp.content[:4] == b"%PDF"


def test_generate_report_content_disposition(client):
    """回應標頭應包含 Content-Disposition 且帶有正確的 task_id 檔名"""
    resp = client.post("/api/v1/report", json=REPORT_PAYLOAD)
    assert resp.status_code == 200
    disposition = resp.headers.get("content-disposition", "")
    assert "api-test-report-001" in disposition


def test_generate_report_attack_only(client):
    """只帶三攻擊報告（無 CAP）應正常產出 PDF"""
    payload = {"task_id": "attack-only", "attack_report": ATTACK_REPORT}
    resp = client.post("/api/v1/report", json=payload)
    assert resp.status_code == 200
    assert resp.content[:4] == b"%PDF"


def test_generate_report_cap_only(client):
    """只帶 CAP 報告（無三攻擊）應正常產出 PDF"""
    payload = {"task_id": "cap-only", "cap_report": CAP_REPORT}
    resp = client.post("/api/v1/report", json=payload)
    assert resp.status_code == 200
    assert resp.content[:4] == b"%PDF"


def test_generate_report_default_task_id(client):
    """未帶 task_id 應套用預設值、仍正常產出（task_id 有預設非必填）"""
    payload = {"attack_report": ATTACK_REPORT}
    resp = client.post("/api/v1/report", json=payload)
    assert resp.status_code == 200
    assert resp.content[:4] == b"%PDF"


def test_generate_report_both_missing(client):
    """attack_report 與 cap_report 皆未提供應回傳 400（無內容可產出）"""
    resp = client.post("/api/v1/report", json={"task_id": "empty"})
    assert resp.status_code == 400
