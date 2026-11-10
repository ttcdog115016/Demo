"""
IO 載入與設定檔解析 單元測試
"""
import io
import json
import os
from urllib.parse import quote

import pytest
import pandas as pd

from app.core.config import (
    ColumnConfig,
    ColumnInfo,
    parse_bundled_config,
    parse_bundled_config_from_bytes,
)
from app.core.dataset_io import (
    DatasetFormat,
    content_disposition_attachment,
    dataframe_to_bytes,
    declared_format_conflict,
    export_result,
    load_dataframe_from_bytes,
    load_dataframe_with_format,
    load_dataset,
)
from app.core.errors import PetsError


def test_load_csv_file(temp_dir, sample_df):
    """測試從 CSV 檔案正確載入 DataFrame，共 12 筆 × 10 欄位"""
    path = os.path.join(temp_dir, "test_load.csv")
    sample_df.to_csv(path, index=False, encoding="utf-8")
    df = load_dataset(path)
    assert len(df) == 12
    assert len(df.columns) == 10
    assert "姓名" in df.columns
    assert "就醫次數" in df.columns


def test_load_from_bytes(sample_csv_bytes):
    """測試從 bytes 直接解析 DataFrame"""
    df = load_dataframe_from_bytes(sample_csv_bytes, "test.csv")
    assert len(df) == 12
    assert len(df.columns) == 10


def test_csv_column_with_one_text_cell_reads_as_single_type():
    """數字欄中間夾一格文字（如值抑制填的 *），整欄須讀成同一種型別，同值才會分在同一組。"""
    rows = ["出生年,年齡"] + ["1990,30"] * 300_000 + ["*,30"] + ["1990,30"] * 300_000
    df = load_dataframe_from_bytes("\n".join(rows).encode("utf-8"), "data.csv")
    assert df["出生年"].map(type).nunique() == 1
    assert df.groupby("出生年").size().to_dict() == {"1990": 600_000, "*": 1}
    assert pd.api.types.is_integer_dtype(df["年齡"])


# ── 0 開頭的代碼（09007）讀入後不得掉 0 ─────────────────────────────────────


def _code_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "縣市代碼": ["09007", "63000", "09020"],
            "年齡": [0, 41, 100],
            "比例": [0.5, 0.25, 1.0],
        }
    )


def _code_bytes(kind: str) -> bytes:
    df = _code_frame()
    if kind == "csv":
        return df.to_csv(index=False).encode("utf-8")
    if kind == "json":
        return df.to_json(orient="records", force_ascii=False).encode("utf-8")
    if kind == "jsonl":
        return df.to_json(orient="records", lines=True, force_ascii=False).encode("utf-8")
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    return buf.getvalue()


@pytest.mark.parametrize(
    "kind, name",
    [("csv", "d.csv"), ("json", "d.json"), ("jsonl", "d.jsonl"), ("excel", "d.xlsx")],
)
def test_leading_zero_code_kept_as_text(kind, name):
    """代碼欄保留原文字；0、0.5 這類數值欄照舊是數字。"""
    df, fmt = load_dataframe_with_format(_code_bytes(kind), name)
    assert list(df["縣市代碼"]) == ["09007", "63000", "09020"]
    assert pd.api.types.is_integer_dtype(df["年齡"])
    assert pd.api.types.is_float_dtype(df["比例"])
    # 原樣讀回再寫出，代碼仍為 09007
    again, _ = load_dataframe_with_format(dataframe_to_bytes(df, fmt), name)
    assert list(again["縣市代碼"]) == ["09007", "63000", "09020"]


def test_csv_leading_zero_column_keeps_original_text_and_empty_cells():
    """整欄只要一格 0 開頭就整欄當文字，其他格照原文、空格仍為空值。"""
    content = "代碼,年齡\n09007,41\n123,\n,45\n".encode()
    df = load_dataframe_from_bytes(content, "d.csv")
    assert df["代碼"].tolist()[:2] == ["09007", "123"]
    assert pd.isna(df["代碼"].iloc[2])
    assert pd.api.types.is_numeric_dtype(df["年齡"])


def test_csv_leading_zero_with_duplicate_column_names():
    """重複欄名（pandas 會改名為 代碼.1）仍以位置對到正確的欄。"""
    content = "代碼,代碼,年齡\n09007,1,41\n63000,2,45\n".encode()
    df = load_dataframe_from_bytes(content, "d.csv")
    assert df.iloc[:, 0].tolist() == ["09007", "63000"]
    assert pd.api.types.is_integer_dtype(df.iloc[:, 1])


# ── 輸入格式參數（沒有副檔名的檔案）────────────────────────────────────────


def test_no_extension_is_rejected_without_declared_format(sample_csv_bytes):
    """沒有副檔名又不指定格式＝無從判定，擋下並提示可用參數指定。"""
    with pytest.raises(PetsError) as exc:
        load_dataframe_from_bytes(sample_csv_bytes, "dataset_export")
    assert exc.value.error_code == "ERR_UNSUPPORTED_FILE_FORMAT"
    assert "副檔名" in exc.value.message


def test_declared_format_reads_file_without_extension(sample_csv_bytes):
    """本參數要解決的主情境：檔案沒有副檔名，由呼叫端明講格式後正常讀取。"""
    df, fmt = load_dataframe_with_format(sample_csv_bytes, "dataset_export", "csv")
    assert len(df) == 12
    assert fmt.kind == "csv"


def test_declared_format_overrides_extension(sample_df):
    """指定的格式優先於副檔名：副檔名寫 .csv、內容其實是 JSON，照指定的讀得起來。"""
    payload = sample_df.to_json(orient="records", force_ascii=False).encode("utf-8")
    df, fmt = load_dataframe_with_format(payload, "mislabelled.csv", "json")
    assert len(df) == 12
    assert fmt.kind == "json"
    # 輸出格式跟著指定的走，結果資料才不會變成使用者沒預期的格式
    assert fmt.output_extension == ".json"


