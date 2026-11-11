"""★ TTC 2026-11-02：程式碼審查發現的運算引擎問題（邊界條件、數學正確性、無效輸入）
每項對應審查報告編號（E1…E20），修正前應失敗。
"""
import math

import numpy as np
import pandas as pd
import pytest

from app.core.config import ColumnConfig, ColumnInfo, DPColumnConfig, PreprocessConfig
from app.core.dataset_io import load_dataframe_with_format
from app.core.errors import PetsError
from app.engines.anonymization import run_k_anonymity
from app.engines.anonymization.strategies.generalize import categorical_mapping_generalize
from app.engines.anonymization.strategies.masking import hash_mask
from app.engines.dp import run_dp
from app.engines.dp.mechanisms import numeric as numeric_module
from app.engines.preprocess import run_preprocess
from app.engines.risk.subset import select_subgroup


# ── E1：DP 加噪前須先裁切到上下界 ────────────────────────────────────────


def test_e1_values_clipped_to_bounds_before_noise(monkeypatch):
    seen = {}
    real_apply = numeric_module.NumericNoiser.apply

    def spy(self, units, epsilon, delta, sensitivity):
        seen["max"] = units.max()
        return real_apply(self, units, epsilon, delta, sensitivity)

    monkeypatch.setattr(numeric_module.NumericNoiser, "apply", spy)
    df = pd.DataFrame({"薪資": [30000, 45000, 9_800_000]})
    config = DPColumnConfig(
        column_budgets={
            "薪資": {
                "type": "continuous", "epsilon_budget": 1.0, "sensitivity": 5000,
                "minimum_unit": 1, "clipping_bounds": [0, 200000],
            }
        }
    )
    run_dp(df, config)
    assert seen["max"] <= 200000  # 極端值須先夾到上界，雜訊才掩蓋得住


# ── E3：列抑制須重複到沒有違規列 ────────────────────────────────────────


def test_e3_row_suppression_repeats_until_k_holds():
    # X 靠 Y、Z 撐到 k；Y、Z 被刪後 X 落單，原本照樣釋出
    df = pd.DataFrame({"郵遞區號": ["1", "1", "1"], "年齡": [np.nan, 30, 40]})
    config = ColumnConfig(
        columns={
            "郵遞區號": ColumnInfo(role="quasi_identifier", type="categorical"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
        }
    )
    df_out, report = run_k_anonymity(
        df, config, k=3, suppression_limit_percent=100, limit_exceeded_action="allow_with_warning"
    )
    assert report.k_passed is True
    assert len(df_out) == 0
    assert report.suppressed_count == 3


# ── E4：時區日期不可崩潰 ────────────────────────────────────────────────


def test_e4_dp_datetime_with_timezone():
    df = pd.DataFrame({"時間": ["2024-03-15T10:00:00Z", "2024-03-16T10:00:00Z", "2024-04-01T00:00:00Z"]})
    config = DPColumnConfig(column_budgets={"時間": {"type": "datetime", "epsilon_budget": 1.0}})
    df_out, _ = run_dp(df, config)
    assert pd.to_datetime(df_out["時間"]).notna().all()


def test_e4_subgroup_date_bound_with_timezone():
    df = pd.DataFrame({"就診日": ["2024-01-01", "2024-03-15", "2024-07-01"]})
    res = select_subgroup(df, {"就診日": {"min": "2024-01-01T00:00:00+08:00", "max": "2024-06-30"}})
    assert "2024-03-15" in res.df["就診日"].tolist()
    assert "2024-07-01" not in res.df["就診日"].tolist()


# ── E5：k-RR 大 ε 不可溢位翻轉；非有限 ε 須拒絕 ───────────────────────


def test_e5_krr_huge_epsilon_keeps_values():
    df = pd.DataFrame({"性別": ["男", "女"] * 50})
    config = DPColumnConfig(column_budgets={"性別": {"type": "categorical", "epsilon_budget": 1000.0}})
    df_out, _ = run_dp(df, config)
    assert (df_out["性別"] == df["性別"]).all()


@pytest.mark.parametrize("bad", [math.nan, math.inf])
def test_e5_non_finite_epsilon_rejected(bad):
    df = pd.DataFrame({"性別": ["男", "女"]})
    config = DPColumnConfig(column_budgets={"性別": {"type": "categorical", "epsilon_budget": bad}})
    with pytest.raises(PetsError):
        run_dp(df, config)


def test_e5_non_finite_accumulated_rejected():
    df = pd.DataFrame({"年齡": [20, 30]})
    config = DPColumnConfig(
        column_budgets={"年齡": {"type": "continuous", "epsilon_budget": 1.0}},
        accumulated_epsilon=math.nan,
    )
    with pytest.raises(PetsError):
        run_dp(df, config)


# ── E19：sensitivity 須為有限正數 ──────────────────────────────────────


@pytest.mark.parametrize("bad", [0, -100, math.nan, math.inf])
def test_e19_invalid_sensitivity_rejected(bad):
    df = pd.DataFrame({"年齡": [20, 30, 40]})
    config = DPColumnConfig(
        column_budgets={"年齡": {"type": "continuous", "epsilon_budget": 1.0, "sensitivity": bad}}
    )
    with pytest.raises(PetsError):
        run_dp(df, config)


# ── E11：k／l／t 須驗證 ────────────────────────────────────────────────


def _two_qi_config():
    return ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )


