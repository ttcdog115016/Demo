"""三攻擊只讀需要的欄位（大資料省記憶體）。

守三件事：
  1. 讀檔的 columns 參數：只讀指定欄位、表頭沒有的名稱不報錯、前導零代碼欄位仍保持文字、
     columns 不給（或要的就是全部）時與原本完全相同；
  2. 欄位挑選：K-匿名剔除 identifier、DP 的 column_budgets 一律保留、含連結性與子群體欄位；
  3. 端到端：裁欄後的三攻擊報告與整份讀入的報告一致（只差耗時）。
"""
import json

import numpy as np
import pandas as pd
import pytest
from typer.testing import CliRunner

from app.cli.main import cli
from app.core.config import parse_bundled_config_from_bytes
from app.core.dataset_io import (
    OMITTED_COLUMNS_ATTR,
    load_dataframe_with_format,
    load_dataset,
)
from app.engines.risk.columns import drop_omitted_identifiers, required_attack_columns

runner = CliRunner()


# ── 1 讀檔：columns 參數 ────────────────────────────────────────────────────

@pytest.fixture
def csv_path(tmp_path):
    path = tmp_path / "data.csv"
    path.write_text(
        "編號,金額,代碼,地區\nA1,100,09007,北\nA2,200,10001,南\nA3,300,09007,北\n",
        encoding="utf-8",
    )
    return str(path)


def test_columns_reads_only_the_requested_columns(csv_path):
    df = load_dataset(csv_path, columns=["金額", "地區"])
    assert list(df.columns) == ["金額", "地區"]
    assert df.attrs[OMITTED_COLUMNS_ATTR] == ("編號", "代碼")


def test_columns_none_reads_everything_without_marker(csv_path):
    df = load_dataset(csv_path)
    assert list(df.columns) == ["編號", "金額", "代碼", "地區"]
    assert OMITTED_COLUMNS_ATTR not in df.attrs


def test_columns_covering_the_whole_header_reads_everything(csv_path):
    df = load_dataset(csv_path, columns={"編號", "金額", "代碼", "地區", "不存在"})
    assert list(df.columns) == ["編號", "金額", "代碼", "地區"]
    assert OMITTED_COLUMNS_ATTR not in df.attrs


def test_names_missing_from_the_header_are_ignored_not_errors(csv_path):
    """檔案沒有的欄位名不在這裡報錯：欄位對不對由後續驗證負責，訊息與全讀時一致。"""
    df = load_dataset(csv_path, columns=["金額", "不存在"])
    assert list(df.columns) == ["金額"]


def test_columns_matching_nothing_falls_back_to_full_read(csv_path):
    df = load_dataset(csv_path, columns=["不存在"])
    assert list(df.columns) == ["編號", "金額", "代碼", "地區"]
    assert OMITTED_COLUMNS_ATTR not in df.attrs


def test_leading_zero_code_stays_text_even_when_columns_are_dropped(csv_path):
    """裁欄後重讀數值欄的位置要對回檔案原位置：代碼欄 09007 不能被讀成 9007。"""
    df = load_dataset(csv_path, columns=["金額", "代碼"])
    assert list(df.columns) == ["金額", "代碼"]
    assert list(df["代碼"]) == ["09007", "10001", "09007"]
    assert pd.api.types.is_numeric_dtype(df["金額"])


def test_columns_work_for_uploaded_bytes_too(csv_path):
    content = open(csv_path, "rb").read()
    df, fmt = load_dataframe_with_format(content, "data.csv", columns=["金額", "代碼"])
    assert fmt.kind == "csv"
    assert list(df.columns) == ["金額", "代碼"]
    assert list(df["代碼"]) == ["09007", "10001", "09007"]


def test_columns_result_equals_full_read_then_select(csv_path):
    full = load_dataset(csv_path)[["金額", "代碼"]]
    trimmed = load_dataset(csv_path, columns=["金額", "代碼"])
    pd.testing.assert_frame_equal(trimmed, full)


# ── 2 欄位挑選 ───────────────────────────────────────────────────────────────