def test_declared_format_is_case_insensitive(sample_csv_bytes):
    """整合方大小寫不一致不該被當成錯誤。"""
    df, fmt = load_dataframe_with_format(sample_csv_bytes, "no_ext", " CSV ")
    assert len(df) == 12
    assert fmt.kind == "csv"


def test_declared_format_rejects_unknown_value(sample_csv_bytes):
    """不在清單內的格式一律擋，不退回猜副檔名。"""
    with pytest.raises(PetsError) as exc:
        load_dataframe_from_bytes(sample_csv_bytes, "data.csv", "parquet")
    assert exc.value.error_code == "ERR_UNSUPPORTED_FILE_FORMAT"


def test_upload_path_rejects_sqlite(sample_csv_bytes):
    """上傳的是檔案內容，沒有資料庫連線可用；sqlite 不在此入口的合法值內。"""
    with pytest.raises(PetsError) as exc:
        load_dataframe_from_bytes(sample_csv_bytes, "data.csv", "sqlite")
    assert exc.value.error_code == "ERR_UNSUPPORTED_FILE_FORMAT"
    assert "CLI" in exc.value.message


def test_path_entry_accepts_sqlite_but_needs_table(temp_dir):
    """吃路徑的入口收 sqlite，但沒有表名就讀不了——擋在連線之前。"""
    with pytest.raises(PetsError) as exc:
        load_dataset("sqlite:///whatever.db", "sqlite")
    assert exc.value.error_code == "ERR_INVALID_PARAM"


def test_declared_format_conflict_note():
    """指定格式蓋過副檔名判定時給出告知，好讓覆蓋這件事看得見。"""
    note = declared_format_conflict("mislabelled.csv", "json")
    assert note and "csv" in note and "json" in note


def test_no_conflict_note_when_consistent_or_absent():
    """相符、未指定、或副檔名本來就認不得時都不告知（後者正是本參數的用途）。"""
    assert declared_format_conflict("data.csv", "csv") is None
    assert declared_format_conflict("data.csv", None) is None
    assert declared_format_conflict("dataset_export", "csv") is None


# ── 資料檔本身讀不懂：一律回帶原因的 4xx，不外露函式庫原文、也不變成伺服器錯誤 ──


@pytest.mark.parametrize(
    "name, content, reason",
    [
        ("d.csv", bytes(range(128, 256)) * 5, "文字編碼"),
        ("d.csv", b"", "沒有任何內容"),
        ("d.csv", b"a,b\n1,2\n3,4,5\n", "第 3 行有 3 個欄位，與表頭的 2 個不一致"),
        ("d.json", b"{not json", "不是合法的 JSON"),
        ("d.jsonl", b'{"a":1}\n{bad\n', "不是合法的 JSON"),
        ("d.xlsx", b"PK\x03\x04garbage", "Excel 檔已毀損"),
    ],
)
def test_unreadable_upload_is_reported_with_reason(name, content, reason):
    with pytest.raises(PetsError) as exc:
        load_dataframe_with_format(content, name)
    assert exc.value.error_code == "ERR_DATASET_UNREADABLE"
    assert exc.value.http_status == 400
    assert reason in exc.value.message


def test_missing_data_file_is_a_param_error(temp_dir):
    """資料檔路徑給錯比照設定檔路徑：參數錯，不是未預期錯誤。"""
    with pytest.raises(PetsError) as exc:
        load_dataset(os.path.join(temp_dir, "nope.csv"))
    assert exc.value.error_code == "ERR_INVALID_PARAM"


def test_sqlite_missing_file_table_or_not_a_database(temp_dir, sqlite_source):
    """SQLite 的檔案、資料表、檔案內容三種對不上，各自講明是哪一個。"""
    with pytest.raises(PetsError) as missing_file:
        load_dataset(f"sqlite:///{temp_dir}/nope.db", table_name="t")
    assert missing_file.value.error_code == "ERR_INVALID_PARAM"
    assert not os.path.exists(os.path.join(temp_dir, "nope.db"))  # 不在伺服器上留下空資料庫

    with pytest.raises(PetsError) as missing_table:
        load_dataset(sqlite_source.url, table_name="nope")
    assert missing_table.value.error_code == "ERR_INVALID_PARAM"
    assert "nope" in missing_table.value.message

    not_db = _write(temp_dir, "not_a_db.db", "plain text")
    with pytest.raises(PetsError) as bad_file:
        load_dataset(f"sqlite:///{not_db}", table_name="t")
    assert bad_file.value.error_code == "ERR_DATASET_UNREADABLE"


def test_export_result(temp_dir, sample_df):
    """測試 DataFrame 匯出至 CSV，並可再次正確讀取"""
    path = os.path.join(temp_dir, "test_export.csv")
    out = export_result(sample_df, path)
    assert os.path.exists(out)
    df_reloaded = pd.read_csv(out)
    assert len(df_reloaded) == 12
    assert len(df_reloaded.columns) == 10


@pytest.mark.parametrize("kind", ["csv", "json", "jsonl", "excel"])
def test_export_writes_integer_column_with_nulls_without_decimal(kind):
    """整數欄有空值時讀入會變浮點數；輸出須寫回整數（30 不寫成 30.0），空值照留空。"""
    df = pd.DataFrame({"逾期天數": [30.0, None, 60.0], "血糖": [1.5, None, 2.0]})
    fmt = DatasetFormat(kind=kind, json_orient="records", json_lines=kind == "jsonl")
    back, _ = load_dataframe_with_format(
        dataframe_to_bytes(df, fmt), f"out{fmt.output_extension}"
    )
    if kind == "csv":
        text = dataframe_to_bytes(df, fmt).decode("utf-8")
        assert text.splitlines()[1:] == ["30,1.5", ",", "60,2.0"]
    assert back["逾期天數"].dropna().tolist() == [30, 60]
    assert back["逾期天數"].isna().tolist() == [False, True, False]
    assert back["血糖"].dropna().tolist() == [1.5, 2.0]  # 含小數的欄位維持浮點數


