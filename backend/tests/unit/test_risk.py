"""
再識別風險引擎 工人單元測試。

三攻擊主流程見 test_risk_mode.py、CAP 見 test_risk_cap_mode.py；
本檔聚焦共用工人：
  - 前置驗證器 RiskInputValidator（角色重疊／欄位存在／自訂 A/B 成對互斥存在）
  - 純量參數前置擋 check_scalar_params（seed 負值／n_repeats 非正整數）
  - 推斷性目標欄位可行性 check_inference_feasible（相異值佔比／估算規模兩層判準）
  - 切分器 RepeatedSplitter（單輪為 n_repeats=1 之特例）
  - 三攻擊各自的基準攻擊（型別分支／隨機查詢／隨機配對）
"""
import sys

import numpy as np
import pandas as pd
import pytest

from app.engines.risk import (
    InferenceAttack,
    LinkabilityAttack,
    RepeatedSplitter,
    RiskInputValidator,
    SinglingOutAttack,
)
from app.engines.risk import validation
from app.engines.risk.validation import (
    check_inference_feasible,
    check_scalar_params,
    estimate_forest_bytes,
)


# ---------- 前置驗證器 RiskInputValidator（需比對資料的擋） ----------


def test_validator_qi_sensitive_overlap_rejected(sample_df, processed_df):
    """QI∩sensitive 重疊 → 前置擋（推斷性會變成拿欄位預測它自己）。"""
    with pytest.raises(ValueError, match="ERR_RISK_ROLE_OVERLAP"):
        RiskInputValidator().validate(
            sample_df, processed_df, qi_cols=["年齡", "疾病"], sensitive_cols=["疾病"]
        )


def test_validator_missing_column_rejected(sample_df, processed_df):
    """QI 欄位不存在於資料 → 前置擋（fail fast，不拋不可讀的 KeyError）。"""
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH"):
        RiskInputValidator().validate(
            sample_df, processed_df, qi_cols=["年齡", "不存在欄"], sensitive_cols=["疾病"]
        )


def test_validator_custom_ab_incomplete_rejected(sample_df, processed_df):
    """自訂連結性只給 A 沒給 B → 前置擋（須成對）。"""
    with pytest.raises(ValueError, match="ERR_LINK_AB_INCOMPLETE"):
        RiskInputValidator().validate(
            sample_df, processed_df, qi_cols=["年齡", "地區"], sensitive_cols=["疾病"],
            link_cols_a=["年齡"],
        )


def test_validator_custom_ab_overlap_rejected(sample_df, processed_df):
    """自訂 A、B 有共同欄位 → 前置擋（垂直切割要求一欄只在一邊）。"""
    with pytest.raises(ValueError, match="ERR_LINK_AB_OVERLAP"):
        RiskInputValidator().validate(
            sample_df, processed_df, qi_cols=["年齡", "地區"], sensitive_cols=["疾病"],
            link_cols_a=["年齡", "地區"], link_cols_b=["地區"],
        )


def test_validator_custom_ab_missing_col_rejected(sample_df, processed_df):
    """自訂 A/B 引用不存在欄位 → 前置擋。"""
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH"):
        RiskInputValidator().validate(
            sample_df, processed_df, qi_cols=["年齡", "地區"], sensitive_cols=["疾病"],
            link_cols_a=["年齡"], link_cols_b=["不存在欄"],
        )


def test_check_scalar_params_negative_seed_rejected():
    """seed 負值無降級語意且會使 RNG 拋錯 → 入口前置擋。"""
    with pytest.raises(ValueError, match="ERR_INVALID_PARAM"):
        check_scalar_params(seed=-1)


def test_check_scalar_params_non_positive_n_repeats_rejected():
    """n_repeats（重複實驗輪數）非正整數無降級語意 → 入口前置擋。"""
    with pytest.raises(ValueError, match="ERR_INVALID_PARAM"):
        check_scalar_params(n_repeats=0)
    with pytest.raises(ValueError, match="ERR_INVALID_PARAM"):
        check_scalar_params(n_repeats=-1)


# ---------- 推斷性目標欄位的可行性判準（兩層，皆不綁特定硬體規格） ----------