def _bundle(mode: str, blocks: dict) -> object:
    payload = {"version": "t", "dataset": "t", **blocks}
    return parse_bundled_config_from_bytes(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"), "c.json", mode
    )


_RISK_BLOCK = {
    "enabled": True,
    "columns": {
        "地區": {"role": "quasi_identifier", "type": "categorical"},
        "性別": {"role": "quasi_identifier", "type": "categorical"},
        "疾病": {"role": "sensitive", "type": "categorical"},
    },
}
_KANON_BLOCK = {
    "enabled": True,
    "k": 2,
    "columns": {
        "編號": {"role": "identifier", "type": "string"},
        "車牌": {"role": "identifier", "type": "string"},
        "地區": {"role": "quasi_identifier", "type": "categorical"},
        "性別": {"role": "quasi_identifier", "type": "categorical"},
        "疾病": {"role": "sensitive", "type": "categorical"},
        "備註": {"role": "non_sensitive", "type": "string"},
    },
    "qi_generalization_levels": {"地區": 0, "性別": 0},
}
_DP_BLOCK = {
    "enabled": True,
    "column_budgets": {
        "金額": {"type": "continuous", "epsilon_budget": 1.0, "sensitivity": 10.0},
        "疾病": {"type": "categorical", "epsilon_budget": 1.0},
    },
}


def test_kanon_drops_identifier_columns_keeps_the_rest():
    cfgs = _bundle("risk_k_anonymity", {"risk_attacks": _RISK_BLOCK, "k_anonymity": _KANON_BLOCK})
    needed = required_attack_columns(cfgs.risk, cfgs.kanon)
    assert needed == {"地區", "性別", "疾病", "備註"}  # 編號、車牌（identifier）不讀


def test_dp_keeps_every_budgeted_column_because_epsilon_is_reported():
    cfgs = _bundle("risk_dp", {"risk_attacks": _RISK_BLOCK, "differential_privacy": _DP_BLOCK})
    needed = required_attack_columns(cfgs.risk, cfgs.dp)
    assert needed == {"地區", "性別", "疾病", "金額"}


def test_linkability_and_subgroup_columns_are_kept():
    risk = {
        **_RISK_BLOCK,
        "linkability": {"A": ["地區"], "B": ["性別"]},
        "subgroup": {"年齡": {"min": 30, "max": 40}},
    }
    cfgs = _bundle("risk_k_anonymity", {"risk_attacks": risk, "k_anonymity": _KANON_BLOCK})
    assert {"地區", "性別", "年齡"} <= required_attack_columns(cfgs.risk, cfgs.kanon)


def test_drop_omitted_identifiers_only_drops_columns_that_were_skipped_on_read():
    cfgs = _bundle("risk_k_anonymity", {"risk_attacks": _RISK_BLOCK, "k_anonymity": _KANON_BLOCK})
    df = pd.DataFrame({"地區": ["北"], "性別": ["男"], "疾病": ["甲"], "備註": ["x"]})
    # 「編號」檔案裡有、但讀檔時刻意沒讀 → 從設定去掉；「車牌」檔案裡根本沒有 → 照舊保留，
    # 讓驗證器報原本的錯誤（設定與資料對不上不會因為省欄位而被悄悄放過）
    df.attrs[OMITTED_COLUMNS_ATTR] = ("編號",)
    pruned = drop_omitted_identifiers(cfgs.kanon, df)
    assert "編號" not in pruned.columns
    assert "車牌" in pruned.columns
    assert "編號" in cfgs.kanon.columns  # 原設定物件不被改動


def test_drop_omitted_identifiers_is_a_noop_without_omissions_or_for_dp():
    cfgs = _bundle("risk_k_anonymity", {"risk_attacks": _RISK_BLOCK, "k_anonymity": _KANON_BLOCK})
    df = pd.DataFrame({"地區": ["北"]})
    assert drop_omitted_identifiers(cfgs.kanon, df) is cfgs.kanon
    dp = _bundle("risk_dp", {"risk_attacks": _RISK_BLOCK, "differential_privacy": _DP_BLOCK}).dp
    df.attrs[OMITTED_COLUMNS_ATTR] = ("編號",)
    assert drop_omitted_identifiers(dp, df) is dp


