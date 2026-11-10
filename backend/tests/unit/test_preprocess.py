"""
資料前處理引擎 單元測試（11 項功能）
涵蓋：11 項功能各自的行為與邊界、前置檢查、清單由上往下的執行順序

清單形狀：columns 為有序陣列，每列＝欄位名稱＋依序要做的動作；
同一欄位可以出現多次，報錯以陣列位置指路。
"""
import pandas as pd
import pytest

from app.core.config import PreprocessConfig
from app.core.errors import PetsError
from app.engines.preprocess import build_actions, run_preprocess


def make_config(*entries: dict) -> PreprocessConfig:
    """把「欄位＋動作」的字面設定組成設定物件（測試用簡寫）。"""
    return PreprocessConfig(columns=list(entries))


def one(column: str, action: str, **params) -> dict:
    """單一欄位、單一動作的一列。"""
    return {"column": column, "actions": [{"action": action, "params": params}]}


# ── 1 字串去空白 trim ──────────────────────────────────────────────────────

def test_trim_edges_keeps_inner_spaces():
    """mode=edges 只清頭尾，字串中間的空白保留。"""
    df = pd.DataFrame({"地址": ["  台北市 大安區  "]})
    out = run_preprocess(df, make_config(one("地址", "trim", mode="edges")))
    assert out["地址"][0] == "台北市 大安區"


def test_trim_all_removes_inner_spaces():
    """mode=all 連字串中間的空白也清。"""
    df = pd.DataFrame({"地址": ["  台北市 大安區  "]})
    out = run_preprocess(df, make_config(one("地址", "trim", mode="all")))
    assert out["地址"][0] == "台北市大安區"


def test_trim_covers_tab_fullwidth_and_zero_width():
    """清除對象含 Tab、換行、全形空格與零寬字元（後兩者肉眼看不出來）。"""
    full_width_space, zero_width_space, bom = chr(0x3000), chr(0x200B), chr(0xFEFF)
    raw = f"{full_width_space}{zero_width_space} 台北\t市\n {bom}"
    df = pd.DataFrame({"地址": [raw]})
    edges = run_preprocess(df, make_config(one("地址", "trim", mode="edges")))
    assert edges["地址"][0] == "台北\t市"
    all_mode = run_preprocess(df, make_config(one("地址", "trim", mode="all")))
    assert all_mode["地址"][0] == "台北市"


def test_trim_leaves_null_untouched():
    """空的格子不動（補值是另外三個功能的事）。"""
    df = pd.DataFrame({"地址": [" 台北 ", None]})
    out = run_preprocess(df, make_config(one("地址", "trim", mode="edges")))
    assert out["地址"][0] == "台北"
    assert pd.isna(out["地址"][1])


# ── 2 字串截斷 slice ───────────────────────────────────────────────────────

def test_slice_deletes_from_the_chosen_side():
    """slice 是刪掉指定數量的字元，不是保留；左右各自算。"""
    df = pd.DataFrame({"地址": ["台北市大安區"]})
    left = run_preprocess(df, make_config(one("地址", "slice", side="left", count=3)))
    right = run_preprocess(df, make_config(one("地址", "slice", side="right", count=3)))
    assert left["地址"][0] == "大安區"
    assert right["地址"][0] == "台北市"


def test_slice_counts_characters_not_bytes():
    """以字元計非位元組：中文一個字算一個（UTF-8 下一個中文字佔 3 個位元組）。"""
    df = pd.DataFrame({"地址": ["臺北市大安區"]})
    out = run_preprocess(df, make_config(one("地址", "slice", side="left", count=1)))
    assert out["地址"][0] == "北市大安區"


def test_slice_shorter_than_count_becomes_empty():
    """長度不足時整格變成空字串（規格明定）。"""
    df = pd.DataFrame({"地址": ["台北", "台北市大安區"]})
    out = run_preprocess(df, make_config(one("地址", "slice", side="right", count=5)))
    assert out["地址"][0] == ""
    assert out["地址"][1] == "台"


