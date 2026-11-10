"""
報告產生引擎 單元測試
涵蓋：PDF bytes 產出、檔案寫入、處理配置回填、降級（-1.0）顯示、CAP-only 渲染、
      中文字型不依賴作業系統（內建打包）與字型缺席時的前置報錯
"""
import os
from pathlib import Path

import pytest

from app.governance import report
from app.governance.report import _BUNDLED_FONT, generate_pdf_bytes, generate_pdf_report


ATTACK_REPORT = {
    "singling_out_risk": 0.04,
    "linkability_risk": 0.06,
    "inference_risk": 0.05,
    "sample_size": 1000,
    "linkability_evaluated": 500,
    "n_repeats": 1,
    "overlap_ratio": 0.0,
    "processing_config": {
        "method": "k-anon",
        "deid_params": {"k": 5, "suppression_limit_percent": 20, "l": None},
        "risk_params": {"seed": 42, "ctrl_ratio": 0.2, "n_iter": 500, "n_subset": 500},
    },
    "message": "三攻擊風險評估完成。",
}

CAP_REPORT = {
    "cap_before": 0.8,
    "cap_after": 0.05,
    "n_original": 1000,
    "n_processed": 1000,
    "message": "CAP 前後對比完成。",
}

ATTACK_DEGRADED = {
    "singling_out_risk": -1.0,
    "linkability_risk": -1.0,
    "inference_risk": -1.0,
    "sample_size": 0,
    "message": "子群體條件篩選後為空，顯示之 -1.0 僅代表無法評估。",
}


def test_generate_pdf_bytes_returns_bytes():
    """generate_pdf_bytes 應回傳非空的 bytes 物件（三攻擊＋CAP）"""
    result = generate_pdf_bytes(
        task_id="unit-test-001", attack_report=ATTACK_REPORT, cap_report=CAP_REPORT
    )
    assert isinstance(result, bytes)
    assert len(result) > 0


def test_pdf_bytes_starts_with_pdf_magic():
    """產出的 bytes 應以 PDF 魔術碼 %PDF 開頭"""
    result = generate_pdf_bytes(task_id="unit-test-002", attack_report=ATTACK_REPORT)
    assert result[:4] == b"%PDF"


def test_generate_pdf_bytes_degraded_scores():
    """降級（-1.0 哨兵值）應正常渲染成無法評估、不拋出例外"""
    result = generate_pdf_bytes(task_id="unit-test-003", attack_report=ATTACK_DEGRADED)
    assert isinstance(result, bytes)
    assert len(result) > 0


def test_generate_pdf_bytes_cap_only():
    """只帶 CAP 報告（無三攻擊）也應正常產出 PDF（收到幾包排幾包）"""
    result = generate_pdf_bytes(task_id="unit-test-004", cap_report=CAP_REPORT)
    assert isinstance(result, bytes)
    assert len(result) > 0


@pytest.mark.parametrize(
    "kwargs, expected",
    [
        (
            {"attack_report": ATTACK_REPORT, "cap_report": CAP_REPORT},
            ["一、 隱私強化處理配置", "二、 再識別風險量測結果", "三、 量測說明"],
        ),
        # 只帶 CAP：沒有處理配置，量測結果即第一段，編號不跳號
        ({"cap_report": CAP_REPORT}, ["一、 再識別風險量測結果", "二、 量測說明"]),
    ],
)
def test_section_numbers_follow_actual_sections(monkeypatch, kwargs, expected):
    titles = []
    original = report._section_title
    monkeypatch.setattr(
        report, "_section_title", lambda pdf, text: (titles.append(text), original(pdf, text))
    )
    generate_pdf_bytes(task_id="unit-test-sections", **kwargs)
    assert titles == expected


def _rendered_cells(monkeypatch, **kwargs) -> list[str]:
    texts = []
    original = report.PETsSecurityReport.cell

    def record(self, w, h=None, text="", *args, **kw):
        texts.append(text)
        return original(self, w, h, text, *args, **kw)

    monkeypatch.setattr(report.PETsSecurityReport, "cell", record)
    generate_pdf_bytes(task_id="unit-test-cells", **kwargs)
    return texts


