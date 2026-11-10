import os
from fpdf import FPDF
from fpdf.enums import XPos, YPos
from pathlib import Path
from typing import Any
from datetime import datetime

# 報告內容為中文，字型不可依賴部署環境是否安裝中文字型，故隨程式打包發布。
# Noto Sans TC（SIL Open Font License 1.1，授權全文見同目錄 OFL.txt）。
_FONT_FAMILY = "CJK"
_BUNDLED_FONT = Path(__file__).parent / "fonts" / "NotoSansTC-Regular.ttf"

# 參數欄位的中文顯示名（找不到就用原鍵名），供處理配置表格易讀。
_PARAM_LABELS = {
    "k": "k 值",
    "l": "l 值",
    "t": "t 值",
    "suppression_limit_percent": "抑制上限（%）",
    "limit_exceeded_action": "超限行為",
    "suppression_method": "抑制方式",
    "cell_fill": "值抑制填法",
    "n_iter": "指認性迭代次數",
    "ctrl_ratio": "控制組比例",
    "n_subset": "連結性子集大小",
    "n_repeats": "重複實驗輪數",
    "overlap_ratio": "跨輪重疊比例",
    "accumulated_epsilon": "已累計 ε",
    "accumulated_delta": "已累計 δ",
    "consumed_epsilon": "本次消耗 ε",
    "consumed_delta": "本次消耗 δ",
    "total_epsilon": "累計後 ε",
    "total_delta": "累計後 δ",
    "default_delta": "預設 δ",
}

# 處理配置中不列入報告的參數：亂數種子僅供重現數值，報告讀者無需判讀。
_HIDDEN_PARAMS = {"seed"}

# 段落編號（報告最多三段）。
_SECTION_NUMBERS = ("一", "二", "三")

# 去識別方法代碼 → 顯示名。
_METHOD_LABELS = {"k-anon": "K-匿名化", "dp": "差分隱私"}


def _fmt_pct(val: Any) -> str:
    """分數轉百分比；None 或 -1.0 降級哨兵值一律顯示無法評估（非 -100%）。"""
    if val is None:
        return "N/A"
    if isinstance(val, (int, float)) and val < 0:
        return "N/A（無法評估）"
    return f"{val * 100:.2f}%"


class PETsSecurityReport(FPDF):
    """去識別化與風險評估報告生成器"""

    def __init__(self):
        super().__init__()
        self._load_chinese_font()

    def _load_chinese_font(self):
        """載入內建打包的中文字型（常規與粗體共用同一字型檔）；缺席即前置報錯。

        字型隨程式一併發布，不讀取作業系統字型，各環境輸出一致。字型檔缺席時於產出
        報告前就失敗並指出缺少哪個檔案。
        """
        try:
            for style in ("", "B"):
                self.add_font(_FONT_FAMILY, style=style, fname=str(_BUNDLED_FONT))
        except Exception as exc:
            raise RuntimeError(
                f"無法載入內建中文字型 {_BUNDLED_FONT}，PDF 報告不能產出；"
                "該檔案隨程式一併發布，請確認安裝完整。"
            ) from exc

    def cell(self, w, h=None, text="", *args, **kwargs):
        # 處理過時的 ln 參數以消除棄用警告
        ln = kwargs.pop("ln", None)
        if ln is True:
            kwargs["new_x"] = XPos.LMARGIN
            kwargs["new_y"] = YPos.NEXT
        elif ln is False:
            kwargs["new_x"] = XPos.RIGHT
            kwargs["new_y"] = YPos.TOP
        return super().cell(w, h, text, *args, **kwargs)

    def header(self):
        # 頁首設計
        self.set_fill_color(31, 41, 55)
        self.rect(0, 0, 210, 15, "F")
        self.set_xy(10, 3)
        self.set_text_color(255, 255, 255)
        self.set_font(_FONT_FAMILY, "B", 10)
        self.cell(0, 8, "通用去識別化與隱私保護系統 - 再識別風險量測報告", align="L")
        self.set_xy(10, 15)
        self.ln(5)

    def footer(self):
        # 頁尾
        self.set_y(-15)
        self.set_font(_FONT_FAMILY, "", 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"第 {self.page_no()} 頁 / 共 {{nb}} 頁", align="C")


def _section_title(pdf: PETsSecurityReport, text: str) -> None:
    pdf.set_font(_FONT_FAMILY, "B", 14)
    pdf.set_text_color(31, 41, 55)
    pdf.cell(0, 8, text, ln=True)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(3)


def _render_processing_config(
    pdf: PETsSecurityReport, title: str, processing_config: dict[str, Any]
) -> None:
    """隱私強化處理配置——由風險引擎親手回填的方法與參數（非呼叫方手打）。"""
    _section_title(pdf, title)
    col_width, row_height = 55, 7

    pdf.set_fill_color(243, 244, 246)
    pdf.set_font(_FONT_FAMILY, "B", 10)
    pdf.cell(col_width, row_height, "設定項目", border=1, fill=True)
    pdf.cell(135, row_height, "配置細節", border=1, fill=True, ln=True)

    pdf.set_font(_FONT_FAMILY, "", 10)
    pdf.set_text_color(55, 65, 81)

    method = processing_config.get("method", "")
    pdf.cell(col_width, row_height, "去識別技術", border=1)
    pdf.cell(135, row_height, _METHOD_LABELS.get(method, method or "N/A"), border=1, ln=True)

    # 去識別參數 + 風險實驗參數；None（未指定）跳過不列，避免噪音。
    merged = {
        **processing_config.get("deid_params", {}),
        **processing_config.get("risk_params", {}),
    }
    # 列抑制不使用值抑制填法：報告 JSON 帶有 cell_fill 時亦不列
    row_suppression = merged.get("suppression_method") == "row_suppression"
    for key, val in merged.items():
        if val is None or key in _HIDDEN_PARAMS:
            continue
        if row_suppression and key == "cell_fill":
            continue
        label = _PARAM_LABELS.get(key, key.replace("_", " "))
        pdf.cell(col_width, row_height, label, border=1)
        pdf.cell(135, row_height, str(val), border=1, ln=True)
    pdf.ln(8)


