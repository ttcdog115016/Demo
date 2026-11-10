"""CAP 前後對比獨立流程（CapAssessor）單元測試。

涵蓋（對齊 §3(1)B）：
  - 正常前後對比：回 CapReport、只含 CAP、不含攻擊指標
  - QI／敏感欄為空 → 降級 -1.0
  - 欄位不存在於前後資料 → fail fast
  - QI 含缺值的列不得被排除在分子外（否則 CAP 低估）
  - 敏感值缺值不進分子但仍留在分母、眾數平手取最大次數
"""
import numpy as np
import pandas as pd
import pytest

from app.engines.risk import CAPCalculator, CapAssessor
from app.engines.risk.types import CapReport


def test_cap_mode_report_structure(sample_df, processed_df):
    """正常流程：回 CapReport，前後 CAP 在合法範圍，且不含攻擊指標。"""
    report = CapAssessor(["年齡", "地區", "職業"], ["疾病"]).run(sample_df, processed_df)
    assert isinstance(report, CapReport)
    assert 0.0 <= report.cap_before <= 1.0
    assert 0.0 <= report.cap_after <= 1.0
    assert report.n_original == len(sample_df)
    assert report.n_processed == len(processed_df)
    # CAP 獨立路徑不含三攻擊指標
    assert not hasattr(report, "singling_out_risk")


def test_cap_mode_qi_empty_degrade(sample_df, processed_df):
    """QI 為空 → 前後 CAP 皆降級 -1.0。"""
    report = CapAssessor([], ["疾病"]).run(sample_df, processed_df)
    assert report.cap_before == -1.0
    assert report.cap_after == -1.0
    assert "警告" in report.message


def test_cap_mode_sensitive_empty_degrade(sample_df, processed_df):
    """無敏感欄 → 降級 -1.0。"""
    report = CapAssessor(["年齡"], []).run(sample_df, processed_df)
    assert report.cap_before == -1.0
    assert "敏感欄位數量為 0" in report.message


def test_cap_counts_rows_with_missing_qi():
    """QI 帶缺值的列仍須進分子，否則機率被分母稀釋。

    兩份資料結構相同（每組皆百分百可猜中），差別只在後半段 QI 是缺值或實值，
    CAP 應同為 1.0；若排除缺值列會算成 0.5。
    """
    with_nan = pd.DataFrame(
        {"地區": ["a", "a", np.nan, np.nan], "疾病": ["x", "x", "y", "y"]}
    )
    without_nan = pd.DataFrame(
        {"地區": ["a", "a", "b", "b"], "疾病": ["x", "x", "y", "y"]}
    )
    calc = CAPCalculator()
    assert calc.calculate(with_nan, ["地區"], "疾病") == 1.0
    assert calc.calculate(without_nan, ["地區"], "疾病") == 1.0


def test_cap_missing_sensitive_values_not_attributable():
    """敏感值缺值不算進分子（猜不中「沒有值」），但那幾列仍留在分母。

    四列同一組、其中兩列疾病缺值：可猜中的只有 x 那兩列 → 2/4。
    """
    df = pd.DataFrame(
        {"地區": ["a", "a", "a", "a"], "疾病": ["x", "x", np.nan, np.nan]}
    )
    assert CAPCalculator().calculate(df, ["地區"], "疾病") == 0.5


def test_cap_all_sensitive_missing_returns_zero():
    """整份資料的敏感值全缺 → 無可歸因目標，CAP 為 0。"""
    df = pd.DataFrame({"地區": ["a", "a", "b"], "疾病": [np.nan, np.nan, np.nan]})
    assert CAPCalculator().calculate(df, ["地區"], "疾病") == 0.0


def test_cap_tied_mode_uses_max_count():
    """組內眾數平手時取最大次數（攻擊者挑其中一個猜）：兩列各一種值 → 1/2。"""
    df = pd.DataFrame({"地區": ["a", "a"], "疾病": ["x", "y"]})
    assert CAPCalculator().calculate(df, ["地區"], "疾病") == 0.5


def test_cap_multiple_qi_columns():
    """多欄 QI 以組合分組：(a,1) 組兩列各一種值貢獻 1、(b,2) 組獨一列貢獻 1 → 2/3。"""
    df = pd.DataFrame(
        {
            "地區": ["a", "a", "b"],
            "年齡": [1, 1, 2],
            "疾病": ["x", "y", "z"],
        }
    )
    result = CAPCalculator().calculate(df, ["地區", "年齡"], "疾病")
    assert result == pytest.approx(2 / 3)


def test_cap_missing_qi_and_missing_sensitive_together():
    """QI 缺值自成一組、敏感缺值不進分子，兩種缺值同時出現仍須各自照規則計算。

    地區 a 組（兩列皆 x）貢獻 2；地區缺值組三列中兩列為 y、一列疾病缺值，貢獻 2 → 4/5。
    """
    df = pd.DataFrame(
        {
            "地區": ["a", "a", np.nan, np.nan, np.nan],
            "疾病": ["x", "x", "y", "y", np.nan],
        }
    )
    assert CAPCalculator().calculate(df, ["地區"], "疾病") == 0.8


def test_cap_mode_missing_column_rejected(sample_df, processed_df):
    """欄位不存在於資料 → 前置擋（fail fast）。"""
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH"):
        CapAssessor(["年齡", "不存在欄"], ["疾病"]).run(sample_df, processed_df)