def test_estimate_forest_bytes_scales_with_class_count():
    """估算＝相異值數 × 節點數上界 × 樹數 × 每格位元組，與相異值數成正比。"""
    assert estimate_forest_bytes(1) == 2047 * 50 * 8
    assert estimate_forest_bytes(1000) == 1000 * estimate_forest_bytes(1)


def test_check_inference_feasible_allows_enumerable_target():
    """相異值少、規模估算無虞的類別欄 → 回 None（照常執行）。"""
    df = pd.DataFrame({"疾病": ["A", "B", "C"] * 20})
    assert check_inference_feasible(df, "疾病") is None


def test_check_inference_feasible_blocks_when_classes_exceed_half():
    """相異值超過筆數之半 → 不構成可列舉的分類目標，第一層即擋。"""
    df = pd.DataFrame({"薪資": range(100)})
    msg = check_inference_feasible(df, "薪資")
    assert msg is not None
    assert "超過資料筆數" in msg and "推斷性未執行" in msg


def test_check_inference_feasible_skips_ratio_rule_on_tiny_sample():
    """樣本數未超過 20 時比例判準不適用（同 sklearn），不因此擋。"""
    df = pd.DataFrame({"薪資": range(20)})
    assert check_inference_feasible(df, "薪資") is None


def test_check_inference_feasible_blocks_beyond_supported_scale(monkeypatch):
    """第一層過關但估算規模超出本次執行環境可支援者 → 第二層擋。"""
    monkeypatch.setattr(validation, "available_memory_bytes", lambda: 1)
    df = pd.DataFrame({"疾病": ["A", "B", "C"] * 20})
    msg = check_inference_feasible(df, "疾病")
    assert msg is not None
    assert "超出本次執行環境可支援之評估規模" in msg


def test_available_memory_bytes_returns_none_without_psutil(monkeypatch):
    """psutil 屬選用相依、交付映像檔不含它：缺了要回 None，不可讓引擎 import 失敗。"""
    monkeypatch.setattr(validation, "_read_cgroup_bytes", lambda path: None)
    monkeypatch.setitem(sys.modules, "psutil", None)  # 令 import psutil 拋 ImportError
    assert validation.available_memory_bytes() is None


def test_check_inference_feasible_keeps_behaviour_when_capacity_unknown(monkeypatch):
    """取不到可用量時不做假設，不套用此判準（照常執行）。"""
    monkeypatch.setattr(validation, "available_memory_bytes", lambda: None)
    df = pd.DataFrame({"疾病": ["A", "B", "C"] * 20})
    assert check_inference_feasible(df, "疾病") is None


# ---------- 切分器（交叉驗證次數＋跨輪抽樣重疊比例；單輪＝n_repeats=1 特例） ----------


@pytest.fixture
def hundred_df():
    return pd.DataFrame({"值": range(100)})


def test_repeated_splitter_partition_per_round(hundred_df):
    """每輪 (ori, ctrl) 應互斥且聯集為全體，大小依 ctrl_ratio"""
    splitter = RepeatedSplitter(ctrl_ratio=0.2, overlap_ratio=0.5)
    for ori, ctrl in splitter.splits(hundred_df, n_repeats=3):
        assert len(ctrl) == 20 and len(ori) == 80
        assert len(ori.index.intersection(ctrl.index)) == 0
        assert len(ori.index.union(ctrl.index)) == 100


def test_repeated_splitter_overlap_zero_is_kfold(hundred_df):
    """overlap=0＋ctrl_ratio=0.2＋5 輪＝5-fold：各輪 ctrl 互斥且聯集涵蓋全體"""
    splitter = RepeatedSplitter(ctrl_ratio=0.2, overlap_ratio=0.0)
    ctrl_sets = [set(ctrl.index) for _, ctrl in splitter.splits(hundred_df, n_repeats=5)]
    seen = set()
    for s in ctrl_sets:
        assert not (s & seen), "優先抽未當過者：全員輪過前不應回收舊人"
        seen |= s
    assert seen == set(range(100))