def test_slice_both_sides_by_listing_twice():
    """一列只能挑一邊；左右都要刪就在清單裡排兩列（同一欄位可重複出現）。"""
    df = pd.DataFrame({"編號": ["AA12345BB"]})
    config = make_config(
        {
            "column": "編號",
            "actions": [
                {"action": "slice", "params": {"side": "left", "count": 2}},
                {"action": "slice", "params": {"side": "right", "count": 2}},
            ],
        }
    )
    assert run_preprocess(df, config)["編號"][0] == "12345"


# ── 3 相對保留與截斷 anchor_truncate ───────────────────────────────────────

def test_anchor_truncate_before_keeps_anchor_side():
    """direction=before：保留錨點與它前面的字元，錨點右側完全不動。"""
    df = pd.DataFrame({"地址": ["台北市大安區和平東路"]})
    out = run_preprocess(
        df, make_config(one("地址", "anchor_truncate", anchor="區", direction="before", keep=3))
    )
    assert out["地址"][0] == "大安區和平東路"


def test_anchor_truncate_after_keeps_anchor_side():
    """direction=after：保留錨點與它後面的字元，錨點左側完全不動。"""
    df = pd.DataFrame({"地址": ["台北市大安區和平東路"]})
    out = run_preprocess(
        df, make_config(one("地址", "anchor_truncate", anchor="區", direction="after", keep=3))
    )
    assert out["地址"][0] == "台北市大安區和平"


def test_anchor_truncate_keep_zero_drops_the_anchor():
    """keep 含錨點本身，故 keep=0 時錨點也會被刪去。"""
    df = pd.DataFrame({"地址": ["台北市大安區和平東路"]})
    out = run_preprocess(
        df, make_config(one("地址", "anchor_truncate", anchor="區", direction="before", keep=0))
    )
    assert out["地址"][0] == "和平東路"


def test_anchor_truncate_picks_first_or_last_occurrence():
    """before 取由前往後的第一個錨點、after 取最後一個；中間的永遠不會被選。"""
    df = pd.DataFrame({"路徑": ["a-b-c-d"]})
    before = run_preprocess(
        df, make_config(one("路徑", "anchor_truncate", anchor="-", direction="before", keep=1))
    )
    after = run_preprocess(
        df, make_config(one("路徑", "anchor_truncate", anchor="-", direction="after", keep=1))
    )
    assert before["路徑"][0] == "-b-c-d"
    assert after["路徑"][0] == "a-b-c-"


def test_anchor_truncate_missing_anchor_leaves_value_untouched():
    """找不到錨點就不執行、也不報錯——那是資料沒有這個字元，不是設定寫錯。"""
    df = pd.DataFrame({"地址": ["台北市大安區", "沒有錨點的值"]})
    out = run_preprocess(
        df, make_config(one("地址", "anchor_truncate", anchor="區", direction="before", keep=2))
    )
    assert out["地址"][0] == "安區"
    assert out["地址"][1] == "沒有錨點的值"


# ── 4 型態轉換 cast ────────────────────────────────────────────────────────

def test_cast_int_strips_attached_text_but_keeps_the_number():
    """只換型態、不改數值：黏著的文字與千分位濾掉，負號保留。"""
    df = pd.DataFrame({"值": ["25歲", "NT$3,000", "-25歲"]})
    out = run_preprocess(df, make_config(one("值", "cast", type="int")))
    assert list(out["值"]) == [25, 3000, -25]


def test_cast_int_with_decimal_value_errors_without_rounding():
    """有小數的值要轉 int，未指定 rounding＝報錯，不替呼叫方決定捨去或進位。"""
    df = pd.DataFrame({"值": ["12.5"]})
    with pytest.raises(PetsError) as exc:
        run_preprocess(df, make_config(one("值", "cast", type="int")))
    assert exc.value.error_code == "ERR_PREPROCESS_TYPE_MISMATCH"


@pytest.mark.parametrize(
    "rounding,expected",
    [("floor", [12, -13]), ("ceil", [13, -12]), ("round", [13, -13])],
)
def test_cast_int_rounding_modes(rounding, expected):
    """rounding 三種取整方式；round 是四捨五入（不是內建 round() 的銀行家捨入）。"""
    df = pd.DataFrame({"值": ["12.5", "-12.5"]})
    out = run_preprocess(df, make_config(one("值", "cast", type="int", rounding=rounding)))
    assert list(out["值"]) == expected