@pytest.mark.parametrize(
    "kwargs",
    [{"k": 0}, {"k": -3}, {"k": 2, "l": 0}, {"k": 2, "t": -0.1}, {"k": 2, "t": 1.5}, {"k": 2, "t": math.nan}],
)
def test_e11_invalid_k_l_t_rejected(kwargs):
    df = pd.DataFrame({"地區": ["A", "A"], "疾病": ["x", "y"]})
    with pytest.raises(PetsError):
        run_k_anonymity(df, _two_qi_config(), suppression_limit_percent=100, **kwargs)


# ── E10：partial／clear 的敏感欄不做 l／t 假檢測 ────────────────────────


@pytest.mark.parametrize("strategy", ["partial", "clear"])
def test_e10_partially_masked_sensitive_skips_lt(strategy):
    df = pd.DataFrame({"地區": ["A", "A", "B", "B"], "身分": ["A123", "A999", "B111", "B222"]})
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "身分": ColumnInfo(role="sensitive", type="categorical", strategy=strategy),
        }
    )
    _, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100, l=2, salt_key="s")
    assert report.l_passed is False
    assert any("已套用遮蔽/雜湊" in rec for rec in report.recommendations)


# ── E12／E20：整數浮點（欄位含空值時 100 變 100.0）須與整數一致 ─────────


def test_e12_categorical_mapping_matches_integral_float():
    mapping = {"100": ["100", "北區"]}
    assert categorical_mapping_generalize(100.0, mapping, 1) == "北區"


def test_e20_hash_of_integral_float_equals_int():
    assert hash_mask(12345.0, salt="s") == hash_mask(12345, salt="s")


# ── E17：JSON 欄名像日期時不可把整數轉成日期 ──────────────────────────


def test_e17_json_date_like_column_names_not_converted():
    content = b'[{"created_at": 1700000000, "timestamp": 99999999}]'
    df, _ = load_dataframe_with_format(content, "d.json", None)
    assert df["created_at"].tolist() == [1700000000]
    assert df["timestamp"].tolist() == [99999999]


# ── E20：型別轉換保留科學記號；正則替換字串建置時即驗證 ──────────────


def test_e20_cast_scientific_notation():
    df = pd.DataFrame({"值": ["1e5", "1.5e3"]})
    out = run_preprocess(
        df,
        PreprocessConfig(columns=[{"column": "值", "actions": [{"action": "cast", "params": {"type": "float"}}]}]),
    )
    assert list(out["值"]) == [100000.0, 1500.0]


def test_e20_invalid_regex_replacement_rejected_up_front():
    df = pd.DataFrame({"備註": ["abc"]})
    config = PreprocessConfig(
        columns=[{
            "column": "備註",
            "actions": [{"action": "regex_replace", "params": {"pattern": "b", "replacement": "\\9"}}],
        }]
    )
    with pytest.raises(PetsError) as exc_info:
        run_preprocess(df, config)
    assert exc_info.value.error_code.startswith("ERR_PREPROCESS")
