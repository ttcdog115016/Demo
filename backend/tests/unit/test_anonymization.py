"""
K-匿名化演算法 單元測試
涵蓋：正常流程、邊界情境、欄位型態驗證
"""
import pytest
import pandas as pd
from pydantic import ValidationError

from app.core.config import ColumnConfig, ColumnInfo
from app.engines.anonymization import run_k_anonymity


def _make_simple_config():
    """
    建立只用（地區、職業）作為 QI 的簡化設定。
    在標準 12 筆測試資料中，這兩欄天然形成 6 個 size=2 的等價類，
    適合驗證 K=2 的基本匿名化行為。
    """
    return ColumnConfig(
        columns={
            "姓名":     ColumnInfo(role="identifier",       type="string"),
            "身分證號": ColumnInfo(role="identifier",       type="string"),
            "年齡":     ColumnInfo(role="non_sensitive",    type="numeric"),
            "地區":     ColumnInfo(role="quasi_identifier", type="categorical"),
            "生日":     ColumnInfo(role="non_sensitive",    type="temporal"),
            "疾病":     ColumnInfo(role="sensitive",        type="categorical"),
            "薪資":     ColumnInfo(role="non_sensitive",    type="numeric"),
            "職業":     ColumnInfo(role="quasi_identifier", type="categorical"),
            "婚姻狀況": ColumnInfo(role="non_sensitive",    type="categorical"),
            "就醫次數": ColumnInfo(role="non_sensitive",    type="numeric"),
        }
    )


def test_normal_anonymization(sample_df, salt):
    """正常 K=2 匿名化：identifier 被遮蔽、抑制率為零（地區+職業天然形成 2-size 等價類）"""
    config = _make_simple_config()
    df_out, report = run_k_anonymity(sample_df, config, k=2, suppression_limit_percent=50, salt_key=salt)

    assert report.is_valid is True
    assert report.suppression_rate_percent == 0.0
    # 沒抑制也要給得出筆數：0 列被抑制，分母為原始列數
    assert report.suppressed_count == 0
    assert report.suppression_total_count == len(sample_df)
    # identifier 欄位（姓名、身分證號）應被假名化為完整的 64 碼雜湊（預設 sha3-256，不截短）
    assert df_out["姓名"].apply(len).eq(64).all()
    assert df_out["身分證號"].apply(len).eq(64).all()
    # 不同個體不可碰撞：12 個不同的人應對到 12 個不同的雜湊值
    assert df_out["姓名"].nunique() == 12
    assert df_out["身分證號"].nunique() == 12