def test_cast_leaves_non_numeric_value_untouched():
    """"25-30" 這種根本不是數字的原樣不動、不報錯——值很髒不等於用錯功能。"""
    df = pd.DataFrame({"值": ["25-30", "30"]})
    out = run_preprocess(df, make_config(one("值", "cast", type="int")))
    assert list(out["值"]) == ["25-30", 30]


def test_cast_float_keeps_decimals():
    """轉 float 保留小數。"""
    df = pd.DataFrame({"值": ["12.5", "3"]})
    out = run_preprocess(df, make_config(one("值", "cast", type="float")))
    assert list(out["值"]) == [12.5, 3.0]


def test_cast_bool_uses_caller_supplied_lists():
    """bool 的對照表由呼叫方給，比對忽略大小寫，兩張清單以外的值原樣不動。"""
    df = pd.DataFrame({"是否同意": ["Y", "n", "YES", "無"]})
    out = run_preprocess(
        df,
        make_config(
            one("是否同意", "cast", type="bool", true_values=["y", "yes"], false_values=["N"])
        ),
    )
    assert list(out["是否同意"]) == [True, False, True, "無"]


def test_cast_leaves_null_untouched():
    """空的格子不動（補值是第 6～8 項的事）。"""
    df = pd.DataFrame({"值": ["25", None]})
    out = run_preprocess(df, make_config(one("值", "cast", type="int")))
    assert out["值"][0] == 25
    assert pd.isna(out["值"][1])


# ── 5 文字正規化 normalize ─────────────────────────────────────────────────

def test_normalize_case_only_affects_letters():
    """case 只影響英文字母，數字與中文不動。"""
    df = pd.DataFrame({"編號": ["ab-12 甲"]})
    upper = run_preprocess(df, make_config(one("編號", "normalize", case="upper")))
    lower = run_preprocess(
        pd.DataFrame({"編號": ["AB-12 甲"]}), make_config(one("編號", "normalize", case="lower"))
    )
    assert upper["編號"][0] == "AB-12 甲"
    assert lower["編號"][0] == "ab-12 甲"


def test_normalize_width_converts_both_directions():
    """width 雙向都提供：全形轉半形、半形轉全形（同一張對照表反過來查）。"""
    df = pd.DataFrame({"編號": ["ＡＢ１２"]})
    half = run_preprocess(df, make_config(one("編號", "normalize", width="half")))
    assert half["編號"][0] == "AB12"
    full = run_preprocess(
        pd.DataFrame({"編號": ["AB12"]}), make_config(one("編號", "normalize", width="full"))
    )
    assert full["編號"][0] == "ＡＢ１２"


def test_normalize_leaves_punctuation_untouched():
    """只轉數字與英文字母，標點不動（全形逗號轉半形是排版偏好，不是資料清洗）。"""
    df = pd.DataFrame({"備註": ["ａ，ｂ。"]})
    out = run_preprocess(df, make_config(one("備註", "normalize", width="half")))
    assert out["備註"][0] == "a，b。"


def test_normalize_case_and_width_together():
    """兩個旋鈕互不相干，可以一起用（規格的範例就是兩個一起）。"""
    df = pd.DataFrame({"編號": ["ａｂ１２"]})
    out = run_preprocess(df, make_config(one("編號", "normalize", case="upper", width="half")))
    assert out["編號"][0] == "AB12"


def test_normalize_converts_fullwidth_space():
    """規格的範例：全形空格要一起轉成半形空格，不然字中間會留著 U+3000。"""
    df = pd.DataFrame({"地址": ["Ｔａｉｐｅｉ　Ｃｉｔｙ"]})
    out = run_preprocess(df, make_config(one("地址", "normalize", case="lower", width="half")))
    assert out["地址"][0] == "taipei city"

    back = run_preprocess(
        pd.DataFrame({"地址": ["taipei city"]}), make_config(one("地址", "normalize", width="full"))
    )
    assert back["地址"][0] == "ｔａｉｐｅｉ　ｃｉｔｙ"


# ── 6 丟棄缺失值 drop_nulls ────────────────────────────────────────────────