def _render_risk_metrics(
    pdf: PETsSecurityReport,
    title: str,
    attack_report: dict[str, Any] | None,
    cap_report: dict[str, Any] | None,
) -> None:
    """再識別風險量測結果——三攻擊分數與 CAP 前後（收到幾包排幾包）。"""
    _section_title(pdf, title)
    row_height = 7
    pdf.set_font(_FONT_FAMILY, "", 10)
    pdf.set_text_color(31, 41, 55)

    rows = []
    if attack_report is not None:
        rows += [
            ("指認性攻擊成功率 (Singling Out):", attack_report.get("singling_out_risk")),
            ("連結性攻擊成功率 (Linkability):", attack_report.get("linkability_risk")),
            ("推斷性攻擊成功率 (Inference):", attack_report.get("inference_risk")),
        ]
    if cap_report is not None:
        rows += [
            ("處理前歸因機率 (CAP Before):", cap_report.get("cap_before")),
            ("處理後歸因機率 (CAP After):", cap_report.get("cap_after")),
        ]

    for label, val in rows:
        pdf.cell(90, row_height, label, ln=False)
        pdf.cell(40, row_height, _fmt_pct(val), ln=True)

    # 執行耗時：報告帶有才列（降級報告與舊版報告不含此欄）
    durations = [
        (label, report.get("elapsed_seconds"))
        for label, report in (
            ("三攻擊執行耗時:", attack_report),
            ("CAP 前後對比執行耗時:", cap_report),
        )
        if report is not None and report.get("elapsed_seconds") is not None
    ]
    for label, seconds in durations:
        pdf.cell(90, row_height, label, ln=False)
        pdf.cell(40, row_height, f"{seconds:.2f} 秒", ln=True)
    pdf.ln(8)


def _render_notes(pdf: PETsSecurityReport, title: str, messages: list[str]) -> None:
    """量測說明——如實揭露引擎對本次評估所做的說明（套用預設、子群體筆數、降級等）。"""
    _section_title(pdf, title)
    pdf.set_font(_FONT_FAMILY, "", 9)
    pdf.set_text_color(107, 114, 128)
    for msg in messages:
        pdf.multi_cell(0, 5, msg)
        pdf.ln(1)


def _build_pdf_object(
    task_id: str,
    attack_report: dict[str, Any] | None = None,
    cap_report: dict[str, Any] | None = None,
) -> PETsSecurityReport:
    """建立再識別風險量測 PDF 報告物件。

    彙整風險引擎回傳的報告 JSON（三攻擊 attack_report／CAP cap_report，至少一包），
    渲染「處理配置＋量測結果＋說明」三段。處理配置優先取 attack_report 內引擎親手回填的
    processing_config，故不需呼叫方另行手打方法／參數。規格 §3(4) 只要彙整量測結果，
    不做發布裁決，故不輸出綜合風險評級與發布門檻。
    """
    pdf = PETsSecurityReport()
    pdf.alias_nb_pages()
    pdf.add_page()

    # 標題
    pdf.set_y(25)
    pdf.set_text_color(17, 24, 39)
    pdf.set_font(_FONT_FAMILY, "B", 20)
    pdf.cell(0, 12, "再識別風險量測報告", ln=True, align="C")

    pdf.set_font(_FONT_FAMILY, "", 10)
    pdf.set_text_color(107, 114, 128)
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    pdf.cell(
        0, 6, f"報告編號: {task_id}   |   產出時間: {current_time}", ln=True, align="C"
    )
    pdf.ln(8)

    # 段落依實際有的內容排列並連續編號：只帶 CAP 時沒有處理配置，不留下跳號
    processing_config = (attack_report or {}).get("processing_config")
    messages = [
        report["message"]
        for report in (attack_report, cap_report)
        if report and report.get("message")
    ]
    sections = []
    if processing_config:
        sections.append(
            ("隱私強化處理配置", lambda t: _render_processing_config(pdf, t, processing_config))
        )
    sections.append(
        ("再識別風險量測結果", lambda t: _render_risk_metrics(pdf, t, attack_report, cap_report))
    )
    if messages:
        sections.append(("量測說明", lambda t: _render_notes(pdf, t, messages)))
    for number, (name, render) in zip(_SECTION_NUMBERS, sections):
        render(f"{number}、 {name}")

    return pdf


def generate_pdf_report(
    task_id: str,
    attack_report: dict[str, Any] | None,
    cap_report: dict[str, Any] | None,
    out_path: str,
) -> str:
    """產生再識別風險 PDF 報告並寫入檔案系統（CLI 用；API 走 bytes 版不落地）。"""
    pdf = _build_pdf_object(task_id, attack_report, cap_report)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    pdf.output(out_path)
    return os.path.abspath(out_path)


def generate_pdf_bytes(
    task_id: str,
    attack_report: dict[str, Any] | None = None,
    cap_report: dict[str, Any] | None = None,
) -> bytes:
    """產生再識別風險 PDF 報告並直接回傳 bytes（API StreamingResponse 用，不落地）。"""
    pdf = _build_pdf_object(task_id, attack_report, cap_report)
    return bytes(pdf.output())
