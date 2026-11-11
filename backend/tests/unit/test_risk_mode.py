"""三攻擊評估流程（AttackAssessor）單元測試。

涵蓋：
  - 評估流程（切 80/20 → 橋接產 syn → 三攻擊）以注入的 stub 橋接隔離去識別細節
  - AttackReport 只含三攻擊、不含 CAP
  - QI／敏感欄為空降級（-1.0）
  - 敏感欄不適合當分類目標時只降級推斷性（-1.0），指認性／連結性照常回數字
  - 同 seed 可重現
  - DeidBridge 分派：未知方法、config 型別不符皆 fail fast
  - 與 K-匿名門面的真實整合（受控資料，確保接線可跑）
"""
import pandas as pd
import pytest

from app.core.config import ColumnConfig, ColumnInfo, DPColumnConfig
from app.engines.risk import AttackAssessor, DeidBridge, run_attacks
from app.engines.risk import validation
from app.engines.risk.types import AttackReport


class _StubBridge:
    """假橋接：不呼叫真去識別，僅把年齡粗粒化，隔離評估流程與引擎細節。"""

    def produce_syn(self, method, df, config, params=None):
        out = df.copy()
        if "年齡" in out.columns:
            out["年齡"] = (out["年齡"] // 10) * 10
        return out


def _make_assessor(qi, sensitive, **kw):
    return AttackAssessor(
        qi, sensitive, method="k-anon", deid_config=None, bridge=_StubBridge(), **kw
    )


def test_attack_report_structure(sample_df):
    """正常流程：回 AttackReport，三指標在合法範圍，且不含 CAP 欄位。"""
    report = _make_assessor(
        ["年齡", "地區", "職業", "婚姻狀況"], ["疾病"], n_iter=50
    ).run(sample_df)

    assert isinstance(report, AttackReport)
    assert 0.0 <= report.singling_out_risk <= 1.0
    assert 0.0 <= report.linkability_risk <= 1.0
    assert 0.0 <= report.inference_risk <= 1.0
    # 三攻擊報告不含 CAP（CAP 屬 §3(1)B 的另一條路徑）
    assert not hasattr(report, "cap_before")
    assert not hasattr(report, "cap_after")


def test_qi_empty_degrade(sample_df):
    """QI 為空 → 三指標降級 -1.0 並附警告。"""
    report = _make_assessor([], ["疾病"]).run(sample_df)
    assert report.singling_out_risk == -1.0
    assert "警告" in report.message
    assert "準識別符 (QI) 數量為 0" in report.message


def test_no_sensitive_degrade(sample_df):
    """無敏感欄 → 三指標降級 -1.0。"""
    report = _make_assessor(["年齡", "地區"], []).run(sample_df)
    assert report.inference_risk == -1.0
    assert "警告" in report.message


def test_column_not_in_data_rejected(sample_df):
    """QI 欄位不存在於原始資料 → 前置擋（fail fast）。"""
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH"):
        _make_assessor(["年齡", "不存在欄"], ["疾病"]).run(sample_df)


def test_column_removed_by_deid_rejected(sample_df):
    """QI 在原始資料裡有、但去識別化把整欄移除 → 產完 syn 後擋下，訊息指名欄位。

    Step 1 的前置驗證只驗得到原始資料，這條路徑要等 syn 產出來才看得見；
    不擋就會在攻擊工人取值時撞 KeyError，外顯成無從判讀的內部錯誤。
    """

    class _DropColumnBridge:
        def produce_syn(self, method, df, config, params=None):
            return df.drop(columns=["地區"])

    assessor = AttackAssessor(
        ["年齡", "地區"],
        ["疾病"],
        method="k-anon",
        deid_config=None,
        bridge=_DropColumnBridge(),
    )
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH") as exc:
        assessor.run(sample_df)
    assert "地區" in str(exc.value)


def test_reproducible_with_same_seed(sample_df):
    """同資料、同參數（含預設 seed）重跑兩次，報告應完全相同。"""
    qi, s = ["年齡", "地區", "職業", "婚姻狀況"], ["疾病"]
    a = _make_assessor(qi, s, n_iter=50).run(sample_df)
    b = _make_assessor(qi, s, n_iter=50).run(sample_df)
    assert a.to_dict() == b.to_dict()


# ---------- 處理配置回填（供 §3(4) PDF 報告揭露，免呼叫方手打） ----------


def test_processing_config_filled(sample_df):
    """報告應回填處理配置：方法、去識別參數（剔除 salt_key）、風險實驗參數。"""
    assessor = _make_assessor(
        ["年齡", "地區"], ["疾病"], n_iter=30, seed=7, n_subset=200,
    )
    assessor.deid_params = {"k": 5, "salt_key": "機密鹽值", "suppression_limit_percent": 20}
    report = assessor.run(sample_df)

    pc = report.processing_config
    assert pc is not None
    assert pc.method == "k-anon"
    # salt_key 為機密，絕不得寫入報告
    assert "salt_key" not in pc.deid_params
    assert pc.deid_params["k"] == 5
    # 風險實驗參數如實回填
    assert pc.risk_params["seed"] == 7
    assert pc.risk_params["n_subset"] == 200


@pytest.mark.parametrize(
    "method, listed",
    [("row_suppression", False), ("cell_suppression", True)],
)
def test_processing_config_cell_fill_only_for_cell_suppression(sample_df, method, listed):
    """值抑制填法僅於值抑制時列入處理配置；列抑制不使用該參數故不列。"""
    assessor = _make_assessor(["年齡", "地區"], ["疾病"], n_iter=30)
    assessor.deid_params = {"k": 5, "suppression_method": method, "cell_fill": "star"}
    pc = assessor.run(sample_df).processing_config
    assert ("cell_fill" in pc.deid_params) is listed
    assert pc.deid_params["suppression_method"] == method


def test_processing_config_dp_discloses_budget(sample_df):
    """DP 自產 syn 時實際加噪一次：處理配置應帶出本次消耗與累計後之 ε／δ。"""
    config = DPColumnConfig(
        column_budgets={
            "年齡": {"type": "continuous", "epsilon_budget": 0.5, "sensitivity": 30.0},
            "薪資": {"type": "continuous", "epsilon_budget": 1.0, "sensitivity": 100000.0},
        },
    )
    report = run_attacks(
        original_df=sample_df,
        qi_cols=["年齡", "地區"],
        sensitive_cols=["疾病"],
        method="dp",
        deid_config=config,
        deid_params={"accumulated_epsilon": 2.0, "accumulated_delta": 0.0},
        n_iter=30,
    )

    pc = report.processing_config.deid_params
    assert pc["accumulated_epsilon"] == pytest.approx(2.0)
    assert pc["consumed_epsilon"] == pytest.approx(1.5)
    assert pc["consumed_delta"] == pytest.approx(0.0)
    assert pc["total_epsilon"] == pytest.approx(3.5)
    assert pc["total_delta"] == pytest.approx(0.0)


def test_degraded_report_still_has_config(sample_df):
    """降級收據也應帶處理配置（讓報告知道這份是用什麼方法評的）。"""
    report = _make_assessor([], ["疾病"]).run(sample_df)
    assert report.processing_config is not None
    assert report.processing_config.method == "k-anon"


# ---------- 重複實驗（n_repeats／overlap_ratio） ----------


def test_default_n_repeats_is_single_round(sample_df):
    """未指定 n_repeats（預設 1）：報告仍如實揭露 n_repeats=1／overlap_ratio=0.0。"""
    report = _make_assessor(["年齡", "地區"], ["疾病"], n_iter=30).run(sample_df)
    assert report.n_repeats == 1
    assert report.overlap_ratio == 0.0


def test_n_repeats_rejects_non_positive(sample_df):
    """n_repeats<1 無降級語意 → 建構時前置擋。"""
    with pytest.raises(ValueError, match="ERR_INVALID_PARAM"):
        _make_assessor(["年齡"], ["疾病"], n_repeats=0)


def test_n_repeats_reruns_bridge_each_round(sample_df):
    """n_repeats>1 應逐輪重新產生 syn（非只做一次），以計數 stub 驗證真的有反覆執行。"""

    class _CountingBridge:
        def __init__(self):
            self.calls = 0

        def produce_syn(self, method, df, config, params=None):
            self.calls += 1
            out = df.copy()
            if "年齡" in out.columns:
                out["年齡"] = (out["年齡"] // 10) * 10
            return out

    bridge = _CountingBridge()
    assessor = AttackAssessor(
        ["年齡", "地區", "職業", "婚姻狀況"], ["疾病"],
        method="k-anon", deid_config=None, bridge=bridge,
        n_iter=30, n_repeats=4, overlap_ratio=0.0,
    )
    report = assessor.run(sample_df)
    assert bridge.calls == 4
    assert report.n_repeats == 4
    assert report.overlap_ratio == 0.0
    assert 0.0 <= report.singling_out_risk <= 1.0
    assert 0.0 <= report.linkability_risk <= 1.0
    assert 0.0 <= report.inference_risk <= 1.0


def test_n_repeats_reproducible_with_same_seed(sample_df):
    """n_repeats>1：同 seed 重跑兩次，跨輪平均後的報告應完全相同。"""
    qi, s = ["年齡", "地區", "職業", "婚姻狀況"], ["疾病"]
    a = _make_assessor(qi, s, n_iter=30, n_repeats=3, overlap_ratio=0.2).run(sample_df)
    b = _make_assessor(qi, s, n_iter=30, n_repeats=3, overlap_ratio=0.2).run(sample_df)
    assert a.to_dict() == b.to_dict()


# ---------- 推斷性目標欄位不可執行時只降級推斷性 ----------


@pytest.fixture
def wide_df():
    """100 筆：薪資每列互異（連續數值敏感欄），疾病為可列舉類別欄。"""
    return pd.DataFrame(
        {
            "年齡": [20 + (i % 50) for i in range(100)],
            "地區": [f"區{i % 5}" for i in range(100)],
            "疾病": [f"病{i % 4}" for i in range(100)],
            "薪資": [30000 + i * 137 for i in range(100)],
        }
    )


def test_inference_skipped_when_target_not_enumerable(wide_df):
    """敏感欄相異值超過筆數之半 → 推斷性不執行、回 -1.0，另兩項照常有數字。"""
    report = _make_assessor(["年齡", "地區"], ["薪資"], n_iter=20).run(wide_df)

    assert report.inference_risk == -1.0
    assert 0.0 <= report.singling_out_risk <= 1.0
    assert 0.0 <= report.linkability_risk <= 1.0
    assert "推斷性未執行" in report.message
    assert "超過資料筆數" in report.message
    assert "不具評估意義" in report.message


def test_inference_skipped_when_beyond_supported_scale(wide_df, monkeypatch):
    """估算規模超出本次執行環境可支援者 → 同樣只降級推斷性，不影響其他兩項。"""
    monkeypatch.setattr(validation, "available_memory_bytes", lambda: 1)
    report = _make_assessor(["年齡", "地區"], ["疾病"], n_iter=20).run(wide_df)

    assert report.inference_risk == -1.0
    assert 0.0 <= report.singling_out_risk <= 1.0
    assert 0.0 <= report.linkability_risk <= 1.0
    assert "推斷性未執行" in report.message
    assert "超出本次執行環境可支援之評估規模" in report.message


def test_sensitive_with_missing_values_still_evaluated():
    """敏感欄有空值時三攻擊照常執行：空值自成一類，不讓推斷性的模型拒絕訓練。"""
    df = pd.DataFrame(
        {
            "年齡": [20 + (i % 5) for i in range(60)],
            "地區": [f"區{i % 3}" for i in range(60)],
            "疾病": [None if i % 4 == 0 else f"病{i % 3}" for i in range(60)],
        }
    )
    report = _make_assessor(["年齡", "地區"], ["疾病"], n_iter=20).run(df)
    assert 0.0 <= report.inference_risk <= 1.0


# ---------- DeidBridge 分派 fail fast ----------


def test_deid_bridge_unknown_method(sample_df):
    with pytest.raises(ValueError, match="ERR_DEID_METHOD_UNKNOWN"):
        DeidBridge().produce_syn("不存在的方法", sample_df, None)


def test_deid_bridge_kanon_config_mismatch(sample_df):
    """method=k-anon 卻給了非 ColumnConfig → 擋。"""
    with pytest.raises(ValueError, match="ERR_DEID_CONFIG_MISMATCH"):
        DeidBridge().produce_syn("k-anon", sample_df, config="不是 ColumnConfig")


def test_deid_bridge_dp_config_mismatch(sample_df):
    """method=dp 卻給了 K-匿名 config → 擋。"""
    kanon_cfg = ColumnConfig(
        columns={"年齡": ColumnInfo(role="quasi_identifier", type="numeric")}
    )
    with pytest.raises(ValueError, match="ERR_DEID_CONFIG_MISMATCH"):
        DeidBridge().produce_syn("dp", sample_df, config=kanon_cfg)


# ---------- 與 K-匿名門面的真實整合（受控資料） ----------


def test_real_kanon_integration():
    """run_attacks 走真實 K-匿名橋接：受控資料使等價類 ≥ k、不觸發抑制錯誤。"""
    df = pd.DataFrame(
        {
            "年齡": [21, 22, 23, 24, 31, 32, 33, 34, 41, 42],
            "疾病": ["a", "b", "a", "b", "a", "b", "a", "b", "a", "b"],
        }
    )
    cfg = ColumnConfig(
        columns={
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        },
        generalization_hierarchies={"年齡": {"rounding": 10}},
    )
    report = run_attacks(
        df,
        qi_cols=["年齡"],
        sensitive_cols=["疾病"],
        method="k-anon",
        deid_config=cfg,
        deid_params={"k": 2, "limit_exceeded_action": "allow_with_warning", "suppression_limit_percent": 100},
        n_iter=30,
    )
    assert isinstance(report, AttackReport)
    assert -1.0 <= report.singling_out_risk <= 1.0
    assert isinstance(report.sample_size, int)