def test_drop_nulls_only_looks_at_the_named_column():
    """指定哪一欄，那一欄為空就刪掉整列；其他欄位是不是空的不管。"""
    df = pd.DataFrame({"年齡": [25, None, 30], "地區": [None, "大安區", "中正區"]})
    out = run_preprocess(df, make_config(one("年齡", "drop_nulls")))
    assert list(out["年齡"]) == [25, 30]
    assert pd.isna(out["地區"][0])


def test_drop_nulls_keeps_empty_string():
    """空字串是有效資料（規格明定），不算空值。"""
    df = pd.DataFrame({"地址": ["", None, "台北"]})
    out = run_preprocess(df, make_config(one("地址", "drop_nulls")))
    assert list(out["地址"]) == ["", "台北"]


# ── 7 預設值填充 fill_default ──────────────────────────────────────────────

def test_fill_default_fills_nulls_only():
    """只動空值，空字串不動；設定檔寫什麼型別就填什麼。"""
    df = pd.DataFrame({"地區": ["台北", None, ""]})
    out = run_preprocess(df, make_config(one("地區", "fill_default", value="未知")))
    assert list(out["地區"]) == ["台北", "未知", ""]


def test_fill_default_keeps_the_configured_type():
    """填數值就是數值，不會被轉成字串。"""
    df = pd.DataFrame({"就醫次數": [3.0, None]})
    out = run_preprocess(df, make_config(one("就醫次數", "fill_default", value=0)))
    assert list(out["就醫次數"]) == [3.0, 0.0]


# ── 8 策略填充 impute ──────────────────────────────────────────────────────

def test_impute_ffill_and_bfill_carry_neighbour_value():
    """ffill／bfill 搬前後那格的值，任何型別都能用。"""
    df = pd.DataFrame({"地區": ["大安區", None, "中正區"]})
    forward = run_preprocess(df, make_config(one("地區", "impute", strategy="ffill")))
    backward = run_preprocess(df, make_config(one("地區", "impute", strategy="bfill")))
    assert list(forward["地區"]) == ["大安區", "大安區", "中正區"]
    assert list(backward["地區"]) == ["大安區", "中正區", "中正區"]


def test_impute_no_valid_value_falls_back_to_zero_or_empty_string():
    """那一側整個找不到有效值時：數值欄補 0、字串欄補空字串。"""
    numeric = run_preprocess(
        pd.DataFrame({"年齡": [None, 25]}), make_config(one("年齡", "impute", strategy="ffill"))
    )
    text = run_preprocess(
        pd.DataFrame({"地區": ["大安區", None]}), make_config(one("地區", "impute", strategy="bfill"))
    )
    assert list(numeric["年齡"]) == [0, 25]
    assert list(text["地區"]) == ["大安區", ""]


def test_impute_interpolate_fills_consecutive_gaps_linearly():
    """連續空格採線性內插，兩格填的是不同的值。"""
    df = pd.DataFrame({"年齡": [25, None, None, 28]})
    out = run_preprocess(df, make_config(one("年齡", "impute", strategy="interpolate")))
    assert list(out["年齡"]) == [25, 26, 27, 28]


def test_impute_keeps_decimals_without_rounding():
    """算出來有小數就填小數，不取整（要整數請自己再排一列 cast）。"""
    df = pd.DataFrame({"年齡": [25, None, None, 24]})
    out = run_preprocess(df, make_config(one("年齡", "impute", strategy="interpolate")))
    assert [round(v, 2) for v in out["年齡"]] == [25.0, 24.67, 24.33, 24.0]


def test_impute_mean_uses_column_average():
    """mean 以整欄有效值的平均補上。"""
    df = pd.DataFrame({"薪資": [10.0, None, 20.0]})
    out = run_preprocess(df, make_config(one("薪資", "impute", strategy="mean")))
    assert list(out["薪資"]) == [10.0, 15.0, 20.0]


def test_impute_all_null_column_falls_back_to_zero():
    """整欄全空＝無有效值，數值欄補 0。"""
    df = pd.DataFrame({"薪資": [None, None]}, dtype="float64")
    out = run_preprocess(df, make_config(one("薪資", "impute", strategy="mean")))
    assert list(out["薪資"]) == [0.0, 0.0]


