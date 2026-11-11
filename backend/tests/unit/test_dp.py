"""
差分隱私引擎 單元測試
涵蓋：正常加噪、預算累計追蹤、類別欄 k-RR、sensitivity 自動推導、type 驗證

參數分工（與 K-匿名一致）：逐欄預算走 DPColumnConfig（設定檔），
全域旋鈕（累計／default_delta）走 run_dp() 參數。
"""
import pytest
import pandas as pd

from app.core.config import DPColumnConfig
from app.engines.dp import run_dp
from app.engines.dp.discretize import apply_bounds, match_unit_precision, to_units


def test_dp_consumes_declared_budget(sample_df):
    """DP 應成功加噪，並據實回報本次消耗量"""
    config = DPColumnConfig(
        column_budgets={
            "年齡": {"type": "continuous", "epsilon_budget": 0.5, "sensitivity": 30.0},
            "薪資": {"type": "continuous", "epsilon_budget": 0.5, "sensitivity": 100000.0},
        },
    )
    df_out, report = run_dp(sample_df, config)

    assert report.consumed_epsilon == pytest.approx(1.0)
    assert report.accumulated_epsilon == pytest.approx(1.0)
    # 加噪後仍應為數值欄位
    assert pd.api.types.is_numeric_dtype(df_out["年齡"])
    assert pd.api.types.is_numeric_dtype(df_out["薪資"])


def test_dp_accumulates_caller_supplied_budget(sample_df):
    """無狀態設計：呼叫方自帶的累計值應併入報告，供其作為下次呼叫的收據"""
    config = DPColumnConfig(
        column_budgets={
            "年齡": {"type": "continuous", "epsilon_budget": 0.5, "sensitivity": 30.0},
            "薪資": {"type": "continuous", "epsilon_budget": 0.5, "sensitivity": 100000.0},
        },
    )
    _, report = run_dp(
        sample_df, config, accumulated_epsilon=1.0, accumulated_delta=0.2
    )

    # 本次消耗與累計後總額分別回報，兩者不混淆
    assert report.consumed_epsilon == pytest.approx(1.0)
    assert report.accumulated_epsilon == pytest.approx(2.0)  # 自帶 1.0 + 本次 1.0
    assert report.accumulated_delta == pytest.approx(0.2)    # 自帶 0.2 + 本次 0.0


def test_dp_categorical_krr(sample_df):
    """類別欄（地區）宣告 categorical 時走 k-RR：輸出仍是原本的類別文字，不轉成數字。"""
    original_categories = set(sample_df["地區"].dropna().unique())
    config = DPColumnConfig(
        column_budgets={
            "地區": {"type": "categorical", "epsilon_budget": 1.0},
        }
    )
    df_out, report = run_dp(sample_df, config)

    # k-RR 輸出永遠是原本的合法類別之一（維持文字、不會變成噪聲數字）
    assert not pd.api.types.is_numeric_dtype(df_out["地區"])
    assert set(df_out["地區"].dropna().unique()).issubset(original_categories)


def test_dp_auto_sensitivity(sample_df):
    """continuous 欄位 sensitivity 為 None 時，引擎應自動推導並正常執行"""
    config = DPColumnConfig(
        column_budgets={
            "就醫次數": {"type": "continuous", "epsilon_budget": 1.0, "sensitivity": None},
        }
    )
    _, report = run_dp(sample_df, config)

    # 未申報 → 系統以資料 max-min 推導，並於明細標記來源
    detail = report.per_column[0]
    assert detail.sensitivity_source == "system"
    assert detail.sensitivity > 0


def test_dp_invalid_type_rejected():
    """type 為必填且僅接受 continuous/categorical/datetime，非法值應 fail fast。"""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        DPColumnConfig(
            column_budgets={"年齡": {"type": "numeric", "epsilon_budget": 1.0}},  # 拼錯
        )
    with pytest.raises(ValidationError):
        DPColumnConfig(
            column_budgets={"年齡": {"epsilon_budget": 1.0}},  # 完全沒給 type
        )


def test_dp_datetime_noising(sample_df):
    """datetime 欄走日期抖動：輸出為合法 ISO 日期（YYYY-MM-DD），非垃圾小數。"""
    config = DPColumnConfig(
        column_budgets={"生日": {"type": "datetime", "epsilon_budget": 1.0}},
    )
    df_out, report = run_dp(sample_df, config)

    # 輸出每格都是可解析的 ISO 日期字串
    assert df_out["生日"].str.match(r"^\d{4}-\d{2}-\d{2}$").all()
    pd.to_datetime(df_out["生日"])  # 可全欄解析、不拋錯

    # 逐欄明細：type=datetime、底層機制離散型 Laplace（δ=0）、sensitivity 為系統推導（單位：天）
    detail = report.per_column[0]
    assert detail.type == "datetime"
    assert detail.mechanism == "DiscreteLaplace"
    assert detail.sensitivity_source == "system"
    assert detail.sensitivity > 0  # 資料日期範圍的天數