def test_repeated_splitter_recycles_after_full_coverage(hundred_df):
    """全員輪過後才回收：第 6 輪必然重用舊人，但仍與第 5 輪互斥（overlap=0）"""
    splitter = RepeatedSplitter(ctrl_ratio=0.2, overlap_ratio=0.0)
    ctrl_sets = [set(ctrl.index) for _, ctrl in splitter.splits(hundred_df, n_repeats=6)]
    assert not (ctrl_sets[5] & ctrl_sets[4])
    assert ctrl_sets[5] <= set().union(*ctrl_sets[:5])


def test_repeated_splitter_adjacent_overlap_ratio(hundred_df):
    """overlap=0.5：相鄰兩輪 ctrl 精確共用一半的人（鏈式定義）"""
    splitter = RepeatedSplitter(ctrl_ratio=0.2, overlap_ratio=0.5)
    ctrl_sets = [set(ctrl.index) for _, ctrl in splitter.splits(hundred_df, n_repeats=4)]
    for prev, curr in zip(ctrl_sets, ctrl_sets[1:]):
        assert len(prev & curr) == 10


def test_repeated_splitter_reproducible(hundred_df):
    """相同 seed 應產出完全相同的切分序列；不同 seed 應不同"""
    same_a = [set(c.index) for _, c in RepeatedSplitter(seed=7).splits(hundred_df, 3)]
    same_b = [set(c.index) for _, c in RepeatedSplitter(seed=7).splits(hundred_df, 3)]
    diff = [set(c.index) for _, c in RepeatedSplitter(seed=8).splits(hundred_df, 3)]
    assert same_a == same_b
    assert same_a != diff


def test_repeated_splitter_invalid_params_rejected(hundred_df):
    """純參數錯誤建構時擋；資料面不可行設定於 splits 入口擋"""
    with pytest.raises(ValueError, match="ERR_INVALID_PARAM"):
        RepeatedSplitter(ctrl_ratio=1.5)
    with pytest.raises(ValueError, match="ERR_INVALID_PARAM"):
        RepeatedSplitter(overlap_ratio=-0.1)
    # 驗證前置：呼叫 splits() 當下即擋，不必等到開始迭代
    with pytest.raises(ValueError, match="ERR_INVALID_PARAM"):
        RepeatedSplitter().splits(hundred_df, n_repeats=0)
    # ctrl 60%＋overlap=0：每輪需 60 筆新血但池子只剩 40 筆 → 不可行
    with pytest.raises(ValueError, match="ERR_SPLIT_INFEASIBLE"):
        RepeatedSplitter(ctrl_ratio=0.6, overlap_ratio=0.0).splits(hundred_df, 2)


# ---------- 推斷性基準攻擊：型別分支（數值型輸出中位數） ----------


def test_inference_baseline_numeric_uses_median():
    """數值型敏感欄的基準攻擊應以 syn 中位數為天真輸出，非一律眾數。

    syn 收入中位數＝30；ori 收入有兩筆恰為 30 → s_base＝2/4＝0.5。
    """
    syn = pd.DataFrame({"年齡": [20, 30, 40, 50, 60], "收入": [10, 20, 30, 40, 50]})
    ori = pd.DataFrame({"年齡": [21, 31, 41, 51], "收入": [30, 30, 99, 88]})
    ctrl = pd.DataFrame({"年齡": [22, 32], "收入": [30, 5]})
    _, _, s_base = InferenceAttack().run(
        syn, ori, ctrl, qi_cols=["年齡"], sensitive_col="收入",
        rng=np.random.default_rng(0),
    )
    assert s_base == pytest.approx(0.5)


def test_inference_baseline_categorical_uses_mode():
    """類別型敏感欄的基準攻擊以 syn 眾數為天真輸出。"""
    syn = pd.DataFrame({"年齡": [20, 30, 40, 50], "疾病": ["A", "A", "A", "B"]})
    ori = pd.DataFrame({"年齡": [21, 31, 41, 51], "疾病": ["A", "A", "B", "B"]})
    ctrl = pd.DataFrame({"年齡": [22, 32], "疾病": ["A", "C"]})
    _, _, s_base = InferenceAttack().run(
        syn, ori, ctrl, qi_cols=["年齡"], sensitive_col="疾病",
        rng=np.random.default_rng(0),
    )
    assert s_base == pytest.approx(0.5)