@pytest.mark.parametrize("strategy", ["interpolate", "mean"])
def test_impute_numeric_only_strategies_reject_string_column(strategy):
    """對字串使用內插法或平均值＝規格明示的報錯情形（用錯功能，不是值很髒）。"""
    df = pd.DataFrame({"地區": ["大安區", None, "中正區"]})
    with pytest.raises(PetsError) as exc:
        run_preprocess(df, make_config(one("地區", "impute", strategy=strategy)))
    assert exc.value.error_code == "ERR_PREPROCESS_TYPE_MISMATCH"


# ── 9 上下界截斷 clamp ─────────────────────────────────────────────────────

def test_clamp_applies_only_the_given_bounds():
    """只給 max 只壓上界、只給 min 只抬下界、兩個都給就兩邊都管。"""
    df = pd.DataFrame({"年齡": [5, 50, 120]})
    upper = run_preprocess(df, make_config(one("年齡", "clamp", max=100)))
    lower = run_preprocess(df, make_config(one("年齡", "clamp", min=18)))
    both = run_preprocess(df, make_config(one("年齡", "clamp", min=18, max=100)))
    assert list(upper["年齡"]) == [5, 50, 100]
    assert list(lower["年齡"]) == [18, 50, 120]
    assert list(both["年齡"]) == [18, 50, 100]


def test_clamp_leaves_boundary_values_and_nulls_untouched():
    """剛好等於邊界值的不動（規格說的是「超出」），空的格子也不動。"""
    df = pd.DataFrame({"年齡": [18.0, None, 100.0]})
    out = run_preprocess(df, make_config(one("年齡", "clamp", min=18, max=100)))
    assert out["年齡"][0] == 18.0 and out["年齡"][2] == 100.0
    assert pd.isna(out["年齡"][1])


def test_clamp_rejects_string_column():
    """只能用在數值欄，字串欄報錯（字串沒有大小可比）。"""
    df = pd.DataFrame({"地區": ["大安區"]})
    with pytest.raises(PetsError) as exc:
        run_preprocess(df, make_config(one("地區", "clamp", max=100)))
    assert exc.value.error_code == "ERR_PREPROCESS_TYPE_MISMATCH"


# ── 10 雜湊 hash ───────────────────────────────────────────────────────────

def test_hash_outputs_full_64_hex_and_is_stable():
    """輸出完整 64 字元十六進位；同鹽同值必得同一串（假名化的前提）。"""
    df = pd.DataFrame({"身分證號": ["A123456789", "A123456789", "B234567890"]})
    out = run_preprocess(df, make_config(one("身分證號", "hash", salt="s1")))
    assert all(len(v) == 64 for v in out["身分證號"])
    assert out["身分證號"][0] == out["身分證號"][1] != out["身分證號"][2]


def test_hash_different_salt_gives_different_result():
    """換一把鹽就是另一組代號。"""
    df = pd.DataFrame({"身分證號": ["A123456789"]})
    first = run_preprocess(df, make_config(one("身分證號", "hash", salt="s1")))
    second = run_preprocess(df, make_config(one("身分證號", "hash", salt="s2")))
    assert first["身分證號"][0] != second["身分證號"][0]


def test_hash_leaves_null_untouched_and_accepts_any_type():
    """空的格子不動（全部空格會雜湊成同一串代號）；數字型別也照樣先當字串雜湊。"""
    df = pd.DataFrame({"編號": [1234567, None]})
    out = run_preprocess(df, make_config(one("編號", "hash", salt="s1")))
    assert len(out["編號"][0]) == 64
    assert pd.isna(out["編號"][1])


def test_hash_use_timestamp_is_shared_across_the_whole_list():
    """use_timestamp 的鹽整份清單開跑前取一次：同一值在兩個欄位要得到同一串代號。"""
    df = pd.DataFrame({"會員A": ["X001"], "會員B": ["X001"]})
    out = run_preprocess(
        df,
        make_config(
            one("會員A", "hash", salt="use_timestamp"),
            one("會員B", "hash", salt="use_timestamp"),
        ),
    )
    assert out["會員A"][0] == out["會員B"][0]


