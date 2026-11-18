"""K-匿名處理的記憶體優化：沒有違規列時列抑制不複製、處理可原地執行（inplace）。

500 萬列實測，列抑制的整份複製是 K-匿名處理的記憶體峰值（10.3 GiB）。這裡守的是
「省記憶體不改結果」：結果與報告和原本完全一致，預設行為（不改動呼叫端資料）不變。
"""
from dataclasses import asdict

import numpy as np
import pandas as pd
import pytest

from app.engines.anonymization import run_k_anonymity
from app.engines.anonymization.suppression import RowSuppressor


# ── 列抑制 ─────────────────────────────────────────────────────────────────

def _frame():
    return pd.DataFrame({"地區": ["北", "北", "南", "南", "中"], "值": [1, 2, 3, 4, 5]})


def test_row_suppressor_without_violations_returns_the_same_data_untouched():
    df = _frame()
    mask = pd.Series([False] * 5, index=df.index)
    out, outcome = RowSuppressor().suppress(df, mask, ["地區"], 0, len(df), 2)
    assert out is df  # 一列都不刪：不必複製
    pd.testing.assert_frame_equal(out, _frame())
    assert outcome.suppressed_count == 0 and outcome.rate_percent == 0.0


def test_row_suppressor_drops_violating_rows_and_does_not_share_data_with_the_input():
    df = _frame()
    mask = pd.Series([False, False, False, False, True], index=df.index)
    out, outcome = RowSuppressor().suppress(df, mask, ["地區"], 1, len(df), 2)
    assert list(out["地區"]) == ["北", "北", "南", "南"]
    assert outcome.suppressed_count == 1 and outcome.rate_percent == pytest.approx(20.0)
    out.loc[out.index[0], "值"] = 999  # 改結果不能影響呼叫端手上的資料
    assert list(df["值"]) == [1, 2, 3, 4, 5] and len(df) == 5


# ── inplace ────────────────────────────────────────────────────────────────

def test_inplace_gives_the_same_result_and_report_as_the_default(sample_df, sample_config, salt):
    kwargs = dict(
        config=sample_config, k=2, suppression_limit_percent=100,
        limit_exceeded_action="allow_with_warning", salt_key=salt,
    )
    out_default, report_default = run_k_anonymity(sample_df.copy(), **kwargs)
    out_inplace, report_inplace = run_k_anonymity(sample_df.copy(), inplace=True, **kwargs)
    pd.testing.assert_frame_equal(out_inplace.reset_index(drop=True), out_default.reset_index(drop=True))
    assert asdict(report_inplace) == asdict(report_default)


def test_default_leaves_the_callers_dataframe_untouched(sample_df, sample_config, salt):
    before = sample_df.copy()
    run_k_anonymity(sample_df, sample_config, k=2, suppression_limit_percent=100,
                    limit_exceeded_action="allow_with_warning", salt_key=salt)
    pd.testing.assert_frame_equal(sample_df, before)


def test_inplace_hashes_identifier_columns_in_the_callers_dataframe(sample_df, sample_config, salt):
    # sample_df 是整個測試工作階段共用的 fixture，原地處理會改動它，必須先複製，
    # 否則後面用到 sample_df 的測試（如 test_risk_subset）會讀到被雜湊過的姓名而失敗。
    df = sample_df.copy()
    original_names = list(df["姓名"])
    out, _ = run_k_anonymity(df, sample_config, k=2, suppression_limit_percent=100,
                             limit_exceeded_action="allow_with_warning", salt_key=salt,
                             inplace=True)
    assert list(df["姓名"]) != original_names  # 原地處理：呼叫端的資料已被改動
    assert all(len(v) == 64 for v in out["姓名"])


def test_inplace_row_suppression_with_many_rows_matches_the_default():
    """較大、有落單列的資料：原地處理與預設的輸出一致（含抑制掉的列數）。"""
    from app.core.config import ColumnConfig, ColumnInfo

    rng = np.random.default_rng(3)
    n = 600
    df = pd.DataFrame(
        {
            "編號": [f"ID{i:05d}" for i in range(n)],
            "地區": rng.choice(["北", "中", "南"] * 3 + ["離島"], n),
            "疾病": rng.choice(["甲", "乙", "丙"], n),
        }
    )
    df.loc[0, "地區"] = "孤島"  # 刻意製造一個落單的等價類
    config = ColumnConfig(
        columns={
            "編號": ColumnInfo(role="identifier", type="string"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    kwargs = dict(config=config, k=5, suppression_limit_percent=100,
                  limit_exceeded_action="allow_with_warning")
    out_default, rep_default = run_k_anonymity(df.copy(), **kwargs)
    out_inplace, rep_inplace = run_k_anonymity(df.copy(), inplace=True, **kwargs)
    assert len(out_default) < n  # 確認真的有刪列，覆蓋到「有違規列」的路徑
    pd.testing.assert_frame_equal(out_inplace.reset_index(drop=True), out_default.reset_index(drop=True))
    assert asdict(rep_inplace) == asdict(rep_default)