def test_dp_datetime_user_sensitivity(sample_df):
    """datetime 欄使用者申報 sensitivity（單位：天）→ 照用並標記 user。"""
    config = DPColumnConfig(
        column_budgets={"生日": {"type": "datetime", "epsilon_budget": 1.0, "sensitivity": 30.0}},
    )
    _, report = run_dp(sample_df, config)
    detail = report.per_column[0]
    assert detail.sensitivity == pytest.approx(30.0)
    assert detail.sensitivity_source == "user"


def test_dp_datetime_preserves_nan():
    """datetime 欄的空值加噪後應維持空值（不變成 1970-01-01 之類的假日期）。"""
    df = pd.DataFrame({"日期": ["2020-01-01", None, "2020-06-15"]})
    config = DPColumnConfig(
        column_budgets={"日期": {"type": "datetime", "epsilon_budget": 1.0}},
    )
    df_out, _ = run_dp(df, config)
    assert pd.isna(df_out["日期"].iloc[1])
    assert df_out["日期"].iloc[0] is not None and df_out["日期"].iloc[2] is not None


def test_dp_datetime_time_of_day_does_not_shift_day():
    """帶時分秒的日期在雜訊趨近零時不得跳天（先對齊當天零點再換算天數）。

    未對齊零點時天序數帶小數，取整會把中午之後的列推到隔天——
    即使完全沒有雜訊也會產生一天的偏移。
    """
    df = pd.DataFrame({"就診時間": ["2024-03-15 14:30:00", "2024-03-15 23:59:00"]})
    config = DPColumnConfig(
        # ε 極大＋申報 sensitivity＝1 天 → 雜訊尺度遠小於一天，取整必定落回原本那天
        column_budgets={"就診時間": {"type": "datetime", "epsilon_budget": 1e6, "sensitivity": 1.0}},
    )
    df_out, _ = run_dp(df, config)
    assert df_out["就診時間"].tolist() == ["2024-03-15", "2024-03-15"]


def test_dp_datetime_time_of_day_dropped_is_reported():
    """時分秒被捨棄屬系統替使用者改了精度，報告須告知（報告透明）。"""
    df = pd.DataFrame({"就診時間": ["2024-03-15 14:30:00", "2024-03-16 08:00:00"]})
    config = DPColumnConfig(
        column_budgets={"就診時間": {"type": "datetime", "epsilon_budget": 1.0}},
    )
    _, report = run_dp(df, config)
    assert "就診時間" in report.message
    assert "時分秒" in report.message


def test_dp_datetime_without_time_is_not_reported():
    """純日期欄沒有東西被捨棄，不該冒出時分秒的提醒。"""
    df = pd.DataFrame({"生日": ["1990-01-01", "1995-06-15"]})
    config = DPColumnConfig(
        column_budgets={"生日": {"type": "datetime", "epsilon_budget": 1.0}},
    )
    _, report = run_dp(df, config)
    assert "時分秒" not in report.message


@pytest.mark.parametrize(
    "raw, pattern",
    [
        (["1999-03-15", "2000-07-01"], r"^\d{4}-\d{2}-\d{2}$"),   # ISO
        (["1999/03/15", "2000/07/01"], r"^\d{4}/\d{2}/\d{2}$"),   # 斜線
        (["19990315", "20000701"], r"^\d{8}$"),                    # 無分隔
        (["1999-03-15 14:30", "2000-07-01 08:00"], r"^\d{4}-\d{2}-\d{2}$"),  # 帶時刻→仍輸出到日
    ],
)
def test_dp_datetime_output_follows_input_format(raw, pattern):
    """輸出沿用輸入的寫法，不一律正規化成 ISO（同欄格式一致由前置驗證保證）。"""
    config = DPColumnConfig(
        column_budgets={"日期": {"type": "datetime", "epsilon_budget": 1.0}},
    )
    df_out, _ = run_dp(pd.DataFrame({"日期": raw}), config)
    assert df_out["日期"].str.match(pattern).all()


def test_dp_datetime_day_first_format_preserved():
    """日在前的寫法輸出仍是日在前，不被換成月在前（依 pandas 的判讀還原）。"""
    df = pd.DataFrame({"日期": ["25/03/1999", "18/07/2000"]})
    config = DPColumnConfig(
        column_budgets={"日期": {"type": "datetime", "epsilon_budget": 1e6, "sensitivity": 1.0}},
    )
    df_out, _ = run_dp(df, config)
    assert df_out["日期"].tolist() == ["25/03/1999", "18/07/2000"]