def test_hash_use_timestamp_keyword_is_matched_in_lowercase_only():
    """保留字嚴格全小寫比對：寫成 USE_TIMESTAMP 就只是一把叫這個名字的普通鹽。"""
    df = pd.DataFrame({"編號": ["X001"]})
    literal = run_preprocess(df, make_config(one("編號", "hash", salt="USE_TIMESTAMP")))
    again = run_preprocess(df, make_config(one("編號", "hash", salt="USE_TIMESTAMP")))
    # 當成普通鹽值 → 兩次跑一樣；若被當成時間戳則兩次不同
    assert literal["編號"][0] == again["編號"][0]


def test_hash_without_salt_falls_back_to_env_then_bare_hash(monkeypatch):
    """沒給 salt → 讀 .env；.env 也沒有 → 裸雜湊。三步都不報錯。"""
    df = pd.DataFrame({"編號": ["X001"]})
    monkeypatch.setenv("OPEN_PETS_DEFAULT_SALT", "env-salt")
    from_env = run_preprocess(df, make_config(one("編號", "hash")))
    explicit = run_preprocess(df, make_config(one("編號", "hash", salt="env-salt")))
    assert from_env["編號"][0] == explicit["編號"][0]

    monkeypatch.delenv("OPEN_PETS_DEFAULT_SALT", raising=False)
    bare = run_preprocess(df, make_config(one("編號", "hash")))
    assert len(bare["編號"][0]) == 64
    assert bare["編號"][0] != from_env["編號"][0]

    # 空字串與沒寫同義：一樣往下退到 .env／裸雜湊
    empty = run_preprocess(df, make_config(one("編號", "hash", salt="")))
    assert empty["編號"][0] == bare["編號"][0]


@pytest.mark.parametrize(
    "algorithm, digits",
    [("sha256", 64), ("sha3-256", 64), ("sha3-512", 128)],
)
def test_hash_algorithm_choices(algorithm, digits):
    """三個演算法各跑一次：輸出長度符合該演算法，且互不相同。"""
    df = pd.DataFrame({"編號": ["X001"]})
    config = PreprocessConfig(
        columns=[one("編號", "hash", salt="s1")], algorithm=algorithm
    )
    out = run_preprocess(df, config)
    assert len(out["編號"][0]) == digits


def test_hash_algorithm_defaults_to_sha3_256():
    """設定檔沒寫 algorithm → 預設 sha3-256。"""
    df = pd.DataFrame({"編號": ["X001"]})
    implicit = run_preprocess(df, make_config(one("編號", "hash", salt="s1")))
    explicit = run_preprocess(
        df,
        PreprocessConfig(
            columns=[one("編號", "hash", salt="s1")], algorithm="sha3-256"
        ),
    )
    assert implicit["編號"][0] == explicit["編號"][0]


def test_unknown_hash_algorithm_rejected():
    """演算法名稱寫錯一律擋，不靜默退回預設。"""
    df = pd.DataFrame({"編號": ["X001"]})
    config = PreprocessConfig(columns=[one("編號", "hash", salt="s1")], algorithm="md5")
    with pytest.raises(PetsError) as exc:
        run_preprocess(df, config)
    assert exc.value.error_code == "ERR_INVALID_PARAM"


# ── 11 正則掃描與替換 regex_replace ────────────────────────────────────────

def test_regex_replace_only_swaps_the_matched_part():
    """只換命中的那一段，其餘的字留著。"""
    df = pd.DataFrame({"備註": ["Phone: 0912-345-678"]})
    out = run_preprocess(
        df,
        make_config(
            one("備註", "regex_replace", pattern=r"\d{4}-\d{3}-\d{3}", replacement="[電話]")
        ),
    )
    assert out["備註"][0] == "Phone: [電話]"


def test_regex_replace_swaps_every_match_in_a_cell():
    """一格裡符合的全部換掉，不是只換第一個。"""
    df = pd.DataFrame({"備註": ["a1b2c3"]})
    out = run_preprocess(
        df, make_config(one("備註", "regex_replace", pattern=r"\d", replacement="#"))
    )
    assert out["備註"][0] == "a#b#c#"


def test_regex_replace_with_empty_replacement_removes_the_match():
    """replacement 填空字串＝把命中的那段刪掉。"""
    df = pd.DataFrame({"地址": ["台北市大安區12號"]})
    out = run_preprocess(
        df, make_config(one("地址", "regex_replace", pattern=r"\d", replacement=""))
    )
    assert out["地址"][0] == "台北市大安區號"