def test_identifier_default_hash_no_collision(salt):
    """識別欄位預設 hash：同字數但不同的值不可碰撞成同一雜湊"""
    df = pd.DataFrame(
        {"姓名": ["王小明", "陳大文", "李四好", "張三豐"], "地區": ["A", "A", "B", "B"]}
    )
    config = ColumnConfig(
        columns={
            "姓名": ColumnInfo(role="identifier", type="string"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=2, suppression_limit_percent=100, salt_key=salt)
    # 4 個不同的人 → 4 個不同的雜湊（識別欄位若先遮蔽再雜湊會碰撞）
    assert df_out["姓名"].nunique() == 4


def test_masked_sensitive_with_l_not_false_pass(salt):
    """敏感欄被雜湊卻要求 l → 不給假通過（l_passed=False）並於報告說明矛盾"""
    df = pd.DataFrame(
        {
            "地區": ["A", "A", "B", "B"],
            "疾病": ["流感", "糖尿病", "流感", "感冒"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            # 敏感欄被雜湊：l 檢測會拿亂碼算，本來幾乎必「通過」
            "疾病": ColumnInfo(role="sensitive", type="categorical", strategy="hash"),
        }
    )
    _, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100, l=2, salt_key=salt)
    assert report.l_passed is False  # 不因亂碼多樣而給假的通過
    assert any("已套用遮蔽/雜湊" in rec for rec in report.recommendations)


def test_identifier_none_strategy_still_pseudonymized_and_warns(salt):
    """identifier 設 none（或其他非 remove/hash 策略）→ 仍假名化（安全兜底）並報告提醒，不擋"""
    df = pd.DataFrame(
        {"身分證號": ["A1", "B2", "C3", "D4"], "地區": ["A", "A", "B", "B"]}
    )
    config = ColumnConfig(
        columns={
            "身分證號": ColumnInfo(role="identifier", type="string", strategy="none"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100, salt_key=salt)
    # none 未被採用：身分證號仍被假名化（64 碼雜湊），未明碼輸出
    assert df_out["身分證號"].apply(len).eq(64).all()
    assert set(df_out["身分證號"]) != {"A1", "B2", "C3", "D4"}
    assert any("識別欄位僅支援" in rec for rec in report.recommendations)


def test_identifier_hash_no_spurious_warning(salt):
    """對照：identifier 設 hash（或省略）符合實際行為，不應產生回退假名化之提醒"""
    df = pd.DataFrame(
        {"身分證號": ["A1", "B2", "C3", "D4"], "地區": ["A", "A", "B", "B"]}
    )
    config = ColumnConfig(
        columns={
            "身分證號": ColumnInfo(role="identifier", type="string", strategy="hash"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    _, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100, salt_key=salt)
    assert not any("識別欄位僅支援" in rec for rec in report.recommendations)


def test_missing_salt_falls_back_to_unsalted_hash():
    """未帶鹽值不擋：改對值本身做雜湊，並於報告載明本次沒加鹽。"""
    df = pd.DataFrame({"姓名": ["a", "b"], "地區": ["A", "A"]})
    config = ColumnConfig(
        columns={
            "姓名": ColumnInfo(role="identifier", type="string"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)
    assert df_out["姓名"].apply(len).eq(64).all()
    assert set(df_out["姓名"]) != {"a", "b"}
    assert report.hash_salted is False


def test_salt_changes_the_result_and_is_reported():
    """有鹽與無鹽是兩組不同的代號，報告的 hash_salted 要對得上實際情形。"""
    df = pd.DataFrame({"姓名": ["a", "b"], "地區": ["A", "A"]})
    config = ColumnConfig(
        columns={
            "姓名": ColumnInfo(role="identifier", type="string"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    plain, plain_report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)
    salted, salted_report = run_k_anonymity(
        df, config, k=2, suppression_limit_percent=100, salt_key="s1"
    )
    assert plain["姓名"][0] != salted["姓名"][0]
    assert plain_report.hash_salted is False
    assert salted_report.hash_salted is True


@pytest.mark.parametrize(
    "algorithm, digits",
    [("sha256", 64), ("sha3-256", 64), ("sha3-512", 128)],
)
def test_hash_algorithm_choices(algorithm, digits, salt):
    """三個演算法各跑一次：輸出長度符合該演算法，報告載明用的是哪一個。"""
    df = pd.DataFrame({"姓名": ["a", "b"], "地區": ["A", "A"]})
    config = ColumnConfig(
        columns={
            "姓名": ColumnInfo(role="identifier", type="string"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        },
        algorithm=algorithm,
    )
    df_out, report = run_k_anonymity(
        df, config, k=2, suppression_limit_percent=100, salt_key=salt
    )
    assert df_out["姓名"].apply(len).eq(digits).all()
    assert report.hash_algorithm == algorithm
    assert report.to_dict()["hash_algorithm"] == algorithm


def test_hash_algorithm_defaults_to_sha3_256(salt):
    """設定檔沒寫 algorithm → 預設 sha3-256，且與明寫 sha3-256 的結果相同。"""
    df = pd.DataFrame({"姓名": ["a", "b"], "地區": ["A", "A"]})
    columns = {
        "姓名": ColumnInfo(role="identifier", type="string"),
        "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
    }
    implicit, report = run_k_anonymity(
        df,
        ColumnConfig(columns=columns),
        k=2,
        suppression_limit_percent=100,
        salt_key=salt,
    )
    explicit, _ = run_k_anonymity(
        df,
        ColumnConfig(columns=columns, algorithm="sha3-256"),
        k=2,
        suppression_limit_percent=100,
        salt_key=salt,
    )
    assert report.hash_algorithm == "sha3-256"
    assert implicit["姓名"].tolist() == explicit["姓名"].tolist()


def test_unknown_hash_algorithm_rejected(salt):
    """演算法名稱寫錯一律擋，不靜默退回預設。"""
    df = pd.DataFrame({"姓名": ["a", "b"], "地區": ["A", "A"]})
    config = ColumnConfig(
        columns={
            "姓名": ColumnInfo(role="identifier", type="string"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        },
        algorithm="md5",
    )
    with pytest.raises(ValueError, match="ERR_INVALID_PARAM"):
        run_k_anonymity(df, config, k=2, suppression_limit_percent=100, salt_key=salt)


def test_kanon_treats_use_timestamp_as_an_ordinary_salt():
    """K-匿名不吃 use_timestamp 保留字：它只是一把普通的鹽，同值兩次跑要一樣。"""
    df = pd.DataFrame({"姓名": ["a", "b"], "地區": ["A", "A"]})
    config = ColumnConfig(
        columns={
            "姓名": ColumnInfo(role="identifier", type="string"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    first, _ = run_k_anonymity(
        df, config, k=2, suppression_limit_percent=100, salt_key="use_timestamp"
    )
    second, _ = run_k_anonymity(
        df, config, k=2, suppression_limit_percent=100, salt_key="use_timestamp"
    )
    assert first["姓名"].tolist() == second["姓名"].tolist()


def test_identifier_remove_without_salt():
    """識別欄設 remove、無雜湊欄 → 未給鹽值照常處理，該欄被移除。"""
    df = pd.DataFrame({"姓名": ["a", "b"], "地區": ["A", "A"]})
    config = ColumnConfig(
        columns={
            "姓名": ColumnInfo(role="identifier", type="string", strategy="remove"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)
    assert "姓名" not in df_out.columns


def test_non_qi_generalize_strategy_warns():
    """對非 QI 欄位設 strategy=generalize → 空轉無作用，報告提醒（不擋、值保留）"""
    df = pd.DataFrame(
        {
            "地區": ["A", "A", "B", "B"],
            "疾病": ["流感", "糖尿病", "流感", "感冒"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            # 敏感欄設 generalize → 泛化只作用 QI，這裡空轉
            "疾病": ColumnInfo(role="sensitive", type="categorical", strategy="generalize"),
        }
    )
    df_out, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)
    # 疾病維持原值（未被泛化）
    assert set(df_out["疾病"]) == {"流感", "糖尿病", "感冒"}
    assert any("策略設為 generalize" in rec for rec in report.recommendations)


def test_unmasked_sensitive_l_still_checks_normally():
    """對照：敏感欄未遮蔽時 l 檢測正常進行（矛盾偵測不誤傷正常情況）"""
    df = pd.DataFrame(
        {
            "地區": ["A", "A", "B", "B"],
            "疾病": ["流感", "糖尿病", "流感", "感冒"],  # 每組 2 種 → l=2 通過
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),  # 不遮蔽
        }
    )
    _, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100, l=2)
    assert report.l_passed is True


def test_minmax_applies_min_and_previews_both():
    """欄位設 [min,max] → 實際套用 min，報告同時呈現 min/max 兩端落單比例"""
    # 地區 level1=次級行政區、level2=大區。用資料讓 min 落單較多、max 較少
    df = pd.DataFrame({"地區": ["台北", "桃園", "台中", "彰化"], "疾病": ["感冒"] * 4})
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        },
        generalization_matrices={
            "地區": {
                "mapping": {
                    "台北": ["台北", "北北基", "北部"],
                    "桃園": ["桃園", "桃竹苗", "北部"],
                    "台中": ["台中", "中彰投", "中部"],
                    "彰化": ["彰化", "中彰投", "中部"],
                }
            }
        },
    )
    config.qi_generalization_levels = {"地區": [1, 2]}  # min=1, max=2
    df_out, report = run_k_anonymity(
        df, config, k=2, suppression_limit_percent=100,
    )
    # 實際輸出套用 min（level 1＝次級行政區），非 max
    assert set(df_out["地區"].unique()).issubset({"北北基", "桃竹苗", "中彰投"})
    # 報告有 min/max 範圍評估
    assert any("min/max 範圍評估" in rec for rec in report.recommendations)


def test_minmax_level_value_float_rejected():
    """泛化層級給浮點數 → 解析設定檔時即報錯（整數就是整數）"""
    with pytest.raises(ValueError, match="整數"):
        ColumnConfig(
            columns={"年齡": ColumnInfo(role="quasi_identifier", type="numeric")},
            qi_generalization_levels={"年齡": 1.5},
        )
    # 範圍內含浮點數也擋
    with pytest.raises(ValueError, match="整數"):
        ColumnConfig(
            columns={"年齡": ColumnInfo(role="quasi_identifier", type="numeric")},
            qi_generalization_levels={"年齡": [1, 2.5]},
        )


def test_minmax_min_greater_than_max_rejected():
    """min > max → 報錯"""
    with pytest.raises(ValueError, match="不可大於 max"):
        ColumnConfig(
            columns={"年齡": ColumnInfo(role="quasi_identifier", type="numeric")},
            qi_generalization_levels={"年齡": [3, 1]},
        )


def test_minmax_single_value_unchanged():
    """單一值（固定層級）：不觸發 min/max 範圍評估"""
    df = pd.DataFrame({"年齡": [21, 22, 33, 34], "地區": ["A"] * 4})
    config = ColumnConfig(
        columns={
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        },
    )
    config.qi_generalization_levels = {"年齡": 1}
    _, report = run_k_anonymity(
        df, config, k=2, suppression_limit_percent=100
    )
    assert not any("min/max 範圍評估" in rec for rec in report.recommendations)


def test_k_qi_subset_reduces_suppression():
    """指定 QI 子集算 k → 分組欄位變少、等價類變大、抑制減少（對照整體 k）"""
    # 年齡+地區相同者成大組；加上性別後兩人落單
    df = pd.DataFrame(
        {
            "年齡": [30, 30, 30, 30, 40, 40],
            "地區": ["台北", "台北", "台北", "台北", "台中", "台中"],
            "性別": ["男", "女", "男", "女", "男", "女"],
        }
    )
    cols = {
        "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
        "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        "性別": ColumnInfo(role="quasi_identifier", type="categorical"),
    }
    config = ColumnConfig(columns=cols)

    # 整體 k（全部 3 欄）：k=2 下 (40,台中,男)/(40,台中,女) 各落單 → 抑制 2 列
    _, rep_all = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)
    assert rep_all.suppression_rate_percent > 0  # 有抑制

    # 指定子集 (年齡,地區)：(40,台中) 有 2 人達 k → 0 抑制
    df_sub, rep_sub = run_k_anonymity(
        df, config, k=2, suppression_limit_percent=100, k_qi_subset=["年齡", "地區"]
    )
    assert rep_sub.suppression_rate_percent == 0.0
    assert rep_sub.is_valid is True
    assert len(df_sub) == 6  # 一列都沒被抑制


def test_k_qi_subset_invalid_column_raises():
    """k_qi_subset 指定非 QI／不存在的欄位 → fail fast（k 計算基礎不明確）"""
    df = pd.DataFrame({"年齡": [30, 30], "疾病": ["流感", "感冒"]})
    config = ColumnConfig(
        columns={
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    with pytest.raises(ValueError, match="k_qi_subset"):
        # 疾病是 sensitive、不是 QI
        run_k_anonymity(df, config, k=2, suppression_limit_percent=100, k_qi_subset=["疾病"])


def test_numeric_without_spec_kept_and_warns():
    """數值 QI 未指定 bins/rounding → 維持原值不泛化（系統無預設切法），報告提醒"""
    df = pd.DataFrame({"年齡": [21, 22, 33, 34], "地區": ["A", "A", "B", "B"]})
    config = ColumnConfig(
        columns={
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["年齡"].tolist() == [21, 22, 33, 34]
    assert any("未指定泛化方式" in r and "年齡" in r for r in report.recommendations)


def _age_bins_config(bins):
    return ColumnConfig(
        columns={"年齡": ColumnInfo(role="quasi_identifier", type="numeric")},
        generalization_hierarchies={"年齡": {"bins": bins}},
    )


def test_numeric_bins_custom_boundaries_and_labels():
    """自訂區間：切點與標籤全由使用者寫明，含 null 開放端；下界含、上界不含"""
    df = pd.DataFrame({"年齡": [5, 17, 18, 40, 64, 65, 90]})
    config = _age_bins_config(
        [
            {"min": None, "max": 18, "label": "未成年"},
            {"min": 18, "max": 65, "label": "青壯年"},
            {"min": 65, "max": None, "label": "銀髮族"},
        ]
    )
    df_out, _ = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["年齡"].tolist() == [
        "未成年", "未成年", "青壯年", "青壯年", "青壯年", "銀髮族", "銀髮族"
    ]


def test_numeric_bins_uncovered_marked_and_warned():
    """值超出區間範圍或落在區間之間的空隙 → 標成 * 不回填原值，並於報告統計"""
    df = pd.DataFrame({"年齡": [10, 25, 70, 200]})
    config = _age_bins_config(
        [
            {"min": 0, "max": 20, "label": "少年"},
            # 20~60 刻意留空隙
            {"min": 60, "max": 100, "label": "長者"},
        ]
    )
    df_out, report = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["年齡"].tolist() == ["少年", "*", "長者", "*"]
    assert any("未被任何區間涵蓋" in r and "年齡" in r for r in report.recommendations)


def test_numeric_bins_keeps_empty_empty():
    """空值在數值區間化時維持空值（不無中生有變成未涵蓋標記）"""
    df = pd.DataFrame({"年齡": [30, float("nan")]})
    config = _age_bins_config([{"min": 0, "max": 100, "label": "0-99"}])
    df_out, report = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["年齡"].tolist()[0] == "0-99"
    assert pd.isna(df_out["年齡"].tolist()[1])
    assert not any("未被任何區間涵蓋" in r for r in report.recommendations)


def test_numeric_rounding_keeps_numeric_output():
    """四捨五入：捨到指定倍數（非銀行家捨入），輸出仍是數字而非區間標籤"""
    df = pd.DataFrame({"年齡": [23, 25, 27, 45]})
    config = ColumnConfig(
        columns={"年齡": ColumnInfo(role="quasi_identifier", type="numeric")},
        generalization_hierarchies={"年齡": {"rounding": 10}},
    )
    df_out, _ = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["年齡"].tolist() == [20, 30, 30, 50]
    assert pd.api.types.is_integer_dtype(df_out["年齡"])


def test_numeric_rounding_accepts_any_positive_unit():
    """rounding 不限位數：使用者自訂多大都同一套算法（此處捨到十億）"""
    df = pd.DataFrame({"交易額": [45123456789, 44999999999]})
    config = ColumnConfig(
        columns={"交易額": ColumnInfo(role="quasi_identifier", type="numeric")},
        generalization_hierarchies={"交易額": {"rounding": 1000000000}},
    )
    df_out, _ = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["交易額"].tolist() == [45000000000, 45000000000]


def test_numeric_rounding_infinity_marked_uncovered():
    """無限大無從四捨五入：輸出空值並於報告統計，不中斷處理。"""
    df = pd.DataFrame({"年齡": [23.0, float("inf")]})
    config = ColumnConfig(
        columns={"年齡": ColumnInfo(role="quasi_identifier", type="numeric")},
        generalization_hierarchies={"年齡": {"rounding": 10}},
    )
    df_out, report = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["年齡"].tolist()[0] == 20
    assert pd.isna(df_out["年齡"].tolist()[1])
    assert any("未被任何區間涵蓋" in r and "年齡" in r for r in report.recommendations)


def test_numeric_level_setting_ignored_and_warned():
    """數值欄設了泛化層級 → 切法已由設定檔寫明、層級不生效，報告提醒（不擋）"""
    df = pd.DataFrame({"年齡": [23, 25]})
    config = ColumnConfig(
        columns={"年齡": ColumnInfo(role="quasi_identifier", type="numeric")},
        generalization_hierarchies={"年齡": {"rounding": 10}},
        qi_generalization_levels={"年齡": 3},
    )
    df_out, report = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["年齡"].tolist() == [20, 30]  # 與沒設層級時相同
    assert any("不分層級" in r and "年齡" in r for r in report.recommendations)


def test_partial_mask_prefix_selectable():
    """strategy=partial 可經欄位設定選用（保留前綴 N 字，其餘遮蔽）"""
    df = pd.DataFrame({"電話": ["0912345678", "0987654321"], "地區": ["A", "B"]})
    config = ColumnConfig(
        columns={
            "電話": ColumnInfo(role="non_sensitive", type="string", strategy="partial", keep_chars=4),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    # 保留前 4 碼，其餘變 *
    assert df_out["電話"].iloc[0] == "0912******"
    assert df_out["電話"].iloc[1] == "0987******"


def test_partial_mask_suffix():
    """部分遮蔽 suffix 模式：保留後綴 N 字"""
    df = pd.DataFrame({"帳號": ["ABCDEFGH"], "地區": ["A"]})
    config = ColumnConfig(
        columns={
            "帳號": ColumnInfo(
                role="non_sensitive", type="string", strategy="partial",
                keep_chars=2, mask_mode="suffix",
            ),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["帳號"].iloc[0] == "******GH"  # 保留後 2 字


def test_fixed_char_mask_via_mask_char():
    """固定字元遮蔽＝全遮蔽搭自訂 mask_char（規格兩者同機制）"""
    df = pd.DataFrame({"密": ["abc"], "地區": ["A"]})
    config = ColumnConfig(
        columns={
            "密": ColumnInfo(role="non_sensitive", type="string", strategy="mask", mask_char="#"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["密"].iloc[0] == "###"


def test_full_mask_fixed_length_hides_original_length():
    """全遮蔽設 mask_length：長短不同的原值輸出同樣長度，不由星號數量反推原值長度"""
    df = pd.DataFrame({"卡號": ["1234567890123456", "A99"], "地區": ["A", "A"]})
    config = ColumnConfig(
        columns={
            "卡號": ColumnInfo(
                role="non_sensitive", type="string", strategy="mask", mask_length=4
            ),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["卡號"].iloc[0] == "****"
    assert df_out["卡號"].iloc[1] == "****"


def test_full_mask_without_length_keeps_original_length():
    """未設 mask_length 時輸出長度等於原值長度"""
    df = pd.DataFrame({"卡號": ["1234567890123456", "A99"], "地區": ["A", "A"]})
    config = ColumnConfig(
        columns={
            "卡號": ColumnInfo(role="non_sensitive", type="string", strategy="mask"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert df_out["卡號"].iloc[0] == "*" * 16
    assert df_out["卡號"].iloc[1] == "***"


def test_mask_length_must_be_positive():
    """mask_length 為 0 或負數沒有意義，於設定檔解析時即擋下"""
    with pytest.raises(ValidationError):
        ColumnInfo(role="non_sensitive", type="string", strategy="mask", mask_length=0)


def test_config_accepts_partial_strategy():
    """config 驗證應接受 partial"""
    info = ColumnInfo(role="non_sensitive", type="string", strategy="partial")
    assert info.strategy == "partial"


def test_remove_works_for_qi_and_sensitive():
    """remove 對 QI/敏感欄位也生效（不只限 identifier），且不影響其餘欄位匿名化"""
    df = pd.DataFrame(
        {
            "地區": ["A", "A", "B", "B"],
            "多餘QI": ["x", "y", "z", "w"],
            "疾病": ["流感", "感冒", "流感", "糖尿病"],
            "備註": ["m", "n", "o", "p"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "多餘QI": ColumnInfo(role="quasi_identifier", type="string", strategy="remove"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
            "備註": ColumnInfo(role="non_sensitive", type="string", strategy="remove"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)
    assert "多餘QI" not in df_out.columns   # QI 設 remove → 刪欄
    assert "備註" not in df_out.columns      # non_sensitive 設 remove → 刪欄
    assert "地區" in df_out.columns          # 其餘欄位不受影響、正常匿名化
    assert "疾病" in df_out.columns


def test_clear_keeps_column_but_empties_values():
    """clear：欄位留在輸出裡、值全部清空（與 remove 的差別只在欄位在不在）"""
    df = pd.DataFrame(
        {
            "交易編號": ["T001", "T002", "T003", "T004"],
            "地區": ["A", "A", "B", "B"],
            "備註": ["m", "n", "o", "p"],
            "疾病": ["流感", "感冒", "流感", "糖尿病"],
        }
    )
    config = ColumnConfig(
        columns={
            "交易編號": ColumnInfo(role="identifier", type="string", strategy="clear"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "備註": ColumnInfo(role="non_sensitive", type="string", strategy="clear"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)
    # 識別欄與一般欄都要留著欄位、值全空
    assert "交易編號" in df_out.columns
    assert "備註" in df_out.columns
    assert df_out["交易編號"].isna().all()
    assert df_out["備註"].isna().all()
    # clear 是有效處理，不該被當成「策略放錯角色」而回退成假名化
    assert not any("回退為假名化" in r for r in report.recommendations)


def test_clear_identifier_without_salt():
    """識別欄設 clear 不經過雜湊，未給鹽值照常處理，值全部清空"""
    df = pd.DataFrame(
        {
            "交易編號": ["T001", "T002", "T003", "T004"],
            "地區": ["A", "A", "B", "B"],
            "疾病": ["流感", "感冒", "流感", "糖尿病"],
        }
    )
    config = ColumnConfig(
        columns={
            "交易編號": ColumnInfo(role="identifier", type="string", strategy="clear"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=2, suppression_limit_percent=100, salt_key=None)
    assert df_out["交易編號"].isna().all()


def test_no_qi_after_removal_warns_not_false_valid():
    """刪光 QI（或未提供）且 k>1 → 未執行 k-匿名，不給假綠燈（is_valid≠True）並報告提醒"""
    df = pd.DataFrame({"地區": ["A", "B", "C", "D"], "疾病": ["流感", "感冒", "流感", "糖尿病"]})
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical", strategy="remove"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)
    assert "地區" not in df_out.columns
    assert report.is_valid is False
    assert report.k_passed is False
    assert any("未偵測到準識別欄位" in rec for rec in report.recommendations)


def test_lt_requested_without_sensitive_warns():
    """設了 l 但無敏感欄位 → 未執行 l 檢測，不給假通過並報告提醒"""
    df = pd.DataFrame({"地區": ["A", "A", "B", "B"], "年齡": [1, 1, 1, 1]})
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
        }
    )
    _, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100, l=2)
    assert report.l_passed is False
    assert any("未偵測到敏感欄位" in rec for rec in report.recommendations)


def test_no_sensitive_without_lt_no_warning():
    """對照：沒設 l/t 時，沒有敏感欄位不應產生警示（避免噪音）"""
    df = pd.DataFrame({"地區": ["A", "A", "B", "B"], "年齡": [1, 1, 1, 1]})
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
        }
    )
    _, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)  # 不設 l/t
    assert not any("未偵測到敏感欄位" in rec for rec in report.recommendations)


def test_value_not_in_matrix_reported():
    """類別值不在矩陣被泛化為 '*'，應於報告統計格數與比例（不擋）"""
    df = pd.DataFrame(
        {
            "地區": ["台北市", "花蓮縣", "台北市", "台東縣"],  # 花蓮縣、台東縣不在矩陣
            "年齡": [1, 1, 1, 1],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
        },
        generalization_matrices={"地區": {"mapping": {"台北市": ["台北市", "北部"]}}},  # 只收錄台北市
    )
    config.qi_generalization_levels = {"地區": 1}
    df_out, report = run_k_anonymity(
        df, config, k=1, suppression_limit_percent=100
    )
    # 不在矩陣的兩筆被泛化為 *
    assert (df_out["地區"] == "*").sum() == 2
    # 報告有統計提醒
    assert any("不在您提供的類別階層中" in rec for rec in report.recommendations)


def test_categorical_generalize_keeps_empty_empty():
    """空值在類別泛化時應保持空值（不無中生有變成 '*'）；'有值但不在矩陣' 才是 '*'"""
    df = pd.DataFrame(
        {
            "地區": ["台北市", None, "花蓮縣", "台北市"],  # None=空值；花蓮縣=有值但不在矩陣
            "年齡": [1, 1, 1, 1],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
        },
        generalization_matrices={"地區": {"mapping": {"台北市": ["台北市", "北部"]}}},  # 只收錄台北市
    )
    config.qi_generalization_levels = {"地區": 1}
    df_out, _ = run_k_anonymity(
        df, config, k=1, suppression_limit_percent=100
    )
    vals = df_out["地區"].tolist()
    assert vals[0] == "北部"          # 有值且在矩陣 → 泛化
    assert pd.isna(vals[1])           # 空值 → 保持空值（非 "*"）
    assert vals[2] == "*"             # 有值但不在矩陣 → "*"
    assert vals[3] == "北部"


def test_level_exceeds_matrix_depth_warns():
    """類別欄 level 超過矩陣深度 → 夾到最粗級照跑，報告提醒（不擋、不報錯）"""
    df = pd.DataFrame({"地區": ["台北市", "台北市", "高雄市", "高雄市"]})
    config = ColumnConfig(
        columns={"地區": ColumnInfo(role="quasi_identifier", type="categorical")},
        # 矩陣深度 2（level1=北/南部、level2=台灣）；設 level=5 超過
        generalization_matrices={
            "地區": {
                "mapping": {
                    "台北市": ["台北市", "北部", "台灣"],
                    "高雄市": ["高雄市", "南部", "台灣"],
                }
            }
        },
    )
    config.qi_generalization_levels = {"地區": 5}
    df_out, report = run_k_anonymity(
        df, config, k=2, suppression_limit_percent=100
    )
    # 被夾到最粗級（台灣），不報錯
    assert set(df_out["地區"].unique()) == {"台灣"}
    assert any("階層可提供的深度" in rec and "地區" in rec for rec in report.recommendations)


def test_qi_level_nonexistent_column_raises():
    """泛化層級引用資料中不存在的欄位（打錯欄名）→ 資料層對不上，前置驗證擋（fail fast）"""
    df = pd.DataFrame({"地區": ["A", "A", "B", "B"], "疾病": ["流感", "感冒", "流感", "糖尿病"]})
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    config.qi_generalization_levels = {"薪水": 3}  # "薪水" 資料裡不存在
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH"):
        run_k_anonymity(df, config, k=2)


def test_qi_level_non_qi_column_warns_not_blocked():
    """泛化層級指向存在但非 QI 的欄位 → 設定邏輯無效，不擋，報告提醒"""
    df = pd.DataFrame({"地區": ["A", "A", "B", "B"], "疾病": ["流感", "感冒", "流感", "糖尿病"]})
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    # "疾病" 存在但是 sensitive，不是 QI → 應正常執行並在報告提醒
    config.qi_generalization_levels = {"疾病": 1}
    df_out, report = run_k_anonymity(
        df, config, k=2, suppression_limit_percent=100
    )
    assert df_out is not None
    assert any("並非準識別欄位" in rec for rec in report.recommendations)


def test_t_zero_triggers_check_not_skipped():
    """t=0（最嚴格門檻）必須真的檢測，不得被當成未設定而靜默跳過。

    構造一個等價類內敏感值分佈與全域不一致的資料：t=0 要求分佈完全相同，
    故 t_passed 應為 False（而非因跳過而顯示 True）。
    """
    df = pd.DataFrame(
        {
            "地區": ["A", "A", "B", "B"],
            "疾病": ["流感", "流感", "流感", "糖尿病"],  # 全域非單一值；A 組全流感 → 與全域分佈有距離
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    _, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100, t=0.0)
    assert report.t_passed is False  # t=0 也要檢測，不可當成未設定而略過


def test_t_none_skips_check():
    """t 未設定（None）時不進行 t-closeness 檢測，t_passed 維持 True"""
    df = pd.DataFrame(
        {
            "地區": ["A", "A", "B", "B"],
            "疾病": ["流感", "流感", "流感", "糖尿病"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    _, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)  # t 不給
    assert report.t_passed is True


def test_identifier_explicit_remove(salt):
    """識別欄位明確指定 strategy=remove 時才整欄移除，預設則保留為雜湊"""
    df = pd.DataFrame(
        {"姓名": ["a", "b", "c", "d"], "病歷號": [1, 2, 3, 4], "地區": ["A", "A", "B", "B"]}
    )
    config = ColumnConfig(
        columns={
            "姓名": ColumnInfo(role="identifier", type="string"),  # 預設 → 保留雜湊
            "病歷號": ColumnInfo(role="identifier", type="numeric", strategy="remove"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=2, suppression_limit_percent=100, salt_key=salt)
    assert "病歷號" not in df_out.columns  # 明確 remove → 移除
    assert "姓名" in df_out.columns         # 預設 → 保留
    assert df_out["姓名"].apply(len).eq(64).all()


def test_anonymization_output_columns(sample_df, salt):
    """輸出的 DataFrame 欄位數量應與輸入相同 (10 欄)"""
    config = _make_simple_config()
    df_out, _ = run_k_anonymity(sample_df, config, k=2, suppression_limit_percent=50, salt_key=salt)
    assert len(df_out.columns) == 10


def test_suppression_warn_mode(sample_df, sample_config, salt):
    """limit_exceeded_action=allow_with_warning 時，即使超出抑制上限也應成功回傳（不拋例外）"""
    df_out, report = run_k_anonymity(
        sample_df, sample_config, k=2, suppression_limit_percent=0, limit_exceeded_action="allow_with_warning", salt_key=salt
    )
    assert df_out is not None


def test_suppression_error_mode_raises():
    """列抑制率超限且 limit_exceeded_action=stop_and_error 時應拋出 ValueError。

    2 筆不同地區、k=2 → 各自落單（等價類 size 1 < 2）→ 抑制率 100% > 上限 0%。
    """
    df = pd.DataFrame({"地區": ["北部", "中部"]})
    config = ColumnConfig(
        columns={"地區": ColumnInfo(role="quasi_identifier", type="categorical")}
    )
    with pytest.raises(ValueError, match="ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED"):
        run_k_anonymity(df, config, k=2, suppression_limit_percent=0, limit_exceeded_action="stop_and_error")


def test_invalid_suppression_method_raises(sample_df, sample_config):
    """suppression_method 打錯（如 'celll'）應直接拋錯，不得靜默退回列抑制"""
    with pytest.raises(ValueError, match="不合法的 suppression_method"):
        run_k_anonymity(sample_df, sample_config, k=2, suppression_method="celll")


def test_invalid_limit_exceeded_action_raises(sample_df, sample_config):
    """limit_exceeded_action 打錯（如 'errr'）應直接拋錯，不得被靜默當成 warn"""
    with pytest.raises(ValueError, match="不合法的 limit_exceeded_action"):
        run_k_anonymity(sample_df, sample_config, k=2, limit_exceeded_action="errr")


@pytest.mark.parametrize("bad", [-1, 101, "20%"])
def test_suppression_limit_percent_out_of_range_raises(sample_df, sample_config, bad):
    """抑制上限以百分比收，超出 0~100 或非數字應前置擋下，不得跑完資料才發現"""
    with pytest.raises(ValueError, match="不合法的 suppression_limit_percent"):
        run_k_anonymity(sample_df, sample_config, k=2, suppression_limit_percent=bad)


def test_suppression_limit_percent_is_percent_not_ratio(sample_df, salt):
    """上限 100 代表 100%（全抑制也不算超限）；若被當成比例 1.0 會誤判超限"""
    config = _make_simple_config()
    _, report = run_k_anonymity(
        sample_df, config, k=2, suppression_limit_percent=100, salt_key=salt
    )
    assert report.suppression_rate_percent <= 100


def test_choice_params_case_insensitive(sample_df, salt):
    """大小寫寬容：'Row'/'WARN' 視為明確意圖，正規化後照常執行"""
    config = _make_simple_config()
    df_out, report = run_k_anonymity(
        sample_df, config, k=2, suppression_method="ROW_SUPPRESSION", limit_exceeded_action="ALLOW_WITH_WARNING", salt_key=salt
    )
    assert df_out is not None
    assert report.suppression_unit == "row"


def test_limit_exceeded_action_error_case_insensitive():
    """'Error' 應等同 'error'：超限時要真的拋錯（保險必須掛得上）"""
    df = pd.DataFrame({"地區": ["北部", "中部"]})
    config = ColumnConfig(
        columns={"地區": ColumnInfo(role="quasi_identifier", type="categorical")}
    )
    # 兩列各自落單 → 抑制率 100% > 上限 0%
    with pytest.raises(ValueError, match="ERR_ANONYMIZATION_SUPPRESSION_EXCEEDED"):
        run_k_anonymity(df, config, k=2, suppression_limit_percent=0, limit_exceeded_action="Stop_And_Error")


def test_k_exceeds_n_raises(sample_df, sample_config):
    """K 值大於資料筆數時，應拋出帶錯誤碼的 ValueError"""
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH: K 值設定與資料源規模不符"):
        run_k_anonymity(sample_df, sample_config, k=100)


def test_missing_column_raises():
    """設定檔中指定的欄位不存在於資料中，應拋出 ValueError"""
    df = pd.DataFrame({"A": [1, 2, 3]})
    config = ColumnConfig(
        columns={"不存在的欄位": ColumnInfo(role="quasi_identifier", type="numeric")}
    )
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH: 設定檔宣告的欄位"):
        run_k_anonymity(df, config, k=2)


def test_cell_suppression_keeps_sensitive_and_cell_based_rate():
    """值抑制：只挖 QI 欄位、保留敏感欄位，且抑制率採『格』基準"""
    df = pd.DataFrame(
        {
            "地區": ["北", "北", "北", "南", "南"],
            "性別": ["男", "男", "女", "女", "女"],
            "疾病": ["感冒", "高血壓", "糖尿病", "感冒", "過敏"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "性別": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(
        df, config, k=2, suppression_method="cell_suppression", suppression_limit_percent=100
    )
    # 值抑制保留列：5 列不變
    assert len(df_out) == 5
    # 違規列（北/女）的地區被挖成 "*"；挖空後與兩列（南/女）相容，湊滿 k，性別不必再挖
    star_rows = df_out[df_out["地區"] == "*"]
    assert len(star_rows) == 1
    assert star_rows["性別"].iloc[0] == "女"
    # 但該列的敏感欄位「疾病」應保留原值（不被一起挖掉）
    assert star_rows["疾病"].iloc[0] == "糖尿病"
    assert report.k_passed is True
    # 抑制率採格基準：1 格；總格數 5×3 = 15
    assert report.suppression_unit == "cell"
    assert abs(report.suppression_rate_percent - 100 * (1 / 15)) < 1e-9


def test_quality_report_exposes_suppression_counts():
    """抑制量要能程式化取得：列抑制報列數、值抑制報格數，分母各自對應其單位"""
    df = pd.DataFrame(
        {
            "地區": ["北", "北", "北", "南", "南"],
            "性別": ["男", "男", "女", "女", "女"],
            "疾病": ["感冒", "高血壓", "糖尿病", "感冒", "過敏"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "性別": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    # 列抑制：(北,女) 這 1 列落單被刪 → 1 / 5 列
    _, rep_row = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)
    assert rep_row.suppression_unit == "row"
    assert rep_row.suppressed_count == 1
    assert rep_row.suppression_total_count == 5

    # 值抑制：該列只挖地區 1 格即達標 → 1 / (5 列 × 3 欄) 格
    _, rep_cell = run_k_anonymity(
        df, config, k=2, suppression_method="cell_suppression", suppression_limit_percent=100
    )
    assert rep_cell.suppression_unit == "cell"
    assert rep_cell.suppressed_count == 1
    assert rep_cell.suppression_total_count == 15
    # 分子分母與百分比得對得起來，看報告的人不必自行換算
    assert abs(rep_cell.suppression_rate_percent - 100 * 1 / 15) < 1e-9


def test_cell_suppression_only_digs_columns_it_needs():
    """值抑制只挖到達標為止：落單原因在年齡，地區與職業應原封不動"""
    df = pd.DataFrame(
        {
            "地區": ["A"] * 4 + ["B"] * 4,
            "職業": ["工程師"] * 4 + ["教師"] * 4,
            "年齡": [30, 30, 30, 30, 41, 42, 43, 44],
            "疾病": ["感冒", "高血壓", "糖尿病", "過敏"] * 2,
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "職業": ColumnInfo(role="quasi_identifier", type="categorical"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(
        df, config, k=4, suppression_method="cell_suppression", suppression_limit_percent=100
    )
    assert report.k_passed is True
    # 只有年齡被挖，另外兩個 QI 欄一格都沒動
    assert (df_out["年齡"] == "*").sum() == 4
    assert df_out["地區"].tolist() == ["A"] * 4 + ["B"] * 4
    assert df_out["職業"].tolist() == ["工程師"] * 4 + ["教師"] * 4
    # 抑制率＝4 格 ÷ (8 列 × 4 欄)
    assert abs(report.suppression_rate_percent - 100 * (4 / 32)) < 1e-9
    # 實際挖了哪幾欄要寫進報告，否則會被當成漏處理
    assert any("實際挖除欄位" in r and "年齡" in r for r in report.recommendations)


def test_cell_suppression_digs_next_column_when_one_is_not_enough():
    """第一輪挖完仍有列未達標 → 續挖下一欄，已達標的列不再被動"""
    df = pd.DataFrame(
        {
            "地區": ["x", "x", "y", "z"],
            "年齡": [1, 2, 3, 4],
            "疾病": ["感冒", "高血壓", "糖尿病", "過敏"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(
        df, config, k=2, suppression_method="cell_suppression", suppression_limit_percent=100
    )
    assert report.k_passed is True
    # 年齡（相異值最多）先被挖光；地區只有第二輪的 y／z 兩列被挖，x 兩列保留
    assert (df_out["年齡"] == "*").all()
    assert df_out["地區"].tolist() == ["x", "x", "*", "*"]


def test_cell_suppression_all_qi_dug_out_counts_as_anonymous():
    """違規列總數本身就少於 k → 挖光 QI 欄後那幾列與每一列都相容，等價類大小＝總列數。"""
    df = pd.DataFrame(
        {
            "地區": ["A"] * 6 + ["B", "B"],
            "年齡": [10] * 6 + [77, 88],
            "疾病": ["感冒"] * 6 + ["高血壓", "糖尿病"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(
        df, config, k=5, suppression_method="cell_suppression", suppression_limit_percent=100
    )
    assert report.k_passed is True
    assert df_out["地區"].tolist()[-2:] == ["*", "*"]
    assert df_out["年齡"].tolist()[-2:] == ["*", "*"]
    # 未被抑制的列照舊以實際值分組，不受影響
    assert df_out["地區"].tolist()[:6] == ["A"] * 6


def test_cell_suppression_counts_as_anonymous_for_every_fill_style():
    """三種填法（*、空值、最高階層）語意相同，k 判定一致：挖空的列都不算未達 k。"""
    df = pd.DataFrame(
        {
            "地區": ["A"] * 6 + ["B", "B"],
            "年齡": [10] * 6 + [77, 88],
            "疾病": ["感冒"] * 6 + ["高血壓", "糖尿病"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical", cell_fill_value="全區"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    for fill in ("star", "missing"):
        _, report = run_k_anonymity(
            df,
            config,
            k=5,
            suppression_method="cell_suppression",
            suppression_limit_percent=100,
            cell_fill=fill,
        )
        assert report.k_passed is True, fill


def test_cell_suppression_rows_still_checked_for_l():
    """挖過的列仍要做 l 檢測：只挖了地區、年齡還看得到，知道年齡 20 就知道是糖尿病"""
    df = pd.DataFrame(
        {
            "地區": ["A"] * 6 + ["B", "C", "D"],
            "年齡": [10] * 6 + [20] * 3,
            "疾病": ["感冒", "高血壓"] * 3 + ["糖尿病"] * 3,
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(
        df, config, k=3, l=2, suppression_method="cell_suppression", suppression_limit_percent=100
    )
    assert df_out["地區"].tolist()[-3:] == ["*"] * 3
    assert df_out["年齡"].tolist()[-3:] == [20] * 3
    assert report.k_passed is True
    assert report.l_passed is False


def _brute_force_wildcard_sizes(keys: pd.DataFrame) -> list[int]:
    """逐列兩兩比對的參考算法：每欄值相同或任一方為空即相容。
    QI 多於一欄時，不含空值的列不計入 QI 全為空的列；QI 全為空的列＝總列數。"""
    rows = keys.to_numpy(dtype=object)
    na = keys.isna().to_numpy()
    n, q = na.shape
    sizes = []
    for i in range(n):
        if na[i].all():
            sizes.append(n)
            continue
        total = 0
        for j in range(n):
            if q > 1 and not na[i].any() and na[j].all():
                continue
            if all(na[i, c] or na[j, c] or rows[i, c] == rows[j, c] for c in range(q)):
                total += 1
        sizes.append(total)
    return sizes


@pytest.mark.parametrize("n_cols", [1, 2, 3])
def test_wildcard_group_sizes_matches_pairwise_reference(n_cols):
    import numpy as np

    from app.engines.anonymization.metrics import wildcard_group_sizes

    rng = np.random.default_rng(n_cols)
    for _ in range(20):
        data = {
            f"q{c}": rng.choice(["a", "b", "c", None], size=30, p=[0.35, 0.25, 0.15, 0.25])
            for c in range(n_cols)
        }
        keys = pd.DataFrame(data)
        got = wildcard_group_sizes(keys).tolist()
        assert got == _brute_force_wildcard_sizes(keys)


def test_wildcard_group_sizes_examples():
    import numpy as np

    from app.engines.anonymization.metrics import wildcard_group_sizes

    keys = pd.DataFrame(
        {
            "地區": ["A", "A", np.nan, "B", np.nan],
            "年齡": [10, 10, 10, 20, np.nan],
        }
    )
    # (A,10)：自己兩列＋(缺,10)＝3，不計 QI 全空那列；(缺,10)：(A,10)×2＋自己＋全空列＝4；
    # (B,20)：只有自己；全空列＝總列數 5
    assert wildcard_group_sizes(keys).tolist() == [3, 3, 4, 1, 5]


def test_cell_suppression_fill_missing_keeps_numeric_dtype():
    """值抑制填空值：格子變空、且數值欄仍是數值欄（不因塞字串被轉成文字）"""
    df = pd.DataFrame({"年齡": [25, 99, 40, 40], "疾病": ["感冒", "高血壓", "糖尿病", "感冒"]})
    config = ColumnConfig(
        columns={
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    # 25 與 99 各自落單（k=2）→ 被抑制；40 有兩列達標 → 保留
    df_out, report = run_k_anonymity(
        df, config, k=2, suppression_method="cell_suppression", cell_fill="missing", suppression_limit_percent=100
    )
    assert len(df_out) == 4
    assert df_out["年齡"].isna().tolist() == [True, True, False, False]
    # 關鍵：欄位型別未被汙染成 object，仍可直接做數值運算
    assert pd.api.types.is_numeric_dtype(df_out["年齡"])
    assert df_out["年齡"].max() == 40
    # 沒有任何格子被填成星號
    assert not (df_out["年齡"].astype(object) == "*").any()
    assert report.suppression_unit == "cell"
    # 被抑制的兩列同為空值＝在攻擊者眼中無法區分＝同一等價類（2 筆），達 k=2
    assert report.k_passed is True


def test_all_missing_qi_group_counted_by_rows():
    """QI 全為缺值的等價類，應以「列數」計算是否達 k，不可被算成 0 筆而恆判未達標"""
    import numpy as np

    # 三列年齡皆缺值：彼此無法區分＝同一等價類（3 筆），k=3 應通過且不觸發抑制
    df = pd.DataFrame(
        {"年齡": [np.nan, np.nan, np.nan], "疾病": ["感冒", "高血壓", "糖尿病"]}
    )
    config = ColumnConfig(
        columns={
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(df, config, k=3, suppression_limit_percent=100)
    assert len(df_out) == 3
    assert report.k_passed is True
    assert report.suppression_rate_percent == 0.0

    # 缺值視為萬用字元：缺值兩列與 30 那列都相容，三列的等價類大小皆為 3，不必抑制
    df2 = pd.DataFrame({"年齡": [np.nan, np.nan, 30], "疾病": ["感冒", "高血壓", "糖尿病"]})
    out2, report2 = run_k_anonymity(df2, config, k=3, suppression_limit_percent=100)
    assert len(out2) == 3
    assert report2.k_passed is True


def test_cell_fill_defaults_to_star():
    """未指定 cell_fill 時預設填 *"""
    df = pd.DataFrame({"年齡": [25, 99], "疾病": ["感冒", "高血壓"]})
    config = ColumnConfig(
        columns={
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, _ = run_k_anonymity(df, config, k=2, suppression_method="cell_suppression", suppression_limit_percent=100)
    assert df_out["年齡"].tolist() == ["*", "*"]


def test_cell_fill_value_per_column():
    """設定檔逐欄指定 cell_fill_value：該欄填指定值，未指定的欄沿用全域填法"""
    df = pd.DataFrame(
        {
            "地區": ["台北", "高雄", "台中"],
            "性別": ["男", "女", "男"],
            "疾病": ["感冒", "高血壓", "糖尿病"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(
                role="quasi_identifier", type="categorical", cell_fill_value="台灣"
            ),
            "性別": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    # 三列各自落單（k=3）→ 全部被抑制
    df_out, report = run_k_anonymity(
        df, config, k=3, suppression_method="cell_suppression", suppression_limit_percent=100
    )
    assert df_out["地區"].tolist() == ["台灣", "台灣", "台灣"]   # 逐欄指定值
    assert df_out["性別"].tolist() == ["*", "*", "*"]             # 沿用全域預設
    assert df_out["疾病"].tolist() == ["感冒", "高血壓", "糖尿病"]  # 敏感欄不動
    # 三列在 QI 上變得完全相同＝同一等價類 3 筆，達 k=3
    assert report.k_passed is True


def test_cell_fill_value_numeric_is_coerced_and_blank_rejected():
    """cell_fill_value：填數字照實轉字串收下；填空字串則於解析設定檔時即報錯"""
    info = ColumnInfo(role="quasi_identifier", type="numeric", cell_fill_value=0)
    assert info.cell_fill_value == "0"

    with pytest.raises(ValueError, match="cell_fill_value 不可為空字串"):
        ColumnInfo(role="quasi_identifier", type="categorical", cell_fill_value="   ")


def test_cell_fill_value_on_non_qi_warns_not_blocks():
    """cell_fill_value 設在非 QI 欄位：不擋，但於報告提醒此設定不會生效"""
    df = pd.DataFrame({"地區": ["北", "北"], "疾病": ["感冒", "高血壓"]})
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(
                role="sensitive", type="categorical", cell_fill_value="不明"
            ),
        }
    )
    _, report = run_k_anonymity(df, config, k=2, suppression_method="cell_suppression", suppression_limit_percent=100)
    assert any("並非準識別欄位" in r and "cell_fill_value" in r for r in report.recommendations)


def test_invalid_cell_fill_raises(sample_df, sample_config):
    """cell_fill 打錯（如 'missng'）應直接拋錯，不得靜默退回填星號"""
    with pytest.raises(ValueError, match="不合法的 cell_fill"):
        run_k_anonymity(sample_df, sample_config, k=2, cell_fill="missng")


def test_row_suppression_unit_is_row():
    """列抑制：抑制率計量單位應為 row"""
    df = pd.DataFrame(
        {"地區": ["北", "北", "南"], "疾病": ["感冒", "高血壓", "糖尿病"]}
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    _, report = run_k_anonymity(
        df, config, k=2, suppression_method="row_suppression", suppression_limit_percent=100
    )
    assert report.suppression_unit == "row"


def test_string_length_grading():
    """字串 QI 設 mask_mode=length 時，應輸出長度級距標籤而非保留前綴"""
    df = pd.DataFrame(
        {"代號": ["ab", "abcde", "abcdefgh", "a"], "地區": ["A", "A", "B", "B"]}
    )
    config = ColumnConfig(
        columns={
            "代號": ColumnInfo(role="quasi_identifier", type="string", mask_mode="length"),
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
        },
        qi_generalization_levels={"代號": 1},
    )
    # k=1 不觸發抑制，純看泛化結果；預設長度級距寬 5
    df_out, _ = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    # 長度 2,5,8,1 → 級距 0-4, 5-9, 5-9, 0-4
    assert df_out["代號"].tolist() == ["0-4", "5-9", "5-9", "0-4"]


def test_nan_qi_does_not_escape_suppression():
    """QI 含缺值（NaN）的列不可逃過 k 抑制：缺值只放寬比對、不讓非缺值的欄位被忽略"""
    import numpy as np

    df = pd.DataFrame(
        {
            "地區": ["A", "B", "A"],
            "年齡": [np.nan, 30, 40],
            "疾病": ["感冒", "高血壓", "糖尿病"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    # k=2：(A,缺) 與 (A,40) 相容→各 2；(B,30) 與誰都不相容→1，列抑制只刪這一列
    df_out, report = run_k_anonymity(
        df, config, k=2, suppression_method="row_suppression", suppression_limit_percent=100
    )
    assert df_out["地區"].tolist() == ["A", "A"]
    assert report.k_passed is True


def test_star_suppression_on_numeric_column_no_error():
    """數值欄位被抑制為 '*' 時不應因型別衝突而出錯（l / t / cell 三路）"""
    df = pd.DataFrame({"地區": ["A", "A", "B", "B"], "收入": [40000, 41000, 90000, 91000]})
    cfg = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "收入": ColumnInfo(role="sensitive", type="numeric"),
        }
    )
    # 數值敏感欄 + t：應正常完成、不拋 TypeError
    out_t, _ = run_k_anonymity(df.copy(), cfg, k=2, t=0.3, suppression_limit_percent=100)
    assert len(out_t) == 4

    # 數值 QI + cell 值抑制：同樣應正常完成
    df2 = pd.DataFrame({"年齡": [25, 99], "疾病": ["感冒", "高血壓"]})
    cfg2 = ColumnConfig(
        columns={
            "年齡": ColumnInfo(role="quasi_identifier", type="numeric"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    out_c, _ = run_k_anonymity(df2, cfg2, k=2, suppression_method="cell_suppression", suppression_limit_percent=100)
    assert out_c["年齡"].tolist() == ["*", "*"]


def test_t_closeness_detects_but_does_not_modify_data():
    """t-closeness 僅『檢測+建議』：違規應回報 t_passed=False，但不得修改敏感欄位資料。

    依規格 2.1(4)：l/t 只要求自動檢測與調整建議，系統不得自動改資料來強制達成。
    """
    # 全域疾病分佈 50/50；A 組全感冒、B 組全高血壓（皆極端偏斜 → t 不過），
    # C 組 50/50（與全域一致 → t 通過）
    df = pd.DataFrame(
        {
            "地區": ["A", "A", "B", "B", "C", "C"],
            "疾病": ["感冒", "感冒", "高血壓", "高血壓", "感冒", "高血壓"],
        }
    )
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        }
    )
    df_out, report = run_k_anonymity(df, config, k=2, t=0.3, suppression_limit_percent=100)
    # 檢測：t 不達標應如實回報
    assert report.t_passed is False
    # 但敏感欄位完全不得被修改（不自動遮蔽）→ 原值全保留、無任何 "*"
    assert "*" not in df_out["疾病"].tolist()
    assert df_out["疾病"].tolist() == ["感冒", "感冒", "高血壓", "高血壓", "感冒", "高血壓"]
    # 建議清單應提示敏感欄位檢測未通過
    assert any("t-closeness" in r or "敏感" in r for r in report.recommendations)


def test_format_without_level_warns():
    """定義了泛化格式（階層矩陣）卻沒給 level 時，應於建議清單警示且不泛化"""
    # 地區天然成對（各組 size=2），避免被 k 抑制干擾觀察
    df = pd.DataFrame({"地區": ["台北", "台北", "台中", "台中"], "疾病": ["感冒"] * 4})
    config = ColumnConfig(
        columns={
            "地區": ColumnInfo(role="quasi_identifier", type="categorical"),
            "疾病": ColumnInfo(role="sensitive", type="categorical"),
        },
        generalization_matrices={
            "地區": {"mapping": {"台北": ["台北", "北部"], "台中": ["台中", "中部"]}}
        },  # 有格式
        # 但 qi_generalization_levels 沒給 → 不應自動降階
    )
    df_out, report = run_k_anonymity(df, config, k=2, suppression_limit_percent=100)
    # 地區未被泛化（維持原值）
    assert df_out["地區"].tolist() == ["台北", "台北", "台中", "台中"]
    # 建議清單應包含「未指定泛化層級」的警示，且點名該欄位
    assert any("未指定泛化層級" in r and "地區" in r for r in report.recommendations)


def test_numerical_type_mismatch_raises():
    """欄位設定為 numeric 但實際為文字，應拋出 ValueError"""
    df = pd.DataFrame({"疾病": ["感冒", "過敏", "心臟病"]})
    config = ColumnConfig(
        columns={"疾病": ColumnInfo(role="quasi_identifier", type="numeric")}
    )
    with pytest.raises(ValueError, match="配置為 numeric，但實體資料包含無法轉換"):
        run_k_anonymity(df, config, k=2)


# ── 日期泛化：解析後輸出到指定粒度 ────────────────────────────────────────

_ALL_LEVELS = ["second", "minute", "hour", "day", "month", "year"]


def _date_cfg(levels, level=None):
    cfg = ColumnConfig(
        columns={"生日": ColumnInfo(role="quasi_identifier", type="temporal")},
        generalization_hierarchies={"生日": {"levels": levels}},
    )
    if level is not None:
        cfg.qi_generalization_levels = {"生日": level}
    return cfg


def test_datetime_outputs_declared_granularity():
    """泛化層級 N＝取 levels 的第 N 項（層級 1 起跳），輸出為該粒度的標準寫法"""
    df = pd.DataFrame({"生日": ["1993-05-03 14:30:25"] * 2})
    got = {}
    for lv in (1, 2, 3, 4, 5, 6):
        out, _ = run_k_anonymity(df, _date_cfg(_ALL_LEVELS, lv), k=1, suppression_limit_percent=100)
        got[lv] = out["生日"].tolist()[0]
    assert got[1] == "1993-05-03 14:30:25"
    assert got[2] == "1993-05-03 14:30"
    assert got[3] == "1993-05-03 14"
    assert got[4] == "1993-05-03"
    assert got[5] == "1993-05"
    assert got[6] == "1993"


def test_datetime_level_one_reaches_first_declared_granularity():
    """levels 第一項要取得到：層級 1 即第一項，不需在前面多墊一級"""
    df = pd.DataFrame({"生日": ["2026-08-20 06:15:00"] * 2})
    out, _ = run_k_anonymity(
        df, _date_cfg(["hour", "day", "month"], 1), k=1, suppression_limit_percent=100
    )
    assert out["生日"].tolist()[0] == "2026-08-20 06"


def test_datetime_level_zero_kept_and_warns_as_explicit_choice():
    """層級明確設 0＝使用者選擇不泛化：維持原值，且提醒要講「設為 0」而非「未指定」"""
    df = pd.DataFrame({"生日": ["1993-05-03"] * 2})
    out, report = run_k_anonymity(
        df, _date_cfg(["day", "month", "year"], 0), k=1, suppression_limit_percent=100
    )
    assert out["生日"].tolist() == ["1993-05-03", "1993-05-03"]
    assert any("設為 0" in r and "生日" in r for r in report.recommendations)
    assert not any("未指定泛化層級" in r for r in report.recommendations)


def test_datetime_result_does_not_depend_on_input_layout():
    """先解析再輸出，故日在前的寫法照樣泛化掉細的粒度、不會反過來把年丟掉"""
    df = pd.DataFrame({"生日": ["23-10-2016", "24-10-2016"]})
    out, _ = run_k_anonymity(
        df, _date_cfg(["day", "month", "year"], 2), k=1, suppression_limit_percent=100
    )
    assert out["生日"].tolist() == ["2016-10", "2016-10"]


def test_datetime_level_clamped_to_coarsest():
    """層級超過宣告的粒度數 → 取最粗一級（不會泛化成空值），報告提醒"""
    df = pd.DataFrame({"生日": ["1993-05-03"] * 2})
    out, report = run_k_anonymity(
        df, _date_cfg(["day", "month", "year"], 9), k=1, suppression_limit_percent=100
    )
    assert out["生日"].tolist()[0] == "1993"
    assert any("階層可提供的深度" in r and "生日" in r for r in report.recommendations)


# ── 時段對照表：把一天之內的時間換成標籤 ──────────────────────────────────

_PERIODS = [
    {"min": "00:00", "max": "06:00", "label": "凌晨"},
    {"min": "06:00", "max": "12:00", "label": "上午"},
    {"min": "12:00", "max": "13:00", "label": "中午"},
    {"min": "13:00", "max": "18:00", "label": "下午"},
    {"min": "18:00", "max": "24:00", "label": "晚上"},
]


def _time_cfg(levels, time_periods, level, col="就診時間"):
    return ColumnConfig(
        columns={col: ColumnInfo(role="quasi_identifier", type="temporal")},
        generalization_hierarchies={col: {"levels": levels, "time_periods": time_periods}},
        qi_generalization_levels={col: level},
    )


def test_time_periods_label_time_only_column():
    """時間獨立一欄時輸出純時段，不會冒出解析時補的當日日期"""
    df = pd.DataFrame({"就診時間": ["14:30:25", "08:15:00", "23:00:00"]})
    cfg = _time_cfg(["second", "minute", "hour"], _PERIODS, 2)
    out, _ = run_k_anonymity(df, cfg, k=1, suppression_limit_percent=100)
    assert out["就診時間"].tolist() == ["下午", "上午", "晚上"]


def test_time_periods_supports_non_hourly_boundary():
    """界線可切在半點：06:20 與 06:40 會落到不同時段"""
    periods = [
        {"min": "00:00", "max": "06:30", "label": "凌晨"},
        {"min": "06:30", "max": "24:00", "label": "白天"},
    ]
    df = pd.DataFrame({"就診時間": ["06:20:00", "06:40:00"]})
    cfg = _time_cfg(["second", "minute", "hour"], periods, 1)
    out, _ = run_k_anonymity(df, cfg, k=1, suppression_limit_percent=100)
    assert out["就診時間"].tolist() == ["凌晨", "白天"]


def test_time_periods_wraps_midnight_with_repeated_label():
    """跨午夜寫成兩段同名，兩端都歸到同一個標籤"""
    periods = [
        {"min": "00:00", "max": "06:00", "label": "深夜"},
        {"min": "06:00", "max": "22:00", "label": "白天"},
        {"min": "22:00", "max": "24:00", "label": "深夜"},
    ]
    df = pd.DataFrame({"就診時間": ["23:10:00", "02:40:00", "09:00:00"]})
    cfg = _time_cfg(["second", "minute", "hour"], periods, 2)
    out, _ = run_k_anonymity(df, cfg, k=1, suppression_limit_percent=100)
    assert out["就診時間"].tolist() == ["深夜", "深夜", "白天"]


def test_time_periods_keeps_date_when_same_column():
    """日期與時間仍塞在同一欄時的退路：日期照留，只有時間換成標籤"""
    df = pd.DataFrame({"就診時間": ["2016-10-23 14:30:25", "2016-10-24 08:00:00"]})
    cfg = _time_cfg(_ALL_LEVELS, _PERIODS, 2)
    out, _ = run_k_anonymity(df, cfg, k=1, suppression_limit_percent=100)
    assert out["就診時間"].tolist() == ["2016-10-23 下午", "2016-10-24 上午"]


def test_time_periods_idle_when_generalized_beyond_hour():
    """泛化到日以上時輸出已無時間，時段對照表本次不生效，照跑但報告提醒"""
    df = pd.DataFrame({"就診時間": ["1993-05-03 08:00:00", "1993-11-20 14:00:00"]})
    cfg = _time_cfg(["day", "month", "year"], _PERIODS, 2)
    out, report = run_k_anonymity(df, cfg, k=1, suppression_limit_percent=100)
    assert out["就診時間"].tolist() == ["1993-05", "1993-11"]
    assert any("未生效" in r and "就診時間" in r for r in report.recommendations)


def test_time_periods_uncovered_value_marked_and_warned():
    """時間未落入任何區間 → 輸出 '*' 不回填原值，報告統計提醒"""
    df = pd.DataFrame({"就診時間": ["08:00:00", "23:00:00"]})
    only_morning = [{"min": "06:00", "max": "12:00", "label": "上午"}]
    cfg = _time_cfg(["second", "minute", "hour"], only_morning, 2)
    out, report = run_k_anonymity(df, cfg, k=1, suppression_limit_percent=100)
    assert out["就診時間"].tolist() == ["上午", "*"]
    assert any("未落入時段對照表" in r and "1/2" in r for r in report.recommendations)


def test_datetime_without_levels_kept_and_warns():
    """日期 QI 未宣告 levels → 維持原值不泛化（系統不代為決定粒度），報告提醒"""
    df = pd.DataFrame({"生日": ["1993-05-03", "1985-07-02"]})
    config = ColumnConfig(
        columns={"生日": ColumnInfo(role="quasi_identifier", type="temporal")},
        qi_generalization_levels={"生日": 2},
    )
    out, report = run_k_anonymity(df, config, k=1, suppression_limit_percent=100)
    assert out["生日"].tolist() == ["1993-05-03", "1985-07-02"]
    assert any("未宣告粒度階梯" in r and "生日" in r for r in report.recommendations)


def test_datetime_unparseable_blocked_upfront():
    """日期解析不動（如中文日期）→ 進引擎前即擋，不是跑到一半才發現"""
    df = pd.DataFrame({"生日": ["1993-05-03", "民國八十二年十月五日"]})
    with pytest.raises(ValueError, match="ERR_CONFIG_DATA_MISMATCH"):
        run_k_anonymity(
            df, _date_cfg(["day", "month", "year"], 1), k=1, suppression_limit_percent=100
        )


def test_datetime_empty_value_kept_empty():
    """空值維持空值（不會被輸出成空字串）"""
    df = pd.DataFrame({"生日": ["1993-05-03", None]})
    out, _ = run_k_anonymity(
        df, _date_cfg(["day", "month", "year"], 2), k=1, suppression_limit_percent=100
    )
    vals = out["生日"].tolist()
    assert vals[0] == "1993-05"
    assert pd.isna(vals[1])