def test_seed_not_rendered(monkeypatch):
    """亂數種子不列入處理配置表；其餘風險參數照列"""
    texts = _rendered_cells(monkeypatch, attack_report=ATTACK_REPORT)
    assert "亂數種子" not in texts and "seed" not in texts
    assert "控制組比例" in texts


@pytest.mark.parametrize(
    "method, listed",
    [("row_suppression", False), ("cell_suppression", True)],
)
def test_cell_fill_rendered_only_for_cell_suppression(monkeypatch, method, listed):
    """報告 JSON 帶有值抑制填法時，僅值抑制列出；列抑制不列"""
    pc = ATTACK_REPORT["processing_config"]
    report_json = {
        **ATTACK_REPORT,
        "processing_config": {
            **pc,
            "deid_params": {**pc["deid_params"], "suppression_method": method, "cell_fill": "star"},
        },
    }
    texts = _rendered_cells(monkeypatch, attack_report=report_json)
    assert ("值抑制填法" in texts) is listed


def test_elapsed_seconds_rendered(monkeypatch):
    """報告帶有執行耗時即列出，三攻擊與 CAP 各一列"""
    texts = _rendered_cells(
        monkeypatch,
        attack_report={**ATTACK_REPORT, "elapsed_seconds": 280.75},
        cap_report={**CAP_REPORT, "elapsed_seconds": 39.97},
    )
    assert "三攻擊執行耗時:" in texts and "280.75 秒" in texts
    assert "CAP 前後對比執行耗時:" in texts and "39.97 秒" in texts


def test_elapsed_seconds_absent_not_rendered(monkeypatch):
    """報告不含執行耗時（降級或舊版報告）即不列"""
    texts = _rendered_cells(monkeypatch, attack_report=ATTACK_REPORT, cap_report=CAP_REPORT)
    assert not any("執行耗時" in t for t in texts)


def test_generate_pdf_bytes_dp_method():
    """差分隱私方法的處理配置應正常渲染"""
    dp_report = {
        **ATTACK_REPORT,
        "processing_config": {
            "method": "dp",
            "deid_params": {"accumulated_epsilon": 1.0, "default_delta": 1e-5},
            "risk_params": {"seed": 42},
        },
    }
    result = generate_pdf_bytes(task_id="unit-test-005", attack_report=dp_report)
    assert isinstance(result, bytes)
    assert len(result) > 0


def test_generate_pdf_report_writes_file(temp_dir):
    """generate_pdf_report 應將 PDF 寫入指定路徑並回傳絕對路徑"""
    out_path = os.path.join(temp_dir, "test_report.pdf")
    result_path = generate_pdf_report(
        task_id="unit-test-006",
        attack_report=ATTACK_REPORT,
        cap_report=None,
        out_path=out_path,
    )
    assert os.path.isfile(result_path)
    assert os.path.getsize(result_path) > 0


def test_bundled_font_is_packaged():
    """內建 CJK 字型須隨程式一併發布，否則未安裝中文字型的環境產不出中文報告。"""
    assert _BUNDLED_FONT.is_file()


def test_missing_bundled_font_fails_fast(monkeypatch, temp_dir):
    """內建字型缺席即報錯：不改用作業系統字型，也不等寫入中文才拋編碼例外。"""
    monkeypatch.setattr(report, "_BUNDLED_FONT", Path(temp_dir) / "not-exist.ttf")
    with pytest.raises(RuntimeError, match="無法載入內建中文字型"):
        generate_pdf_bytes(task_id="unit-test-008", attack_report=ATTACK_REPORT)


def test_generate_pdf_report_creates_parent_dirs(temp_dir):
    """generate_pdf_report 應自動建立不存在的父目錄"""
    out_path = os.path.join(temp_dir, "nested", "subdir", "report.pdf")
    result_path = generate_pdf_report(
        task_id="unit-test-007",
        attack_report=ATTACK_REPORT,
        cap_report=CAP_REPORT,
        out_path=out_path,
    )
    assert os.path.isfile(result_path)