def test_export_keeps_float_when_integer_conversion_fails():
    """值雖無小數但超出整數範圍，轉不成整數者維持原樣，不中止輸出。"""
    df = pd.DataFrame({"x": [1e20, None]})
    text = dataframe_to_bytes(df).decode("utf-8")
    assert text.splitlines()[1] == "1e+20"


def test_export_does_not_change_caller_dataframe():
    """只改輸出的寫法，呼叫端手上的資料型別不變。"""
    df = pd.DataFrame({"a": [30.0, None]})
    dataframe_to_bytes(df)
    assert df["a"].dtype == "float64"


def _write(tmp_dir, name, text):
    path = os.path.join(tmp_dir, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def _write_bundle(tmp_dir, name, payload):
    """把大包設定檔寫成 JSON 檔並回傳路徑（吃路徑的入口用）。"""
    return _write(tmp_dir, name, json.dumps(payload, ensure_ascii=False))


def test_parse_config_from_yaml_file(temp_dir):
    """從 YAML 檔案解析大包設定檔的 K-匿名區塊，驗證欄位的角色與型別"""
    text = """k_anonymity:
  enabled: true
  columns:
    姓名:
      role: identifier
      type: string
    年齡:
      role: quasi_identifier
      type: numeric
    生日:
      role: quasi_identifier
      type: temporal
    疾病:
      role: sensitive
      type: categorical
    薪資:
      role: non_sensitive
      type: numeric
"""
    config = parse_bundled_config(
        _write(temp_dir, "test_config.yaml", text), "k_anonymity"
    ).kanon
    assert len(config.columns) == 5
    assert config.columns["姓名"].role == "identifier"
    assert config.columns["年齡"].type == "numeric"
    assert config.columns["生日"].type == "temporal"
    assert config.columns["疾病"].role == "sensitive"
    assert config.columns["薪資"].role == "non_sensitive"


def test_parse_config_from_bytes(kanon_bundle):
    """從 bytes 解析大包設定檔（API 上傳場景）"""
    config = parse_bundled_config_from_bytes(
        kanon_bundle, "config.json", "k_anonymity"
    ).kanon
    assert len(config.columns) == 10
    assert config.columns["身分證號"].role == "identifier"
    assert config.columns["職業"].role == "quasi_identifier"


def test_config_validation_datetime_cannot_mask():
    """設定檔驗證：temporal 型別欄位不可使用 mask 策略"""
    config_invalid = ColumnConfig(
        columns={
            "生日": ColumnInfo(role="quasi_identifier", type="temporal", strategy="mask")
        }
    )
    with pytest.raises(ValueError, match="不支援遮蔽"):
        config_invalid.validate_config()


def test_config_identifier_default_strategy():
    """設定檔預設值：identifier 角色應自動預設 hash 策略（假名化，不主動移除）"""
    config = ColumnConfig(
        columns={"身分證號": ColumnInfo(role="identifier", type="string")}
    )
    assert config.columns["身分證號"].get_effective_strategy() == "hash"


def test_config_invalid_strategy_rejected():
    """strategy 打錯（如 'hsah'）應於解析設定檔時即報錯，不得靜默略過該欄處理"""
    with pytest.raises(ValueError, match="不合法的 strategy"):
        ColumnInfo(role="sensitive", type="numeric", strategy="hsah")


def test_config_strategy_removal_rejected():
    """strategy 寫成相近但不合法的字（如 'removal'）一律報錯，不自動對應到 remove"""
    with pytest.raises(ValueError, match="不合法的 strategy"):
        ColumnInfo(role="identifier", type="string", strategy="removal")


def test_config_strategy_case_insensitive():
    """strategy 大小寫寬容：'Hash' 應正規化為 'hash'"""
    info = ColumnInfo(role="sensitive", type="numeric", strategy="Hash")
    assert info.strategy == "hash"
    assert info.get_effective_strategy() == "hash"


def test_config_categorical_level_without_matrix_blocked():
    """類別型 QI 設了泛化層級卻未提供類別階層 → 解析設定檔時即擋（fail fast，前置）"""
    config = ColumnConfig(
        columns={"地區": ColumnInfo(role="quasi_identifier", type="categorical")},
        qi_generalization_levels={"地區": 1},  # 有層級，但沒 generalization_matrices
    )
    with pytest.raises(ValueError, match="提供對應階層"):
        config.validate_config()


def test_config_categorical_level_with_matrix_ok():
    """對照：類別型 QI 有層級且有提供類別階層 → 不擋"""
    config = ColumnConfig(
        columns={"地區": ColumnInfo(role="quasi_identifier", type="categorical")},
        qi_generalization_levels={"地區": 1},
        generalization_matrices={"地區": {"mapping": {"台北市": ["台北市", "北部"]}}},
    )
    config.validate_config()  # 不應拋錯


def test_config_categorical_level0_without_matrix_ok():
    """對照：層級為 0（不泛化）即使沒宣告階層也不擋（沒要求泛化，就不需要階層）"""
    config = ColumnConfig(
        columns={"地區": ColumnInfo(role="quasi_identifier", type="categorical")},
        qi_generalization_levels={"地區": 0},
    )
    config.validate_config()  # 不應拋錯


# ---------- 大包設定檔：根層欄位、區塊開關與端點需求的對照 ----------


def test_bundle_rejects_unknown_root_field(temp_dir, kanon_block):
    """根層不認識的欄位一律擋（第一層就從嚴，錯字不會被靜默吞掉）。"""
    payload = {"privacy_targets": {}, "k_anonymity": {"enabled": True, **kanon_block()}}
    with pytest.raises(ValueError, match="privacy_targets"):
        parse_bundled_config(
            _write_bundle(temp_dir, "root_extra.json", payload), "k_anonymity"
        )


def test_bundle_keeps_version_and_dataset(temp_dir, kanon_block):
    """version／dataset 只是標記這份設定檔是哪一份，收下但不參與運算。"""
    payload = {
        "version": "2026-08-26_10-00-00",
        "dataset": "finance_records",
        "k_anonymity": {"enabled": True, **kanon_block()},
    }
    cfgs = parse_bundled_config(
        _write_bundle(temp_dir, "meta.json", payload), "k_anonymity"
    )
    assert cfgs.version == "2026-08-26_10-00-00"
    assert cfgs.dataset == "finance_records"
    # 稽核紀錄只帶版本（事後查得到某次處理是用哪一版設定檔跑的）
    assert cfgs.audit_fields() == {"config_version": "2026-08-26_10-00-00"}


def test_bundle_without_version_writes_no_audit_field(temp_dir, kanon_block):
    """沒宣告版本就不在稽核紀錄留空欄位。"""
    payload = {"k_anonymity": {"enabled": True, **kanon_block()}}
    cfgs = parse_bundled_config(
        _write_bundle(temp_dir, "no_version.json", payload), "k_anonymity"
    )
    assert cfgs.audit_fields() == {}


def test_bundle_block_requires_enabled(temp_dir, kanon_block):
    """區塊寫了就必須明講 enabled，不由系統代為判斷這次用不用它。"""
    payload = {"k_anonymity": kanon_block()}
    with pytest.raises(ValueError, match="enabled"):
        parse_bundled_config(
            _write_bundle(temp_dir, "no_flag.json", payload), "k_anonymity"
        )


def test_bundle_enabled_must_be_boolean(temp_dir, kanon_block):
    """enabled 寫成字串＝開關講不清楚，擋。"""
    payload = {"k_anonymity": {"enabled": "yes", **kanon_block()}}
    with pytest.raises(ValueError, match="true 或 false"):
        parse_bundled_config(
            _write_bundle(temp_dir, "bad_flag.json", payload), "k_anonymity"
        )


def test_bundle_missing_block_is_blocked(temp_dir, risk_block):
    """整塊省略＝關閉；這次要用的區塊沒開就擋，並指名缺哪一塊。"""
    payload = {"risk_cap": {"enabled": True, **risk_block()}}
    with pytest.raises(ValueError, match="ERR_CONFIG_BLOCK_REQUIRED"):
        parse_bundled_config(
            _write_bundle(temp_dir, "no_block.json", payload), "k_anonymity"
        )


def test_bundle_extra_enabled_block_is_ignored(temp_dir, kanon_block, risk_block):
    """同一份設定檔可放多種處理的區塊：打哪個入口就取哪幾塊，其餘開著也不管。"""
    payload = {
        "k_anonymity": {"enabled": True, **kanon_block()},
        "risk_attacks": {"enabled": True, **risk_block()},
    }
    cfgs = parse_bundled_config(
        _write_bundle(temp_dir, "two_blocks.json", payload), "k_anonymity"
    )
    assert cfgs.kanon is not None
    assert cfgs.risk is None


def test_bundle_disabled_block_content_is_not_validated(temp_dir, kanon_block):
    """enabled: false 的區塊連內容都不看——只想跑 K-匿名的人不必把別塊填成合法內容。"""
    payload = {
        "k_anonymity": {"enabled": True, **kanon_block()},
        "differential_privacy": {"enabled": False, "亂寫的欄位": 123},
        "risk_attacks": {"enabled": False},
    }
    cfgs = parse_bundled_config(
        _write_bundle(temp_dir, "disabled.json", payload), "k_anonymity"
    )
    assert cfgs.kanon is not None
    assert cfgs.dp is None


def test_bundle_root_input_format_reaches_the_block(temp_dir, kanon_block):
    """輸入格式寫在根層（各種功能共用的唯一欄位），拆袋子時灌進要用的區塊。"""
    payload = {"input_format": "csv", "k_anonymity": {"enabled": True, **kanon_block()}}
    cfgs = parse_bundled_config(
        _write_bundle(temp_dir, "root_format.json", payload), "k_anonymity"
    )
    assert cfgs.kanon.input_format == "csv"


def test_bundle_rejects_input_format_inside_block(temp_dir, kanon_block):
    """輸入格式只能寫在根層；塞回區塊內＝兩個地方各有一份，擋。"""
    payload = {"k_anonymity": {"enabled": True, **kanon_block(input_format="csv")}}
    with pytest.raises(ValueError, match="input_format"):
        parse_bundled_config(
            _write_bundle(temp_dir, "block_format.json", payload), "k_anonymity"
        )


def test_bundle_risk_cap_rejects_experiment_params(temp_dir, risk_block):
    """CAP 不切分、不產 syn，七個實驗參數一個都收不得（風險依用途拆兩塊的用意）。"""
    payload = {"risk_cap": {"enabled": True, **risk_block(n_iter=30)}}
    with pytest.raises(ValueError, match="n_iter"):
        parse_bundled_config(_write_bundle(temp_dir, "cap_iter.json", payload), "risk_cap")


def test_bundle_risk_attacks_rejects_processed_format(temp_dir, risk_block):
    """去識別後資料集只有 CAP 有，三攻擊區塊寫 processed_format＝放錯地方，擋。"""
    payload = {
        "risk_attacks": {"enabled": True, **risk_block(processed_format="csv")},
        "differential_privacy": {
            "enabled": True,
            "column_budgets": {"年齡": {"type": "continuous", "epsilon_budget": 1.0}},
        },
    }
    with pytest.raises(ValueError, match="processed_format"):
        parse_bundled_config(
            _write_bundle(temp_dir, "attacks_proc.json", payload), "risk_dp"
        )


# ---------- 前處理區塊（與其他區塊同一套拆袋子規則） ----------


_PREPROCESS_COLUMNS = [
    {"column": "地區", "actions": [{"action": "trim", "params": {"mode": "all"}}]}
]


def test_bundle_preprocess_block_parsed(temp_dir):
    """前處理是大包的第五個區塊：清單放在區塊的 columns 內。"""
    payload = {
        "version": "manual_test_preprocess",
        "preprocess": {"enabled": True, "columns": _PREPROCESS_COLUMNS},
    }
    cfgs = parse_bundled_config(
        _write_bundle(temp_dir, "preprocess.json", payload), "preprocess"
    )
    assert cfgs.preprocess is not None
    assert cfgs.preprocess.columns[0].column == "地區"
    assert cfgs.preprocess.columns[0].actions[0].action == "trim"
    # 版本一樣寫進稽核紀錄（與其他五個端點同一套）
    assert cfgs.audit_fields() == {"config_version": "manual_test_preprocess"}


def test_bundle_preprocess_takes_root_input_format_and_algorithm(temp_dir):
    """輸入格式來自根層；雜湊演算法是區塊層參數，整份清單共用。"""
    payload = {
        "input_format": "csv",
        "preprocess": {
            "enabled": True,
            "algorithm": "sha256",
            "columns": _PREPROCESS_COLUMNS,
        },
    }
    cfgs = parse_bundled_config(
        _write_bundle(temp_dir, "preprocess_root.json", payload), "preprocess"
    )
    assert cfgs.preprocess.input_format == "csv"
    assert cfgs.preprocess.algorithm == "sha256"


def test_bundle_preprocess_block_is_required(temp_dir, kanon_block):
    """開的是別的區塊＝這次要用的前處理區塊沒開，擋。"""
    payload = {"k_anonymity": {"enabled": True, **kanon_block()}}
    with pytest.raises(ValueError, match="ERR_CONFIG_BLOCK_REQUIRED"):
        parse_bundled_config(
            _write_bundle(temp_dir, "no_preprocess.json", payload), "preprocess"
        )


def test_bundle_preprocess_block_is_ignored_on_other_endpoint(temp_dir, kanon_block):
    """去識別化不會用到前處理區塊，開著也只是略過，不影響 K-匿名這次處理。"""
    payload = {
        "k_anonymity": {"enabled": True, **kanon_block()},
        "preprocess": {"enabled": True, "columns": _PREPROCESS_COLUMNS},
    }
    cfgs = parse_bundled_config(
        _write_bundle(temp_dir, "kanon_with_preprocess.json", payload), "k_anonymity"
    )
    assert cfgs.kanon is not None
    assert cfgs.preprocess is None


def test_block_field_lists_match_the_config_classes():
    """欄位白名單與設定類別不可漂開：白名單多寫的欄位建物件時根本收不到。

    白名單是手寫的（風險依用途拆兩塊，一個 RiskConfig 做不到），故補這道守門，
    免得日後改了設定類別的欄位名、白名單卻留著舊的。
    """
    from app.core.config import _BLOCK_SPECS

    for model_cls, fields, label in _BLOCK_SPECS.values():
        unknown = set(fields) - set(model_cls.model_fields)
        assert not unknown, f"{label} 區塊的白名單有 {model_cls.__name__} 沒有的欄位：{unknown}"


# ---------- 風險評估區塊（RiskConfig：獨立區塊、自我檢查） ----------


# 三攻擊端點必須同時開一個去識別區塊才拆得開，故備一份最小的 DP 區塊供組裝用。
_MINIMAL_DP_BLOCK = {
    "enabled": True,
    "column_budgets": {"年齡": {"type": "continuous", "epsilon_budget": 1.0}},
}


def _risk_bundle(tmp_dir, name, columns, attacks=False, **params):
    """組出只開風險區塊的大包設定檔並解析，回傳 RiskConfig。

    attacks=True 走 risk_attacks（三攻擊，連結性 A／B 只在這一塊），
    否則走只需一塊的 risk_cap。
    """
    if attacks:
        payload = {
            "risk_attacks": {"enabled": True, "columns": columns, **params},
            "differential_privacy": _MINIMAL_DP_BLOCK,
        }
        endpoint = "risk_dp"
    else:
        payload = {"risk_cap": {"enabled": True, "columns": columns, **params}}
        endpoint = "risk_cap"
    return parse_bundled_config(_write_bundle(tmp_dir, name, payload), endpoint).risk


def test_risk_config_valid_parses(temp_dir):
    """合法風險區塊（role 兩值、type 四值）應正常解析並萃取角色"""
    config = _risk_bundle(
        temp_dir,
        "risk_ok.json",
        {
            "年齡": {"role": "quasi_identifier", "type": "numeric"},
            "疾病": {"role": "sensitive", "type": "categorical"},
        },
    )
    assert config.columns["年齡"].role == "quasi_identifier"
    assert config.columns["疾病"].role == "sensitive"


def test_risk_config_rejects_identifier_role(temp_dir):
    """風險區塊的 role 只收 QI/sensitive；identifier 應被擋"""
    with pytest.raises(ValueError, match="role"):
        _risk_bundle(
            temp_dir, "risk_id.json", {"姓名": {"role": "identifier", "type": "string"}}
        )


def test_risk_config_blocks_multiple_sensitive(temp_dir):
    """一次只評估一個 sensitive；宣告 2+ 應前置擋"""
    with pytest.raises(ValueError, match="ERR_RISK_CONFIG_MULTI_SENSITIVE"):
        _risk_bundle(
            temp_dir,
            "risk_multi.json",
            {
                "年齡": {"role": "quasi_identifier", "type": "numeric"},
                "疾病": {"role": "sensitive", "type": "categorical"},
                "薪資": {"role": "sensitive", "type": "numeric"},
            },
        )


def test_risk_config_blocks_zero_sensitive(temp_dir):
    """風險評估需恰好一個 sensitive；宣告 0 個應於解析設定檔時前置擋"""
    with pytest.raises(ValueError, match="ERR_RISK_CONFIG_NO_SENSITIVE"):
        _risk_bundle(
            temp_dir,
            "risk_no_sens.json",
            {
                "年齡": {"role": "quasi_identifier", "type": "numeric"},
                "地區": {"role": "quasi_identifier", "type": "categorical"},
            },
        )


def test_risk_config_rejects_duplicate_key_yaml(temp_dir):
    """YAML 重複欄名不可被靜默覆蓋，須報錯（config 自我檢查）"""
    text = (
        "risk_cap:\n"
        "  enabled: true\n"
        "  columns:\n"
        "    年齡:\n      role: quasi_identifier\n      type: numeric\n"
        "    年齡:\n      role: sensitive\n      type: numeric\n"
    )
    with pytest.raises(ValueError, match="重複"):
        parse_bundled_config(_write(temp_dir, "risk_dup.yaml", text), "risk_cap")


def test_risk_config_rejects_duplicate_key_json(temp_dir):
    """JSON 重複欄名同樣須報錯，不得後者靜默覆蓋"""
    text = (
        '{"risk_cap": {"enabled": true, "columns": '
        '{"年齡": {"role": "quasi_identifier", "type": "numeric"}, '
        '"年齡": {"role": "sensitive", "type": "numeric"}}}}'
    )
    with pytest.raises(ValueError, match="重複"):
        parse_bundled_config(_write(temp_dir, "risk_dup.json", text), "risk_cap")


def test_risk_config_rejects_extra_column_fields(temp_dir):
    """逐欄那層也從嚴：風險區塊只認 role/type，混進 strategy 就擋（避免打錯字被靜默吞掉）。
    """
    with pytest.raises(ValueError, match="strategy"):
        _risk_bundle(
            temp_dir,
            "risk_extra.json",
            {
                "年齡": {
                    "role": "quasi_identifier",
                    "type": "numeric",
                    "strategy": "generalize",
                },
                "疾病": {"role": "sensitive", "type": "categorical"},
            },
        )


def test_risk_config_linkability_parses(temp_dir):
    """連結性 A/B 屬欄位角色，由風險區塊的 linkability 提供並正常解析"""
    config = _risk_bundle(
        temp_dir,
        "risk_link.json",
        {
            "年齡": {"role": "quasi_identifier", "type": "numeric"},
            "地區": {"role": "quasi_identifier", "type": "categorical"},
            "疾病": {"role": "sensitive", "type": "categorical"},
        },
        attacks=True,
        linkability={"A": ["年齡"], "B": ["地區"]},
    )
    assert config.linkability.A == ["年齡"]
    assert config.linkability.B == ["地區"]


def test_risk_config_linkability_incomplete_rejected(temp_dir):
    """linkability 只給 A 沒給 B → 前置擋（成對非空為純 config 規則）"""
    with pytest.raises(ValueError, match="ERR_LINK_AB_INCOMPLETE"):
        _risk_bundle(
            temp_dir,
            "risk_link_incomplete.json",
            {
                "年齡": {"role": "quasi_identifier", "type": "numeric"},
                "疾病": {"role": "sensitive", "type": "categorical"},
            },
            attacks=True,
            linkability={"A": ["年齡"]},
        )


def test_risk_config_linkability_overlap_rejected(temp_dir):
    """linkability A、B 有共同欄位 → 前置擋（垂直切割要求一欄只在一邊）"""
    with pytest.raises(ValueError, match="ERR_LINK_AB_OVERLAP"):
        _risk_bundle(
            temp_dir,
            "risk_link_overlap.json",
            {
                "年齡": {"role": "quasi_identifier", "type": "numeric"},
                "地區": {"role": "quasi_identifier", "type": "categorical"},
                "疾病": {"role": "sensitive", "type": "categorical"},
            },
            attacks=True,
            linkability={"A": ["年齡", "地區"], "B": ["地區"]},
        )


def test_column_config_rejects_duplicate_key_yaml(temp_dir):
    """K-匿名區塊的 YAML 重複欄名須報錯，不得後者靜默覆蓋（比照風險區塊）"""
    text = (
        "k_anonymity:\n"
        "  enabled: true\n"
        "  columns:\n"
        "    年齡:\n      role: quasi_identifier\n      type: numeric\n"
        "    年齡:\n      role: sensitive\n      type: numeric\n"
    )
    with pytest.raises(ValueError, match="重複"):
        parse_bundled_config(_write(temp_dir, "col_dup.yaml", text), "k_anonymity")


def test_column_config_rejects_duplicate_key_json(temp_dir):
    """K-匿名區塊的 JSON 重複欄名同樣須報錯"""
    text = (
        '{"k_anonymity": {"enabled": true, "columns": '
        '{"年齡": {"role": "quasi_identifier", "type": "numeric"}, '
        '"年齡": {"role": "sensitive", "type": "numeric"}}}}'
    )
    with pytest.raises(ValueError, match="重複"):
        parse_bundled_config(_write(temp_dir, "col_dup.json", text), "k_anonymity")


def _alias_bomb_text(depth: int) -> str:
    """組出以錨點層層自我引用的設定檔內容；深度每加一層，展開後的元素數量翻倍。"""
    lines = ["a0: &a0 [1, 2]"]
    for i in range(1, depth + 1):
        lines.append(f"a{i}: &a{i} [*a{i - 1}, *a{i - 1}]")
    lines += [
        "k_anonymity:",
        "  enabled: true",
        "  columns:",
        "    城市:",
        "      role: quasi_identifier",
        "      type: categorical",
        "  generalization_hierarchies:",
        f"    城市: *a{depth}",
    ]
    return "\n".join(lines)


def test_column_config_rejects_yaml_alias(temp_dir):
    """設定檔用到 YAML 錨點與別名須當場拒絕，不得等到走訪內容時才發現。

    別名在解析後共用同一個物件，檔案本身只有幾百位元組，但後續逐項走訪的程式
    會把同一份資料重複走過極多次，足以讓服務長時間無回應。
    """
    text = _alias_bomb_text(26)
    assert len(text.encode("utf-8")) < 1024  # 檔案很小，不會被上傳大小限制擋下
    with pytest.raises(ValueError, match="錨點"):
        parse_bundled_config(_write(temp_dir, "col_alias.yaml", text), "k_anonymity")


def test_column_config_without_alias_still_parses(temp_dir):
    """一般設定檔不受擋別名的影響，照常解析。"""
    text = (
        "k_anonymity:\n"
        "  enabled: true\n"
        "  columns:\n"
        "    年齡:\n      role: quasi_identifier\n      type: numeric\n"
        "  generalization_hierarchies:\n"
        "    年齡:\n"
        "      bins:\n"
        "        - {min: 0, max: 18, label: 未成年}\n"
        "        - {min: 18, max: 65, label: 成年}\n"
    )
    cfg = parse_bundled_config(
        _write(temp_dir, "col_ok.yaml", text), "k_anonymity"
    ).kanon
    assert "年齡" in cfg.columns


def test_dp_config_rejects_duplicate_key_yaml(temp_dir):
    """DP 區塊的 YAML 重複欄名須報錯，不得後者靜默覆蓋（比照風險區塊）"""
    text = (
        "differential_privacy:\n"
        "  enabled: true\n"
        "  column_budgets:\n"
        "    薪資:\n      type: continuous\n      epsilon_budget: 1.0\n"
        "    薪資:\n      type: continuous\n      epsilon_budget: 2.0\n"
    )
    with pytest.raises(ValueError, match="重複"):
        parse_bundled_config(_write(temp_dir, "dp_dup.yaml", text), "dp")


def test_dp_config_rejects_duplicate_key_json(temp_dir):
    """DP 區塊的 JSON 重複欄名同樣須報錯"""
    text = (
        '{"differential_privacy": {"enabled": true, "column_budgets": '
        '{"薪資": {"type": "continuous", "epsilon_budget": 1.0}, '
        '"薪資": {"type": "continuous", "epsilon_budget": 2.0}}}}'
    )
    with pytest.raises(ValueError, match="重複"):
        parse_bundled_config(_write(temp_dir, "dp_dup.json", text), "dp")


# ── 數值泛化設定：純 config 即可判定的錯誤一律解析時擋（fail fast） ──────────

def _numeric_cfg(spec):
    return ColumnConfig(
        columns={"年齡": ColumnInfo(role="quasi_identifier", type="numeric")},
        generalization_hierarchies={"年齡": spec},
    )


def test_numeric_bins_and_rounding_mutually_exclusive():
    """同一欄同時給 bins 與 rounding → 兩種切法衝突，擋"""
    with pytest.raises(ValueError, match="擇一"):
        _numeric_cfg({"bins": [{"min": 0, "max": 10, "label": "a"}], "rounding": 10})


@pytest.mark.parametrize("bad", [0, -10, "10", None])
def test_numeric_rounding_rejects_unusable_unit(bad):
    """rounding 為 0（除以零）、負數、非數字 → 會讓處理無法進行，擋"""
    with pytest.raises(ValueError, match="rounding"):
        _numeric_cfg({"rounding": bad})


def test_numeric_bins_rejects_empty():
    """bins 給空陣列＝沒有任何區間可用，擋"""
    with pytest.raises(ValueError, match="至少含一段"):
        _numeric_cfg({"bins": []})


def test_numeric_bins_rejects_missing_label():
    """區間缺標籤或標籤全為空白 → 輸出無名可用，擋"""
    with pytest.raises(ValueError, match="label"):
        _numeric_cfg({"bins": [{"min": 0, "max": 10}]})
    with pytest.raises(ValueError, match="label"):
        _numeric_cfg({"bins": [{"min": 0, "max": 10, "label": "   "}]})


def test_numeric_bins_rejects_min_not_less_than_max():
    """單段的 min 不小於 max → 該段永遠比不中，擋"""
    with pytest.raises(ValueError, match="min 必須小於 max"):
        _numeric_cfg({"bins": [{"min": 30, "max": 10, "label": "怪"}]})


def test_numeric_bins_rejects_overlap():
    """區間重疊或未由小到大排列 → 同一值會落入兩段，擋"""
    with pytest.raises(ValueError, match="重疊"):
        _numeric_cfg(
            {
                "bins": [
                    {"min": 0, "max": 30, "label": "a"},
                    {"min": 20, "max": 50, "label": "b"},
                ]
            }
        )


def test_numeric_bins_rejects_open_bound_in_middle():
    """開放端只允許出現在頭尾；中間段省略邊界會吃掉其他段，擋"""
    with pytest.raises(ValueError, match="不可省略"):
        _numeric_cfg(
            {
                "bins": [
                    {"min": 0, "max": 30, "label": "a"},
                    {"min": None, "max": 50, "label": "b"},
                    {"min": 50, "max": 80, "label": "c"},
                ]
            }
        )


def test_numeric_bins_allows_gap_between_segments():
    """段與段之間留空隙屬使用者自訂範圍，不擋（落空的值由報告告知）"""
    cfg = _numeric_cfg(
        {
            "bins": [
                {"min": 0, "max": 20, "label": "少年"},
                {"min": 60, "max": 100, "label": "長者"},
            ]
        }
    )
    assert cfg.generalization_hierarchies["年齡"]["bins"][1]["label"] == "長者"


def _date_cfg(spec):
    return ColumnConfig(
        columns={"生日": ColumnInfo(role="quasi_identifier", type="temporal")},
        generalization_hierarchies={"生日": spec},
    )


def test_temporal_levels_rejects_empty():
    """levels 給空陣列或非陣列＝沒宣告任何粒度，擋"""
    with pytest.raises(ValueError, match="至少含一項"):
        _date_cfg({"levels": []})
    with pytest.raises(ValueError, match="至少含一項"):
        _date_cfg({"levels": "day"})


def test_temporal_levels_rejects_unknown_granularity():
    """粒度名稱不在可用清單內＝系統無從決定輸出到哪一級，擋"""
    with pytest.raises(ValueError, match="不是可用的時間粒度"):
        _date_cfg({"levels": ["day", "quarter", "year"]})


def test_temporal_levels_rejects_duplicate():
    """粒度重複＝層級對應有歧義，擋"""
    with pytest.raises(ValueError, match="重複"):
        _date_cfg({"levels": ["day", "month", "month"]})


def test_temporal_levels_rejects_wrong_order():
    """排成由粗到細會泛化成更細的粒度、把識別力最強的部分留下來，擋"""
    with pytest.raises(ValueError, match="由細到粗"):
        _date_cfg({"levels": ["year", "month", "day"]})


def test_temporal_levels_accepts_counterpart_writing():
    """整合方設定檔的寫法直接收（由細到粗、小寫粒度名）"""
    cfg = _date_cfg({"levels": ["day", "month", "year"]})
    assert cfg.generalization_hierarchies["生日"]["levels"] == ["day", "month", "year"]


_PERIODS = [
    {"min": "00:00", "max": "06:00", "label": "凌晨"},
    {"min": "06:00", "max": "12:00", "label": "上午"},
    {"min": "12:00", "max": "24:00", "label": "下午"},
]


def test_time_periods_requires_levels():
    """時段對照表要有粒度階梯才知道何時套用，沒有 levels 就擋"""
    with pytest.raises(ValueError, match="沒有 levels"):
        _date_cfg({"time_periods": _PERIODS})


def test_time_periods_rejects_bad_bound_format():
    """界線須為 HH:MM 或 HH:MM:SS 的時間字串，數字或其他寫法擋"""
    with pytest.raises(ValueError, match="HH:MM"):
        _date_cfg({"levels": ["hour"], "time_periods": [{"min": 6, "max": 12, "label": "上午"}]})


def test_time_periods_rejects_bound_beyond_one_day():
    """界線超過一天＝寫錯單位，擋"""
    with pytest.raises(ValueError, match="超出一天"):
        _date_cfg(
            {
                "levels": ["hour"],
                "time_periods": [{"min": "00:00", "max": "25:00", "label": "整天"}],
            }
        )


def test_time_periods_accepts_half_hour_bound():
    """界線可寫非整點（06:30），這是整合方設定檔要的能力"""
    cfg = _date_cfg(
        {
            "levels": ["minute", "hour"],
            "time_periods": [
                {"min": "00:00", "max": "06:30", "label": "凌晨"},
                {"min": "06:30", "max": "24:00", "label": "白天"},
            ],
        }
    )
    assert cfg.generalization_hierarchies["生日"]["time_periods"][0]["max"] == "06:30"


def test_time_periods_rejects_star_in_label():
    """"*" 保留給未涵蓋的值，標籤混用會分不出來，擋"""
    with pytest.raises(ValueError, match="不可含"):
        _date_cfg(
            {
                "levels": ["hour"],
                "time_periods": [{"min": "00:00", "max": "24:00", "label": "整*天"}],
            }
        )


def test_time_periods_reuses_numeric_bin_checks():
    """界線轉成當日秒數後就是數值 bins，沿用同一套檢查（此處驗重疊）"""
    with pytest.raises(ValueError, match="重疊"):
        _date_cfg(
            {
                "levels": ["hour"],
                "time_periods": [
                    {"min": "00:00", "max": "12:00", "label": "上午"},
                    {"min": "06:00", "max": "24:00", "label": "下午"},
                ],
            }
        )


def test_time_periods_allows_same_label_twice():
    """跨午夜這類繞一圈的範圍＝寫成兩段同名，放行"""
    cfg = _date_cfg(
        {
            "levels": ["hour"],
            "time_periods": [
                {"min": "00:00", "max": "06:00", "label": "深夜"},
                {"min": "06:00", "max": "22:00", "label": "白天"},
                {"min": "22:00", "max": "24:00", "label": "深夜"},
            ],
        }
    )
    labels = [s["label"] for s in cfg.generalization_hierarchies["生日"]["time_periods"]]
    assert labels == ["深夜", "白天", "深夜"]


# ── 下載檔名標頭 ──────────────────────────────────────────────────────────


def test_content_disposition_is_header_encodable():
    """標頭值一律要能以 latin-1 送出，中文檔名不得讓回應在送出時炸掉"""
    value = content_disposition_attachment("anonymized_病患資料.csv")
    value.encode("latin-1")  # 不可拋 UnicodeEncodeError


def test_content_disposition_keeps_original_name_encoded():
    """原檔名以 UTF-8 百分比編碼保留在 filename*，使用者存下來仍是中文檔名"""
    value = content_disposition_attachment("報告.csv")
    assert "filename*=UTF-8''" in value
    assert quote("報告.csv", safe="") in value


def test_content_disposition_ascii_fallback_has_name_and_extension():
    """純中文檔名濾掉非 ASCII 後會空掉，退路須補通用名並保留副檔名"""
    value = content_disposition_attachment("病患資料.csv")
    assert 'filename="download.csv"' in value


def test_content_disposition_keeps_ascii_name_as_is():
    """英數檔名不受影響，退路就是原本的名字"""
    value = content_disposition_attachment("anonymized_patients.csv")
    assert 'filename="anonymized_patients.csv"' in value


def test_content_disposition_strips_newline_from_filename():
    """檔名夾帶換行會被當成標頭分隔，須先濾掉，不讓呼叫方藉檔名多塞標頭"""
    value = content_disposition_attachment("bad\r\nX-Injected: 1.csv")
    assert "\r" not in value
    assert "\n" not in value


def test_categorical_mapping_requires_mapping_key():
    """類別階層須以 mapping 包裝：直接給陣列於解析設定檔時即擋"""
    with pytest.raises(ValueError, match="mapping"):
        ColumnConfig(
            columns={"地區": ColumnInfo(role="quasi_identifier", type="categorical")},
            generalization_matrices={"地區": [["台北市", "北部"]]},
        )


def test_categorical_mapping_first_item_must_equal_key():
    """階梯第 1 項代表未泛化的原值，與鍵不同即擋（照收會泛化出使用者沒預期的值）"""
    with pytest.raises(ValueError, match="須與原始值相同"):
        ColumnConfig(
            columns={"地區": ColumnInfo(role="quasi_identifier", type="categorical")},
            generalization_matrices={"地區": {"mapping": {"台北市": ["北部", "台灣"]}}},
        )


def test_categorical_mapping_empty_ladder_blocked():
    """階梯為空陣列 → 沒有任何層級可用，擋"""
    with pytest.raises(ValueError, match="階梯陣列"):
        ColumnConfig(
            columns={"地區": ColumnInfo(role="quasi_identifier", type="categorical")},
            generalization_matrices={"地區": {"mapping": {"台北市": []}}},
        )