# ---------- 指認性基準攻擊：隨機查詢命中唯一一筆 ----------


def test_singling_out_baseline_one_when_key_unique():
    """單一唯一鍵欄：任何隨機值查詢都恰命中 1 筆 → s_base=1.0。"""
    df = pd.DataFrame({"編號": [1, 2, 3, 4, 5]})
    _, _, s_base = SinglingOutAttack().run(
        df, df, df, qi_cols=["編號"], n_iter=100, rng=np.random.default_rng(0),
    )
    assert s_base == 1.0


def test_singling_out_baseline_zero_when_no_unique_match():
    """每個值都對應多筆時，隨機查詢永遠命不中唯一一筆 → s_base=0.0。"""
    df = pd.DataFrame({"地區": ["A", "A", "A", "B", "B"]})
    _, _, s_base = SinglingOutAttack().run(
        df, df, df, qi_cols=["地區"], n_iter=100, rng=np.random.default_rng(0),
    )
    assert s_base == 0.0


def test_singling_out_match_count_handles_special_chars():
    """含單引號等特殊字元的值：遮罩比對能正確數到符合筆數，不因查詢語法拋錯。"""
    df = pd.DataFrame({"姓名": ["O'Brien", "Wang", "Lee"], "地區": ["A", "B", "A"]})
    assert SinglingOutAttack._match_count(df, {"姓名": "O'Brien"}) == 1
    assert SinglingOutAttack._match_count(df, {"姓名": "O'Brien", "地區": "A"}) == 1
    assert SinglingOutAttack._match_count(df, {"姓名": "查無此人"}) == 0


def test_singling_out_match_count_missing_value_is_a_category():
    """條件值為缺值時以「該欄為缺值」查詢：唯一一筆缺值的紀錄能被單獨指認。"""
    df = pd.DataFrame(
        {"職業": ["工程師", None, "教師", "教師"], "年齡": [30.0, 40.0, np.nan, np.nan]}
    )
    assert SinglingOutAttack._match_count(df, {"職業": None}) == 1
    assert SinglingOutAttack._match_count(df, {"職業": np.nan}) == 1
    assert SinglingOutAttack._match_count(df, {"年齡": np.nan}) == 2
    assert SinglingOutAttack._match_count(df, {"職業": "教師", "年齡": np.nan}) == 2
    assert SinglingOutAttack._match_count(df, {"職業": "工程師", "年齡": np.nan}) == 0


# ---------- 連結性基準攻擊：隨機抽兩次 index 配對 ----------


def test_linkability_baseline_draws_over_syn_index_space():
    """基準在整份 syn 的列號範圍亂抽兩次：syn 100 列、ori/ctrl 僅 5 列時
    n_sample=5、列號空間 100，幾乎不碰撞 → s_base=0.0。"""
    syn = pd.DataFrame({"年齡": list(range(100)), "地區": ["A", "B"] * 50})
    small = pd.DataFrame({"年齡": list(range(5)), "地區": ["A", "B", "A", "B", "A"]})
    _, _, s_base, n_eval = LinkabilityAttack().run(
        syn, small, small, qi_cols=["年齡", "地區"], rng=np.random.default_rng(0),
    )
    assert s_base == 0.0
    assert n_eval == 5  # 受最小的 ori/ctrl（各 5 列）所限


def test_linkability_baseline_reproducible_and_bounded():
    """基準為實際模擬：同 seed 兩次結果一致，且落在 [0, 1]。"""
    syn = pd.DataFrame({"年齡": list(range(100)), "地區": ["A", "B"] * 50})
    small = pd.DataFrame({"年齡": list(range(5)), "地區": ["A", "B", "A", "B", "A"]})
    kw = dict(qi_cols=["年齡", "地區"])
    a = LinkabilityAttack().run(syn, small, small, rng=np.random.default_rng(7), **kw)[2]
    b = LinkabilityAttack().run(syn, small, small, rng=np.random.default_rng(7), **kw)[2]
    assert a == b
    assert 0.0 <= a <= 1.0
