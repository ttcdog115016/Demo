"""K-匿名引擎的值物件（Value Objects）。

比照 dataclass 慣例：純資料載體用 @dataclass 宣告欄位，
附 to_dict() 供 API 序列化（如 X-Quality-Report 標頭）。
"""
from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd

# 抑制率的計量單位：列抑制以「列」為分母、值抑制以「格」為分母。
# 具名於此是因為產生端（Suppressor.suppress）與承接端（QualityReport）分在兩個檔案，
# 各寫一份字面值會漂開。
SuppressionUnit = Literal["row", "cell"]


@dataclass
class SuppressionOutcome:
    """單次抑制的結果數據（Suppressor.suppress 的回傳內容，df 除外）。

    抑制率的分子分母以具名欄位帶出，讀報告的程式可直接取用。

    rate_percent    : 抑制率百分比（15.0 代表 15%）
    unit            : 計量單位，"row" 列基準 / "cell" 值（格）基準
    suppressed_count: 實際被抑制的數量（列數或格數，依 unit）
    total_count     : 計算抑制率的分母（原始列數或總格數，依 unit）
    desc            : 給建議清單用的人類可讀描述（含實際數字）
    suppressed_cells: 值抑制挖掉了哪些格子（列×QI 欄的布林表）；列抑制為 None。
                      填入的值可能是 *、空值或最高階層，k 檢測時要靠這張表認出來
    """

    rate_percent: float
    unit: SuppressionUnit
    suppressed_count: int
    total_count: int
    desc: str
    suppressed_cells: pd.DataFrame | None = None


@dataclass
class QualityReport:
    """
    匿名化品質報告。

    is_valid    : 整體是否達標（抑制率未超限，且 k／l／t 檢測皆通過）
    suppression_rate_percent: 抑制率百分比（15.0 代表 15%，依 suppression_unit 而定）；
                  與呼叫端的 suppression_limit_percent 同單位，可直接對照
    msg         : 人類可讀的結果訊息
    recommendations : 未達標時的調整建議（含實際數字估算之預期影響）
    k_passed    : 所有等價類是否均達到 k 值
    l_passed    : 敏感欄位多樣性是否達到 l 值（未指定 l 時為 True）
    t_passed    : 敏感欄位分佈距離是否在 t 門檻內（未指定 t 時為 True）
    suppression_unit: 抑制率計量單位，"row" 列基準 / "cell" 值（格）基準
    suppressed_count: 實際被抑制的數量；suppression_unit 為 "row" 時是列數、
                  "cell" 時是格數（＝抑制率的分子）
    suppression_total_count: 計算抑制率的分母；"row" 時是原始列數、"cell" 時是總格數
    applied_defaults: 使用者未提供、系統改用預設值的項目清單（報告透明：系統替使用者做的決定要告知）
    hash_algorithm: 本次假名化／雜湊遮蔽使用的演算法名稱
    hash_salted: 本次雜湊有沒有加鹽（鹽為選填，未提供時對值本身做雜湊）。
                  兩者都會改變輸出，故一併寫進報告——同一份資料兩次跑出不同結果時，
                  看報告即可知道差在哪，不必回頭問部署環境設了什麼。
    """

    is_valid: bool
    suppression_rate_percent: float
    msg: str
    recommendations: list[str] = field(default_factory=list)
    k_passed: bool = True
    l_passed: bool = True
    t_passed: bool = True
    suppression_unit: SuppressionUnit = "row"
    suppressed_count: int = 0
    suppression_total_count: int = 0
    applied_defaults: list[str] = field(default_factory=list)
    hash_algorithm: str = "sha3-256"
    hash_salted: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "is_valid": self.is_valid,
            "k_passed": self.k_passed,
            "l_passed": self.l_passed,
            "t_passed": self.t_passed,
            "suppression_rate_percent": self.suppression_rate_percent,
            "suppression_unit": self.suppression_unit,
            "suppressed_count": self.suppressed_count,
            "suppression_total_count": self.suppression_total_count,
            "hash_algorithm": self.hash_algorithm,
            "hash_salted": self.hash_salted,
            "message": self.msg,
            "recommendations": self.recommendations,
            "applied_defaults": self.applied_defaults,
        }