# ── 3 端到端：裁欄後報告與整份讀入一致 ───────────────────────────────────────

@pytest.fixture
def risk_k_inputs(tmp_path):
    rng = np.random.default_rng(0)
    n = 400
    df = pd.DataFrame(
        {
            "編號": [f"ID{i:05d}" for i in range(n)],
            "車牌": [f"PL{i:05d}" for i in range(n)],
            "地區": rng.choice(["北", "中", "南"], n),
            "性別": rng.choice(["男", "女"], n),
            "疾病": rng.choice(["甲", "乙", "丙", "丁"], n),
            "金額": rng.integers(0, 1000, n),
            "備註": rng.choice(["a", "b"], n),
        }
    )
    data = tmp_path / "data.csv"
    df.to_csv(data, index=False, encoding="utf-8")
    cfg = tmp_path / "cfg.json"
    cfg.write_text(
        json.dumps(
            {
                "version": "t",
                "dataset": "t",
                "risk_attacks": {**_RISK_BLOCK, "n_iter": 30, "seed": 7},
                "k_anonymity": _KANON_BLOCK,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return str(data), str(cfg)


def _report(result):
    assert result.exit_code == 0, result.output
    report = json.loads(result.stdout)
    report.pop("elapsed_seconds", None)
    return report


def test_risk_k_anonymity_report_is_the_same_with_and_without_column_trimming(
    risk_k_inputs, monkeypatch
):
    data, cfg = risk_k_inputs
    trimmed = _report(runner.invoke(cli, ["risk-k-anonymity", "-i", data, "-c", cfg]))

    # columns=None → 整份讀入、設定不動＝優化前的行為
    monkeypatch.setattr("app.cli.main.required_attack_columns", lambda rc, deid: None)
    full = _report(runner.invoke(cli, ["risk-k-anonymity", "-i", data, "-c", cfg]))

    assert trimmed == full


def test_risk_k_anonymity_still_reports_a_missing_identifier_column(risk_k_inputs, tmp_path):
    """設定宣告了檔案裡根本沒有的 identifier 欄位：照舊報錯，不因省欄位而被悄悄放過。"""
    data, cfg = risk_k_inputs
    df = pd.read_csv(data).drop(columns=["車牌"])
    df.to_csv(data, index=False, encoding="utf-8")
    result = runner.invoke(cli, ["risk-k-anonymity", "-i", data, "-c", cfg])
    assert result.exit_code != 0


# ── 4 推斷性攻擊：分批評分與整批評分結果相同（大資料不 OOM） ────────────────────

def test_inference_chunked_accuracy_equals_the_whole_batch_score():
    """分批預測只限制暫存陣列大小：準確率與 clf.score 逐位元相同，含批次邊界不整除的情況。"""
    from sklearn.ensemble import RandomForestClassifier

    from app.engines.risk.attacks.inference import _accuracy_in_chunks

    rng = np.random.default_rng(1)
    X = pd.DataFrame(rng.normal(size=(1000, 3)), columns=["a", "b", "c"])
    y = pd.Series(rng.choice(["甲", "乙", "丙"], 1000))
    clf = RandomForestClassifier(n_estimators=10, max_depth=5, random_state=0).fit(X, y)

    expected = clf.score(X, y)
    for chunk in (1, 7, 333, 1000, 5000):
        assert _accuracy_in_chunks(clf, X, y, chunk_rows=chunk) == expected


def test_inference_chunked_accuracy_of_empty_input_is_zero():
    from sklearn.ensemble import RandomForestClassifier

    from app.engines.risk.attacks.inference import _accuracy_in_chunks

    clf = RandomForestClassifier(n_estimators=2, random_state=0).fit(
        pd.DataFrame({"a": [0.0, 1.0]}), pd.Series(["x", "y"])
    )
    assert _accuracy_in_chunks(clf, pd.DataFrame({"a": []}), pd.Series([], dtype=str)) == 0.0