@pytest.mark.parametrize(
    "noise_unit, expected",
    [
        ("day", "2024-03-15"),
        ("hour", "2024-03-15 14:00"),
        ("minute", "2024-03-15 14:37"),
        ("second", "2024-03-15 14:37:22"),
    ],
)
def test_dp_noise_unit_controls_alignment_and_output(noise_unit, expected):
    """noise_unit 決定對齊與輸出的精細度：比它細的部分捨棄，輸出印到該位。"""
    df = pd.DataFrame({"就診時間": ["2024-03-15 14:37:22", "2024-03-15 14:37:22"]})
    config = DPColumnConfig(
        column_budgets={
            # ε 極大＋申報 sensitivity＝1 個單位 → 雜訊遠小於一個單位，取整必落回原位
            "就診時間": {
                "type": "datetime",
                "epsilon_budget": 1e6,
                "sensitivity": 1.0,
                "noise_unit": noise_unit,
            }
        },
    )
    df_out, report = run_dp(df, config)
    assert df_out["就診時間"].tolist() == [expected, expected]
    assert report.per_column[0].noise_unit == noise_unit


def test_dp_noise_unit_defaults_to_day(sample_df):
    """未指定 noise_unit ＝ day，且於逐欄明細揭露。"""
    config = DPColumnConfig(
        column_budgets={"生日": {"type": "datetime", "epsilon_budget": 1.0}},
    )
    df_out, report = run_dp(sample_df, config)
    assert report.per_column[0].noise_unit == "day"
    assert df_out["生日"].str.match(r"^\d{4}-\d{2}-\d{2}$").all()


def test_dp_noise_unit_reports_what_was_dropped():
    """報告要講明被捨棄的是什麼——以小時加噪時捨的是「分秒」而非「時分秒」。"""
    df = pd.DataFrame({"就診時間": ["2024-03-15 14:37:22", "2024-03-16 08:15:00"]})
    config = DPColumnConfig(
        column_budgets={"就診時間": {"type": "datetime", "epsilon_budget": 1.0, "noise_unit": "hour"}},
    )
    _, report = run_dp(df, config)
    assert "就診時間" in report.message
    assert "分秒" in report.message


def test_dp_noise_unit_second_on_whole_seconds_reports_nothing():
    """資料本來就只到秒、又以秒加噪 → 沒有東西被捨棄，不該冒出提醒。"""
    df = pd.DataFrame({"就診時間": ["2024-03-15 14:37:22", "2024-03-16 08:15:00"]})
    config = DPColumnConfig(
        column_budgets={"就診時間": {"type": "datetime", "epsilon_budget": 1.0, "noise_unit": "second"}},
    )
    _, report = run_dp(df, config)
    assert "捨棄" not in report.message


def test_dp_noise_unit_rejects_illegal_value():
    """noise_unit 只收四個單位，其餘於解析設定檔時即擋（純 config、前置 fail fast）。"""
    with pytest.raises(ValueError, match="noise_unit"):
        DPColumnConfig(
            column_budgets={"生日": {"type": "datetime", "epsilon_budget": 1.0, "noise_unit": "week"}},
        )


