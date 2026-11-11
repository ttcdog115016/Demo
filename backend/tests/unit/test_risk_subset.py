"""子群體篩選（select_subgroup）單元測試。

涵蓋（對齊 §3(1)C.ii）：
  - 無條件＝原樣回傳、前後筆數相同
  - 數值閉區間（min/max 皆含、可只給一側）
  - 類別 isin
  - 多欄 AND
  - 欄位不存在／條件畸形 → fail fast
  - 空群不擋（回空 df）、非數值欄套區間不爆並備註
  - 日期區間（日期字串邊界、可只給一側、轉不動者落選並備註、與數值混用擋）
"""
import pandas as pd
import pytest

from app.engines.risk import SubsetResult, select_subgroup


def test_no_conditions_returns_all(sample_df):
    """無條件（None／空 dict）＝不限定，原樣回傳、前後筆數相同。"""
    for cond in (None, {}):
        res = select_subgroup(sample_df, cond)
        assert isinstance(res, SubsetResult)
        assert res.n_before == res.n_after == len(sample_df)
        assert res.df is sample_df
        assert res.notes == []


def test_range_closed_interval_inclusive(sample_df):
    """數值區間為閉區間：min／max 兩端皆含（年齡 25、45 落在 [25,45]）。"""
    res = select_subgroup(sample_df, {"年齡": {"min": 25, "max": 45}})
    ages = res.df["年齡"].tolist()
    assert min(ages) == 25 and max(ages) == 45
    assert res.n_after == len(res.df)
    assert all(25 <= a <= 45 for a in ages)


def test_range_one_sided(sample_df):
    """區間可只給一側：只給 min＝下界過濾、上界不限。"""
    res = select_subgroup(sample_df, {"年齡": {"min": 50}})
    assert res.df["年齡"].tolist() == [50, 55]


def test_categorical_isin(sample_df):
    """類別集合＝isin：只留地區落在清單內的紀錄。"""
    res = select_subgroup(sample_df, {"地區": ["大安區", "信義區"]})
    assert set(res.df["地區"]) == {"大安區", "信義區"}
    assert res.n_after == 4


def test_multi_column_and(sample_df):
    """多欄並列＝AND：同時滿足年齡區間與地區集合。"""
    res = select_subgroup(
        sample_df, {"年齡": {"min": 25, "max": 30}, "地區": ["大安區"]}
    )
    # 年齡 25、27 在大安區；29 在信義區被地區條件排除
    assert res.df["姓名"].tolist() == ["user_0", "user_1"]


def test_missing_column_blocks(sample_df):
    """條件引用不存在欄位 → fail fast（資料層對不上）。"""
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH"):
        select_subgroup(sample_df, {"不存在的欄": [1, 2]})


def test_malformed_condition_blocks(sample_df):
    """條件既非 list 也非區間 dict → 擋（無可解讀降級語意）。"""
    with pytest.raises(ValueError, match="ERR_SUBSET_COND_MALFORMED"):
        select_subgroup(sample_df, {"年齡": "30-40"})


def test_empty_range_dict_blocks(sample_df):
    """區間 dict 未給 min 也未給 max → 擋。"""
    with pytest.raises(ValueError, match="ERR_SUBSET_COND_MALFORMED"):
        select_subgroup(sample_df, {"年齡": {}})


def test_non_numeric_range_bound_blocks(sample_df):
    """區間邊界非數值（含 bool）→ 擋。"""
    with pytest.raises(ValueError, match="ERR_SUBSET_COND_MALFORMED"):
        select_subgroup(sample_df, {"年齡": {"min": "老"}})
    with pytest.raises(ValueError, match="ERR_SUBSET_COND_MALFORMED"):
        select_subgroup(sample_df, {"年齡": {"min": True}})


def test_empty_subgroup_not_blocked(sample_df):
    """篩不到（空群）不擋：回空 df、前後筆數如實揭露。"""
    res = select_subgroup(sample_df, {"年齡": {"min": 200}})
    assert res.n_before == len(sample_df)
    assert res.n_after == 0
    assert len(res.df) == 0


def test_range_on_non_numeric_column_does_not_raise():
    """非數值欄套區間＝不擋不爆：轉不動者落選並備註告知。"""
    df = pd.DataFrame({"代碼": ["10", "20", "壞值", "40"]})
    res = select_subgroup(df, {"代碼": {"min": 15, "max": 30}})
    # "20" 落在區間；"壞值" 轉不成數字而落選、不拋例外
    assert res.df["代碼"].tolist() == ["20"]
    assert any("非數值內容" in n for n in res.notes)


def _visit_df():
    return pd.DataFrame(
        {"就診日": ["2024-01-01", "2024-03-15", "2024-06-30 23:59", "2024-07-01", "2023/12/31"]}
    )


def test_date_range_both_sides_inclusive():
    """日期區間兩側皆給：閉區間；只給日期時 max 當天任何時刻皆含。"""
    res = select_subgroup(_visit_df(), {"就診日": {"min": "2024-01-01", "max": "2024-06-30"}})
    assert res.df["就診日"].tolist() == ["2024-01-01", "2024-03-15", "2024-06-30 23:59"]
    assert res.notes == []


def test_date_range_one_sided():
    """日期區間可只給一側。"""
    res = select_subgroup(_visit_df(), {"就診日": {"min": "2024-06-30"}})
    assert res.df["就診日"].tolist() == ["2024-06-30 23:59", "2024-07-01"]
    res = select_subgroup(_visit_df(), {"就診日": {"max": "2023-12-31"}})
    assert res.df["就診日"].tolist() == ["2023/12/31"]


def test_date_range_unparseable_rows_dropped_with_note():
    """日期區間下轉不成日期者落選、不拋例外，並備註；空值不計入備註。"""
    df = pd.DataFrame({"就診日": ["2024-02-01", "不詳", None, "2024-05-05"]})
    res = select_subgroup(df, {"就診日": {"min": "2024-01-01", "max": "2024-12-31"}})
    assert res.df["就診日"].tolist() == ["2024-02-01", "2024-05-05"]
    assert any("1 筆非日期內容" in n for n in res.notes)


def test_date_range_mixed_or_bad_bounds_block():
    """一側數值一側日期、或日期字串無法解析 → 擋。"""
    with pytest.raises(ValueError, match="ERR_SUBSET_COND_MALFORMED"):
        select_subgroup(_visit_df(), {"就診日": {"min": "2024-01-01", "max": 5}})
    with pytest.raises(ValueError, match="ERR_SUBSET_COND_MALFORMED"):
        select_subgroup(_visit_df(), {"就診日": {"min": "2024-13-45"}})
    with pytest.raises(ValueError, match="ERR_SUBSET_COND_MALFORMED"):
        select_subgroup(_visit_df(), {"就診日": {"min": "30"}})