def test_regex_replace_without_match_leaves_value_untouched():
    """找不到符合的就不動、也不報錯（同第 3 項找不到錨點）。"""
    df = pd.DataFrame({"備註": ["沒有數字"]})
    out = run_preprocess(
        df, make_config(one("備註", "regex_replace", pattern=r"\d", replacement="#"))
    )
    assert out["備註"][0] == "沒有數字"


def test_regex_replace_invalid_pattern_is_blocked_before_running():
    """正則式語法寫錯＝設定寫錯，在動到資料之前擋下。"""
    with pytest.raises(PetsError) as exc:
        build_actions(make_config(one("備註", "regex_replace", pattern="[", replacement="#")))
    assert exc.value.error_code == "ERR_PREPROCESS_PARAM_INVALID"


# ── 執行語意：清單由上往下，每一步用當下的資料 ─────────────────────────────

def test_actions_run_top_down_on_current_data():
    """同一欄位先去空白再截斷：第二個動作吃的是第一個動作處理後的值。"""
    df = pd.DataFrame({"地址": ["  台北市大安區"]})
    config = make_config(
        {
            "column": "地址",
            "actions": [
                {"action": "trim", "params": {"mode": "edges"}},
                {"action": "slice", "params": {"side": "left", "count": 3}},
            ],
        }
    )
    assert run_preprocess(df, config)["地址"][0] == "大安區"


def test_columns_run_in_listed_order_and_others_untouched():
    """清單處理多個欄位時彼此獨立，沒被列到的欄位原樣保留。"""
    df = pd.DataFrame({"地址": [" 台北 "], "姓名": [" 王小明 "], "年齡": [30]})
    config = make_config(
        one("地址", "trim", mode="edges"),
        one("姓名", "trim", mode="all"),
    )
    out = run_preprocess(df, config)
    assert out["地址"][0] == "台北"
    assert out["姓名"][0] == "王小明"
    assert out["年齡"][0] == 30


def test_non_string_values_are_processed_as_text():
    """非字串欄一律先當字串處理（會員編號常被讀成數字）。"""
    df = pd.DataFrame({"編號": [1234567, 89]})
    out = run_preprocess(df, make_config(one("編號", "slice", side="left", count=3)))
    assert out["編號"][0] == "4567"
    assert out["編號"][1] == ""


def test_input_dataframe_is_not_modified():
    """引擎處理的是複本，呼叫方傳進來的 DataFrame 不被改動。"""
    df = pd.DataFrame({"地址": [" 台北 "]})
    run_preprocess(df, make_config(one("地址", "trim", mode="edges")))
    assert df["地址"][0] == " 台北 "


# ── 前置檢查：擋的檢查一律在動到資料之前 ───────────────────────────────────

def test_unknown_column_is_rejected_before_running(sample_df):
    """欄位名稱打錯直接報錯，訊息指出是清單第幾列。"""
    config = make_config(
        one("年齡", "trim", mode="edges"),
        one("不存在的欄位", "trim", mode="edges"),
    )
    with pytest.raises(PetsError) as exc:
        run_preprocess(sample_df, config)
    assert exc.value.error_code == "ERR_PREPROCESS_COLUMN_NOT_FOUND"
    assert "第 2 列" in exc.value.message


def test_unknown_action_is_rejected_when_building():
    """認不得的功能名稱在組裝階段就擋下（還沒碰到資料）。"""
    config = make_config(one("地址", "trimm", mode="edges"))
    with pytest.raises(PetsError) as exc:
        build_actions(config)
    assert exc.value.error_code == "ERR_PREPROCESS_ACTION_UNKNOWN"
    assert "trimm" in exc.value.message


def test_invalid_param_reports_its_position():
    """參數不合法在組裝階段擋下，訊息帶出它在清單裡的位置。"""
    config = make_config(
        {
            "column": "地址",
            "actions": [
                {"action": "trim", "params": {"mode": "edges"}},
                {"action": "slice", "params": {"side": "middle", "count": 3}},
            ],
        }
    )
    with pytest.raises(PetsError) as exc:
        build_actions(config)
    assert exc.value.error_code == "ERR_PREPROCESS_PARAM_INVALID"
    assert "第 1 列" in exc.value.message and "第 2 個動作" in exc.value.message