def test_dp_noise_unit_rejected_on_non_datetime():
    """noise_unit 設在非日期欄不會生效，通常代表型別認錯 → 擋（比照 categorical 的處置）。"""
    config = DPColumnConfig(
        column_budgets={"年齡": {"type": "continuous", "epsilon_budget": 1.0, "noise_unit": "hour"}},
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        config.validate_config()


def test_dp_noise_unit_preserves_input_date_format():
    """換單位不影響「日期部分沿用輸入寫法」，時間部分才由單位決定。"""
    df = pd.DataFrame({"就診時間": ["2024/03/15 14:37:22", "2024/03/16 08:15:00"]})
    config = DPColumnConfig(
        column_budgets={
            "就診時間": {
                "type": "datetime",
                "epsilon_budget": 1e6,
                "sensitivity": 1.0,
                "noise_unit": "minute",
            }
        },
    )
    df_out, _ = run_dp(df, config)
    assert df_out["就診時間"].tolist() == ["2024/03/15 14:37", "2024/03/16 08:15"]


def test_dp_datetime_on_unparseable_rejected(sample_df):
    """宣告 datetime 但資料無法解析成日期（地區文字）→ 前置擋（比照 K-匿名 _check_temporal）。"""
    config = DPColumnConfig(
        column_budgets={"地區": {"type": "datetime", "epsilon_budget": 1.0}},
    )
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH"):
        run_dp(sample_df, config)


def test_dp_column_not_in_data_engine(sample_df):
    """設定檔引用資料中不存在的欄位 → 引擎前置擋下（API 與 CLI 皆經此檢查）。"""
    config = DPColumnConfig(
        column_budgets={"不存在欄位": {"type": "continuous", "epsilon_budget": 1.0}},
    )
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH"):
        run_dp(sample_df, config)


def test_dp_continuous_on_text_rejected(sample_df):
    """宣告 continuous 但資料是文字（地區）→ 前置擋下，不讓 diffprivlib 拋不友善 TypeError。"""
    config = DPColumnConfig(
        column_budgets={"地區": {"type": "continuous", "epsilon_budget": 1.0}},
    )
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH"):
        run_dp(sample_df, config)


def test_dp_continuous_with_infinity_rejected():
    """continuous 欄含無限大值 → 換不成整數刻度，前置擋下並講明原因（不變成伺服器錯誤）。"""
    config = DPColumnConfig(
        column_budgets={"金額": {"type": "continuous", "epsilon_budget": 1.0}},
    )
    with pytest.raises(ValueError, match="無限大"):
        run_dp(pd.DataFrame({"金額": [1.0, float("inf")]}), config)


def test_dp_invalid_epsilon_rejected(sample_df):
    """ε ≤ 0 在 DP 無意義，應 fail fast。"""
    config = DPColumnConfig(
        column_budgets={"年齡": {"type": "continuous", "epsilon_budget": 0.0, "sensitivity": 30.0}},
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        run_dp(sample_df, config)


def test_dp_categorical_with_noise_params_rejected(sample_df):
    """categorical 明確設了 δ/sensitivity（k-RR 用不到且 δ 會被計費）→ fail fast。"""
    # 明確設 δ>0
    cfg_delta = DPColumnConfig(
        column_budgets={"地區": {"type": "categorical", "epsilon_budget": 1.0, "delta_budget": 0.01}},
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        run_dp(sample_df, cfg_delta)

    # 明確設 sensitivity
    cfg_sens = DPColumnConfig(
        column_budgets={"地區": {"type": "categorical", "epsilon_budget": 1.0, "sensitivity": 5.0}},
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        run_dp(sample_df, cfg_sens)


def test_dp_categorical_defaults_ok(sample_df):
    """categorical 不設 δ/sensitivity（用預設 δ=0、sensitivity=None）應正常放行。"""
    config = DPColumnConfig(
        column_budgets={"地區": {"type": "categorical", "epsilon_budget": 1.0}},
    )
    _, report = run_dp(sample_df, config)

    # 走 k-RR：δ 恆 0、無 sensitivity
    detail = report.per_column[0]
    assert detail.mechanism == "k-RR"
    assert detail.delta == 0.0
    assert detail.sensitivity is None


def test_dp_invalid_delta_rejected(sample_df):
    """δ 必須落在 [0, 1)，δ≥1 應 fail fast。"""
    config = DPColumnConfig(
        column_budgets={
            "年齡": {"type": "continuous", "epsilon_budget": 1.0, "delta_budget": 1.0, "sensitivity": 30.0}
        },
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        run_dp(sample_df, config)


def test_dp_per_column_report(sample_df):
    """報告透明：逐欄明細應含機制、ε/δ、sensitivity 值與來源。

    - 使用者申報 sensitivity → source="user"、值＝申報值
    - 未申報（系統推導）→ source="system"、且摘要訊息主動告知
    - categorical 走 k-RR → 無 sensitivity（None）
    """
    config = DPColumnConfig(
        column_budgets={
            "年齡": {"type": "continuous", "epsilon_budget": 0.5},  # 未給 sensitivity → 系統推導
            "薪資": {"type": "continuous", "epsilon_budget": 1.0, "sensitivity": 100000.0},  # 使用者申報
            "地區": {"type": "categorical", "epsilon_budget": 1.5},  # k-RR
        },
    )
    _, report = run_dp(sample_df, config)

    # 有給預算的三欄都應出現在明細（逐欄列出）
    detail = {d.column: d for d in report.per_column}
    assert set(detail) == {"年齡", "薪資", "地區"}

    # 連續欄（δ=0）→ 離散型 Laplace；sensitivity 來源正確
    assert detail["年齡"].mechanism == "DiscreteLaplace"
    assert detail["年齡"].sensitivity_source == "system"
    assert detail["年齡"].sensitivity is not None  # 系統推導出一個值
    assert detail["薪資"].sensitivity_source == "user"
    assert detail["薪資"].sensitivity == pytest.approx(100000.0)

    # 類別欄 → k-RR，純 ε 機制無 sensitivity
    assert detail["地區"].mechanism == "k-RR"
    assert detail["地區"].sensitivity is None
    assert detail["地區"].sensitivity_source is None

    # 系統替使用者推導了 sensitivity → 摘要應主動揭露（報告透明原則）
    assert "年齡" in report.message
    assert "sensitivity" in report.message


def test_dp_gaussian_mechanism_in_report(sample_df):
    """δ>0 的連續欄在逐欄明細中應標記為離散型 Gaussian。"""
    config = DPColumnConfig(
        column_budgets={
            "年齡": {"type": "continuous", "epsilon_budget": 1.0, "delta_budget": 1e-5, "sensitivity": 30.0},
        },
    )
    _, report = run_dp(sample_df, config)
    assert report.per_column[0].mechanism == "DiscreteGaussian"


def test_dp_default_delta_fills_unset_columns(sample_df):
    """全域 default_delta（規格「可設定相同 δ」）補「沒設 δ」的量型欄位 → 翻成離散型 Gaussian，並照實入帳。"""
    config = DPColumnConfig(
        column_budgets={
            "年齡": {"type": "continuous", "epsilon_budget": 1.0, "sensitivity": 30.0},  # 沒設 δ → 吃全域
            "薪資": {"type": "continuous", "epsilon_budget": 1.0, "delta_budget": 0.0, "sensitivity": 100000.0},  # 明確 0 → 尊重
            "地區": {"type": "categorical", "epsilon_budget": 1.0},  # categorical → 不吃全域
        },
    )
    _, report = run_dp(sample_df, config, default_delta=1e-5)
    detail = {d.column: d for d in report.per_column}

    # 沒設 δ 的欄吃到全域 → 離散型 Gaussian
    assert detail["年齡"].mechanism == "DiscreteGaussian"
    assert detail["年齡"].delta == pytest.approx(1e-5)
    # 明確設 0 = 使用者指定純 ε 保證 → 維持離散型 Laplace，全域不得覆蓋
    assert detail["薪資"].mechanism == "DiscreteLaplace"
    assert detail["薪資"].delta == 0.0
    # categorical 不受全域影響
    assert detail["地區"].mechanism == "k-RR"
    assert detail["地區"].delta == 0.0
    # 記帳＝實際生效值（只有年齡吃到 1e-5）
    assert report.consumed_delta == pytest.approx(1e-5)


def test_dp_message_shows_delta_in_scientific_notation(sample_df):
    """δ 通常極小，訊息一律以 1e-5 這種寫法呈現，不被捨成 0.00。"""
    config = DPColumnConfig(
        column_budgets={
            "年齡": {"type": "continuous", "epsilon_budget": 1.0, "delta_budget": 1e-5, "sensitivity": 30.0},
        },
    )
    _, report = run_dp(sample_df, config)
    assert "δ=1e-5" in report.message


def test_dp_column_delta_overrides_default(sample_df):
    """欄位自設 δ（>0）優先於全域 default_delta。"""
    config = DPColumnConfig(
        column_budgets={
            "年齡": {"type": "continuous", "epsilon_budget": 1.0, "delta_budget": 1e-6, "sensitivity": 30.0},
        },
    )
    _, report = run_dp(sample_df, config, default_delta=1e-4)
    assert report.per_column[0].delta == pytest.approx(1e-6)  # 用自己的，不是全域的


def test_dp_default_delta_applies_to_datetime(sample_df):
    """datetime 骨子是量 → 沒設 δ 時同樣吃全域，走離散型 Gaussian 版日期抖動。"""
    config = DPColumnConfig(
        column_budgets={"生日": {"type": "datetime", "epsilon_budget": 1.0}},
    )
    df_out, report = run_dp(sample_df, config, default_delta=1e-5)
    assert report.per_column[0].mechanism == "DiscreteGaussian"
    assert df_out["生日"].str.match(r"^\d{4}-\d{2}-\d{2}$").all()  # 輸出仍是合法 ISO 日期


def test_dp_invalid_default_delta_rejected(sample_df):
    """全域 default_delta 與逐欄 δ 適用同一值域（[0,1)），負數/超界 fail fast。"""
    config = DPColumnConfig(
        column_budgets={"年齡": {"type": "continuous", "epsilon_budget": 1.0, "sensitivity": 30.0}},
    )
    for bad in (-0.1, 1.0):
        with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
            run_dp(sample_df, config, default_delta=bad)


# ── 離散型 DP（最小單位換算＋後處理超界策略）─────────────────────────────────


def test_to_units_matches_spec_example():
    """規格原文的例子：最小單位 0.5 時 [5.5, 15.0, 20.5] → [11, 30, 41]。"""
    units = to_units(pd.Series([5.5, 15.0, 20.5]), 0.5)
    assert list(units) == [11.0, 30.0, 41.0]


def test_to_units_rounds_and_keeps_nan():
    """除不盡→四捨五入到最近的刻度倍數（5.7÷0.5=11.4→11）；空值維持空值。"""
    units = to_units(pd.Series([5.7, None]), 0.5)
    assert units[0] == 11.0
    assert pd.isna(units[1])


@pytest.mark.parametrize(
    "value, clamp_out, fold_out, wrap_out",
    [
        (105, 100, 95, 5),
        (250, 100, 50, 50),
        (-12, 0, 12, 88),
    ],
)
def test_apply_bounds_three_strategies(value, clamp_out, fold_out, wrap_out):
    """範圍 0~100 的三策略對照（fold 會折到底、wrap 等同對寬度取模）。"""
    series = pd.Series([float(value)])
    assert apply_bounds(series, (0.0, 100.0), "clamp")[0] == pytest.approx(clamp_out)
    assert apply_bounds(series, (0.0, 100.0), "fold")[0] == pytest.approx(fold_out)
    assert apply_bounds(series, (0.0, 100.0), "wrap")[0] == pytest.approx(wrap_out)


def test_apply_bounds_without_bounds_is_noop():
    """沒設 clipping_bounds → 原樣回傳（後處理不介入）。"""
    series = pd.Series([-5.0, 999.0])
    assert list(apply_bounds(series, None, None)) == [-5.0, 999.0]


def test_dp_output_lands_on_minimum_unit_grid():
    """離散型 DP：加噪後的值必為最小單位的整數倍（不出現任意浮點數）。"""
    df = pd.DataFrame({"金額": [5.5, 15.0, 20.5, 33.3]})
    config = DPColumnConfig(
        column_budgets={
            "金額": {
                "type": "continuous",
                "epsilon_budget": 1.0,
                "sensitivity": 10.0,
                "minimum_unit": 0.5,
            }
        }
    )
    df_out, report = run_dp(df, config)

    quotient = df_out["金額"] / 0.5
    assert (quotient == quotient.round()).all()
    # 報告須揭露刻度（sensitivity 以它為單位，兩者要一起看）
    assert report.per_column[0].minimum_unit == pytest.approx(0.5)


def test_match_unit_precision_integer_unit_outputs_integers():
    """最小單位為整數 → 輸出可空整數（寫出為 43，不帶 .0）；空值維持空值。"""
    out = match_unit_precision(pd.Series([43.0, 4500.0, None]), 1.0)
    assert str(out.dtype) == "Int64"
    assert out.tolist()[:2] == [43, 4500]
    assert pd.isna(out[2])
    assert str(match_unit_precision(pd.Series([55500.0]), 100.0).dtype) == "Int64"


def test_match_unit_precision_decimal_unit_keeps_decimals():
    """最小單位為小數 → 輸出小數，並去除乘回刻度產生的浮點尾數。"""
    out = match_unit_precision(pd.Series([1167 * 0.1, 3 * 0.1, None]), 0.1)
    assert 3 * 0.1 != 0.3  # 乘回刻度確實產生浮點尾數（0.30000000000000004）
    assert out.tolist()[:2] == [116.7, 0.3]
    assert pd.isna(out[2])
    assert match_unit_precision(pd.Series([7 * 0.25]), 0.25).tolist() == [1.75]


def test_match_unit_precision_off_grid_bound_left_unchanged():
    """超界處理之界線非刻度倍數（值不在刻度上）→ 原樣回傳，不改動界線值。"""
    series = pd.Series([40.0, 120.5])
    out = match_unit_precision(series, 1.0)
    assert out.tolist() == [40.0, 120.5]


def test_dp_integer_input_outputs_integers():
    """整數進、整數出：最小單位為整數時，DP 輸出欄位為整數型別。"""
    df = pd.DataFrame({"年齡": [41, 45, 39, None]})
    config = DPColumnConfig(
        column_budgets={
            "年齡": {"type": "continuous", "epsilon_budget": 1.0, "sensitivity": 1.0}
        }
    )
    df_out, _ = run_dp(df, config)
    assert str(df_out["年齡"].dtype) == "Int64"
    assert pd.isna(df_out["年齡"][3])
    assert "." not in df_out.to_csv(index=False)


def test_dp_sensitivity_converted_to_units_and_rounded_up():
    """申報 sensitivity 以原始單位計 → 除以最小單位換算，除不盡無條件進位。"""
    df = pd.DataFrame({"金額": [1.0, 2.0, 3.0]})
    # 5.5 ÷ 2 = 2.75 → 進位為 3（寧可高估，低估等於雜訊加不足）
    config = DPColumnConfig(
        column_budgets={
            "金額": {
                "type": "continuous",
                "epsilon_budget": 1.0,
                "sensitivity": 5.5,
                "minimum_unit": 2.0,
            }
        }
    )
    _, report = run_dp(df, config)
    assert report.per_column[0].sensitivity == pytest.approx(3)
    assert report.per_column[0].sensitivity_source == "user"


def test_dp_clipping_bounds_pull_values_back():
    """加噪後超界的值一律被後處理收回範圍內（此處以 clamp 驗證）。"""
    df = pd.DataFrame({"分數": [50.0] * 20})
    config = DPColumnConfig(
        column_budgets={
            "分數": {
                "type": "continuous",
                "epsilon_budget": 0.01,  # ε 極小 → 雜訊尺度極大，必定噴出範圍
                "sensitivity": 100.0,
                "clipping_bounds": [0, 100],
                "out_of_bounds_strategy": "clamp",
            }
        }
    )
    df_out, report = run_dp(df, config)
    assert df_out["分數"].between(0, 100).all()
    assert report.per_column[0].out_of_bounds_strategy == "clamp"


def test_dp_clipping_bounds_default_strategy_is_clamp():
    """有給界線卻沒給策略 → 採 clamp，並於報告據實揭露。"""
    df = pd.DataFrame({"分數": [50.0] * 20})
    config = DPColumnConfig(
        column_budgets={
            "分數": {
                "type": "continuous",
                "epsilon_budget": 0.01,
                "sensitivity": 100.0,
                "clipping_bounds": [0, 100],
            }
        }
    )
    df_out, report = run_dp(df, config)
    assert df_out["分數"].between(0, 100).all()
    assert report.per_column[0].out_of_bounds_strategy == "clamp"


def test_dp_coarse_minimum_unit_warns_but_runs():
    """刻度比資料還粗（資料 1、2、3 而刻度 10）→ 能跑，但須於報告提醒結果無意義。"""
    df = pd.DataFrame({"次數": [1.0, 2.0, 3.0]})
    config = DPColumnConfig(
        column_budgets={
            "次數": {
                "type": "continuous",
                "epsilon_budget": 1e6,  # ε 極大 → 幾乎無雜訊，確保提醒不是被雜訊觸發
                "sensitivity": 1.0,
                "minimum_unit": 10.0,
            }
        }
    )
    _, report = run_dp(df, config)
    assert "minimum_unit" in report.message


def test_dp_invalid_minimum_unit_rejected():
    """刻度填 0 或負數＝設定本身矛盾 → 前置擋掉。"""
    for bad in (0, -1):
        config = DPColumnConfig(
            column_budgets={
                "年齡": {"type": "continuous", "epsilon_budget": 1.0, "minimum_unit": bad}
            }
        )
        with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
            config.validate_config()


def test_dp_reversed_clipping_bounds_rejected():
    """上下界顛倒＝範圍是空的 → 前置擋掉。"""
    config = DPColumnConfig(
        column_budgets={
            "年齡": {
                "type": "continuous",
                "epsilon_budget": 1.0,
                "clipping_bounds": [100, 0],
            }
        }
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        config.validate_config()


def test_dp_strategy_without_bounds_rejected():
    """有超界策略卻沒有界線 → 少填了一半，前置擋掉。"""
    config = DPColumnConfig(
        column_budgets={
            "年齡": {
                "type": "continuous",
                "epsilon_budget": 1.0,
                "out_of_bounds_strategy": "fold",
            }
        }
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        config.validate_config()


def test_dp_invalid_strategy_value_rejected():
    """out_of_bounds_strategy 只收 clamp/wrap/fold。"""
    with pytest.raises(ValueError):
        DPColumnConfig(
            column_budgets={
                "年齡": {
                    "type": "continuous",
                    "epsilon_budget": 1.0,
                    "clipping_bounds": [0, 100],
                    "out_of_bounds_strategy": "truncate",
                }
            }
        )


@pytest.mark.parametrize(
    "field, value",
    [
        ("minimum_unit", 0.5),
        ("clipping_bounds", [0, 100]),
        ("out_of_bounds_strategy", "clamp"),
    ],
)
def test_dp_discrete_params_only_for_continuous(field, value):
    """三個離散化參數只適用 continuous：datetime 的刻度由 noise_unit 決定，
    categorical 沒有「量」可談，設了不會生效 → 比照 noise_unit 擋而非靜默忽略。"""
    config = DPColumnConfig(
        column_budgets={"生日": {"type": "datetime", "epsilon_budget": 1.0, field: value}}
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        config.validate_config()


def test_dp_datetime_output_is_discrete(sample_df):
    """日期欄復用數值機制 → 一併變離散：輸出仍是對齊到 noise_unit 的合法日期。"""
    config = DPColumnConfig(
        column_budgets={"生日": {"type": "datetime", "epsilon_budget": 1.0, "sensitivity": 5.0}}
    )
    df_out, report = run_dp(sample_df, config)
    assert df_out["生日"].str.match(r"^\d{4}-\d{2}-\d{2}$").all()
    assert report.per_column[0].mechanism == "DiscreteLaplace"
    # 日期欄不吃 minimum_unit（刻度即 1 個 noise_unit）
    assert report.per_column[0].minimum_unit is None


# ── 日期欄的刻度（noise_step）與上下界（time_clipping_bounds）─────────────────


def test_dp_datetime_noise_step_lands_on_grid():
    """noise_unit: minute + noise_step: 5 → 輸出的分鐘數必為 5 的倍數。"""
    df = pd.DataFrame(
        {"就診時間": ["2024-03-15 14:32:00", "2024-03-15 09:07:00", "2024-03-16 21:48:00"]}
    )
    config = DPColumnConfig(
        column_budgets={
            "就診時間": {
                "type": "datetime",
                "epsilon_budget": 1.0,
                "sensitivity": 60.0,  # ＝60 分鐘 → 12 格
                "noise_unit": "minute",
                "noise_step": 5,
            }
        }
    )
    df_out, report = run_dp(df, config)

    minutes = pd.to_datetime(df_out["就診時間"]).dt.minute
    assert (minutes % 5 == 0).all()
    # sensitivity 以「格」為單位：60 分鐘 ÷ 5 分鐘 = 12 格
    assert report.per_column[0].sensitivity == pytest.approx(12)
    assert report.per_column[0].noise_step == 5


def test_dp_datetime_bounds_pull_dates_back():
    """ε 極小時日期會飄到數百年外；設了上下界即被後處理收回範圍內。"""
    df = pd.DataFrame({"生日": ["1999-03-15"] * 20})
    config = DPColumnConfig(
        column_budgets={
            "生日": {
                "type": "datetime",
                "epsilon_budget": 0.0001,  # 雜訊尺度極大，必定飄出範圍
                "sensitivity": 30.0,
                "time_clipping_bounds": ["1930-01-01", "2026-12-31"],
                "time_out_of_bounds_strategy": "clamp",
            }
        }
    )
    df_out, report = run_dp(df, config)

    out = pd.to_datetime(df_out["生日"])
    assert out.between(pd.Timestamp("1930-01-01"), pd.Timestamp("2026-12-31")).all()
    assert report.per_column[0].out_of_bounds_strategy == "clamp"


def test_dp_datetime_bounds_default_strategy_is_clamp():
    """日期欄有給界線卻沒給策略 → 同樣採 clamp 並據實揭露。"""
    df = pd.DataFrame({"生日": ["1999-03-15"] * 20})
    config = DPColumnConfig(
        column_budgets={
            "生日": {
                "type": "datetime",
                "epsilon_budget": 0.0001,
                "sensitivity": 30.0,
                "time_clipping_bounds": ["1930-01-01", "2026-12-31"],
            }
        }
    )
    df_out, report = run_dp(df, config)
    out = pd.to_datetime(df_out["生日"])
    assert out.between(pd.Timestamp("1930-01-01"), pd.Timestamp("2026-12-31")).all()
    assert report.per_column[0].out_of_bounds_strategy == "clamp"


def test_dp_datetime_coarse_noise_step_warns():
    """刻度粗到整欄壓成同一格（資料差幾分鐘而刻度填 1 天）→ 能跑，但須提醒。"""
    df = pd.DataFrame(
        {"就診時間": ["2024-03-15 09:00:00", "2024-03-15 09:05:00", "2024-03-15 09:10:00"]}
    )
    config = DPColumnConfig(
        column_budgets={
            "就診時間": {
                "type": "datetime",
                "epsilon_budget": 1e6,  # 幾乎無雜訊，確保提醒不是被雜訊觸發
                "sensitivity": 1.0,
                "noise_unit": "minute",
                "noise_step": 1440,  # ＝1 天
            }
        }
    )
    _, report = run_dp(df, config)
    assert "noise_step" in report.message


def test_dp_invalid_noise_step_rejected():
    """noise_step 填 0 或負數＝刻度沒有意義 → 前置擋掉。"""
    for bad in (0, -5):
        config = DPColumnConfig(
            column_budgets={
                "生日": {"type": "datetime", "epsilon_budget": 1.0, "noise_step": bad}
            }
        )
        with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
            config.validate_config()


def test_dp_reversed_time_bounds_rejected():
    """日期上下界顛倒＝範圍是空的 → 前置擋掉。"""
    config = DPColumnConfig(
        column_budgets={
            "生日": {
                "type": "datetime",
                "epsilon_budget": 1.0,
                "time_clipping_bounds": ["2026-12-31", "1930-01-01"],
            }
        }
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        config.validate_config()


def test_dp_unparseable_time_bounds_rejected():
    """日期界線解析不出來 → 前置擋掉（不留到加噪時才炸）。"""
    config = DPColumnConfig(
        column_budgets={
            "生日": {
                "type": "datetime",
                "epsilon_budget": 1.0,
                "time_clipping_bounds": ["不是日期", "2026-12-31"],
            }
        }
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        config.validate_config()


def test_dp_time_strategy_without_bounds_rejected():
    """有日期超界策略卻沒有界線 → 少填了一半，前置擋掉。"""
    config = DPColumnConfig(
        column_budgets={
            "生日": {
                "type": "datetime",
                "epsilon_budget": 1.0,
                "time_out_of_bounds_strategy": "wrap",
            }
        }
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        config.validate_config()


@pytest.mark.parametrize(
    "field, value",
    [
        ("noise_step", 5),
        ("time_clipping_bounds", ["1930-01-01", "2026-12-31"]),
        ("time_out_of_bounds_strategy", "clamp"),
    ],
)
def test_dp_time_params_only_for_datetime(field, value):
    """日期欄的三個參數設在數值欄上不會生效 → 比照 noise_unit，擋而非靜默忽略。"""
    config = DPColumnConfig(
        column_budgets={"年齡": {"type": "continuous", "epsilon_budget": 1.0, field: value}}
    )
    with pytest.raises(ValueError, match="ERR_DP_INVALID_BUDGET"):
        config.validate_config()