@pytest.mark.parametrize(
    "action,params",
    [
        ("trim", {}),                                        # mode 必填
        ("trim", {"mode": "edge"}),                          # 選項打錯
        ("trim", {"mode": "edges", "modes": "all"}),         # 多打一個不認識的參數
        ("slice", {"side": "left"}),                         # count 必填
        ("slice", {"side": "left", "count": -1}),            # 刪負數個字元
        ("slice", {"side": "left", "count": 0}),             # 刪 0 個字元＝跑完等於沒跑
        ("slice", {"side": "left", "count": True}),          # 布林不算整數
        ("anchor_truncate", {"anchor": "區", "direction": "before"}),          # keep 必填
        ("anchor_truncate", {"anchor": "大安區", "direction": "before", "keep": 1}),  # 錨點須單一字元
        ("cast", {}),                                                          # type 必填
        ("cast", {"type": "int", "rounding": "half"}),                         # 取整方式打錯
        ("cast", {"type": "float", "rounding": "floor"}),                      # rounding 只給 int 用
        ("cast", {"type": "bool"}),                                            # 兩張對照表必填
        ("cast", {"type": "bool", "true_values": ["y"], "false_values": ["Y"]}),  # 同值又真又假
        ("cast", {"type": "int", "true_values": ["y"]}),                       # 對照表只給 bool 用
        ("normalize", {}),                                                     # 兩個旋鈕至少給一個
        ("normalize", {"case": "capitalize"}),                                 # 選項打錯
        ("drop_nulls", {"column": "年齡"}),                                    # 本功能沒有參數
        ("fill_default", {}),                                                  # value 必填
        ("fill_default", {"value": None}),                                     # 空值換空值＝沒做事
        ("impute", {}),                                                        # strategy 必填
        ("impute", {"strategy": "median"}),                                    # 不在四種策略裡
        ("clamp", {}),                                                         # min／max 至少給一個
        ("clamp", {"min": 100, "max": 18}),                                    # 下界大於上界
        ("clamp", {"max": "100"}),                                             # 邊界須為數值
        ("hash", {"use_timestamp": True}),                                     # 不認識的參數（時間戳鹽請寫 salt: use_timestamp）
        ("hash", {"salt": 123}),                                               # 鹽須為字串
        ("regex_replace", {"pattern": r"\d"}),                                 # replacement 必填
        ("regex_replace", {"replacement": "#"}),                               # pattern 必填
    ],
)
def test_param_errors_are_blocked(action, params):
    """設定寫錯一律擋下，不靜默套預設值。"""
    with pytest.raises(PetsError) as exc:
        build_actions(make_config({"column": "地址", "actions": [{"action": action, "params": params}]}))
    assert exc.value.error_code == "ERR_PREPROCESS_PARAM_INVALID"


def test_type_checks_use_the_data_at_that_moment_not_the_original_column():
    """型別檢查不前置：字串欄先 cast 成數值，後面的 clamp 就用得上（型別是跑出來的）。"""
    df = pd.DataFrame({"年齡": ["25歲", "120歲"]})
    config = make_config(
        {
            "column": "年齡",
            "actions": [
                {"action": "cast", "params": {"type": "int"}},
                {"action": "clamp", "params": {"max": 100}},
            ],
        }
    )
    assert list(run_preprocess(df, config)["年齡"]) == [25, 100]


def test_config_self_check_rejects_empty_list():
    """空清單＝沒有要做的事，屬設定寫錯。"""
    with pytest.raises(PetsError) as exc:
        PreprocessConfig(columns=[]).validate_config()
    assert exc.value.error_code == "ERR_CONFIG_INVALID"


def test_config_self_check_rejects_column_without_actions():
    """列了欄位卻沒列動作，同樣屬設定寫錯。"""
    with pytest.raises(PetsError) as exc:
        PreprocessConfig(columns=[{"column": "地址", "actions": []}]).validate_config()
    assert exc.value.error_code == "ERR_CONFIG_INVALID"
