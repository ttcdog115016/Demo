"""CLI - 資料前處理子命令。

守的是「引擎有的能力，指令列真的叫得到」：清單由上往下跑、輸出沿用輸入格式，
以及失敗時與 API 同一套錯誤碼與離開代碼（同 test_cli_errors 的分級）。
"""
import json

import pandas as pd
import pytest
from typer.testing import CliRunner

from app.cli.main import cli
from app.core.errors import HTTP_STATUS_EXIT_CODE

runner = CliRunner()


@pytest.fixture
def data_csv(tmp_path):
    """刻意留下前後空白、空格與髒值，讓每一項動作都有東西可做。"""
    df = pd.DataFrame(
        {
            "地址": ["  台北市大安區  ", "新北市板橋區", "  台中市西屯區"],
            "年齡": ["25歲", "31歲", "48歲"],
            "會員編號": ["M001", "M002", "M003"],
        }
    )
    path = tmp_path / "data.csv"
    df.to_csv(path, index=False, encoding="utf-8")
    return str(path)


@pytest.fixture
def write_config(tmp_path):
    """把區塊內容寫成一份只開 preprocess 的大包設定檔，回傳路徑（CLI 吃路徑）。

    根層欄位（version／dataset／input_format）以 root= 帶入。
    """

    def _write(
        block: dict, name: str = "config.json", root: dict | None = None
    ) -> str:
        payload = {**(root or {}), "preprocess": {"enabled": True, **block}}
        path = tmp_path / name
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return str(path)

    return _write


def _run(*args):
    return runner.invoke(cli, list(args))


def test_runs_actions_in_listed_order(tmp_path, data_csv, write_config):
    """同一欄位排兩個動作：先去空白再左截三字，結果要看得出是照順序做的。"""
    cfg = write_config(
        {
            "columns": [
                {
                    "column": "地址",
                    "actions": [
                        {"action": "trim", "params": {"mode": "edges"}},
                        {"action": "slice", "params": {"side": "left", "count": 3}},
                    ],
                },
                {
                    "column": "年齡",
                    "actions": [{"action": "cast", "params": {"type": "int"}}],
                },
            ]
        }
    )
    out = tmp_path / "out.csv"
    result = _run("preprocess", "-i", data_csv, "-c", cfg, "-o", str(out))

    assert result.exit_code == 0
    df_out = pd.read_csv(out)
    # 先 trim 掉頭尾空白才截，故「台北市」三字被刪去而非空白被當成字元刪掉
    assert list(df_out["地址"]) == ["大安區", "板橋區", "西屯區"]
    assert list(df_out["年齡"]) == [25, 31, 48]


def test_output_keeps_input_format(tmp_path, write_config):
    """結果沿用輸入格式輸出（同 K-匿名／DP）：JSON 進來就是 JSON 出去。"""
    src = tmp_path / "data.json"
    pd.DataFrame({"地址": [" 台北 "]}).to_json(
        src, orient="records", force_ascii=False
    )
    cfg = write_config(
        {
            "columns": [
                {"column": "地址", "actions": [{"action": "trim", "params": {"mode": "all"}}]}
            ]
        }
    )
    out = tmp_path / "out.json"
    result = _run("preprocess", "-i", str(src), "-c", cfg, "-o", str(out))

    assert result.exit_code == 0
    assert list(pd.read_json(out)["地址"]) == ["台北"]


def test_column_not_found_exits_with_unprocessable_code(
    tmp_path, data_csv, write_config
):
    """欄位名稱打錯＝設定檔對不上資料，與 API 的 422 同一格，且在動到資料之前就擋。"""
    cfg = write_config(
        {
            "columns": [
                {"column": "沒有這欄", "actions": [{"action": "trim", "params": {"mode": "all"}}]}
            ]
        }
    )
    out = tmp_path / "out.csv"
    result = _run("preprocess", "-i", data_csv, "-c", cfg, "-o", str(out))

    assert result.exit_code == HTTP_STATUS_EXIT_CODE[422]
    assert "ERR_PREPROCESS_COLUMN_NOT_FOUND" in result.output
    assert not out.exists()


def test_unknown_action_exits_with_bad_request_code(tmp_path, data_csv, write_config):
    """功能名稱不認得＝請求本身不成立，對應 API 的 400。"""
    cfg = write_config(
        {"columns": [{"column": "地址", "actions": [{"action": "沒這功能", "params": {}}]}]}
    )
    result = _run(
        "preprocess", "-i", data_csv, "-c", cfg, "-o", str(tmp_path / "out.csv")
    )

    assert result.exit_code == HTTP_STATUS_EXIT_CODE[400]
    assert "ERR_PREPROCESS_ACTION_UNKNOWN" in result.output


def test_bad_param_exits_with_bad_request_code(tmp_path, data_csv, write_config):
    """參數不合法（slice 刪 0 個字＝跑完等於沒跑）一樣在動到資料之前擋下。"""
    cfg = write_config(
        {
            "columns": [
                {
                    "column": "地址",
                    "actions": [
                        {"action": "slice", "params": {"side": "left", "count": 0}}
                    ],
                }
            ]
        }
    )
    result = _run(
        "preprocess", "-i", data_csv, "-c", cfg, "-o", str(tmp_path / "out.csv")
    )

    assert result.exit_code == HTTP_STATUS_EXIT_CODE[400]
    assert "ERR_PREPROCESS_PARAM_INVALID" in result.output


def test_type_mismatch_exits_with_unprocessable_code(tmp_path, data_csv, write_config):
    """對字串欄用平均值填補＝規格明示要報錯的那一種，對應 API 的 422。"""
    cfg = write_config(
        {
            "columns": [
                {"column": "地址", "actions": [{"action": "impute", "params": {"strategy": "mean"}}]}
            ]
        }
    )
    result = _run(
        "preprocess", "-i", data_csv, "-c", cfg, "-o", str(tmp_path / "out.csv")
    )

    assert result.exit_code == HTTP_STATUS_EXIT_CODE[422]
    assert "ERR_PREPROCESS_TYPE_MISMATCH" in result.output


def test_missing_config_file_exits_with_param_code(tmp_path, data_csv):
    """設定檔路徑給錯，與其他指令走同一個判斷與同一個離開代碼。"""
    result = _run(
        "preprocess", "-i", data_csv, "-c", str(tmp_path / "nope.json"),
        "-o", str(tmp_path / "out.csv"),
    )

    assert result.exit_code == HTTP_STATUS_EXIT_CODE[400]
    assert "ERR_INVALID_PARAM" in result.output


def test_empty_column_list_exits_with_config_invalid(tmp_path, data_csv, write_config):
    """清單空的＝這次處理沒有任何內容，於解析設定檔時即擋下。"""
    result = _run(
        "preprocess", "-i", data_csv, "-c", write_config({"columns": []}),
        "-o", str(tmp_path / "out.csv"),
    )

    assert result.exit_code != 0
    assert "ERR_CONFIG_INVALID" in result.output


def test_declared_input_format_is_used(tmp_path, write_config):
    """設定檔根層宣告 input_format 時以它為準（供沒有副檔名的檔案使用），並告知覆蓋。"""
    src = tmp_path / "data_no_ext"
    pd.DataFrame({"地址": [" 台北 "]}).to_csv(src, index=False, encoding="utf-8")
    cfg = write_config(
        {
            "columns": [
                {"column": "地址", "actions": [{"action": "trim", "params": {"mode": "all"}}]}
            ]
        },
        root={"input_format": "csv"},
    )
    out = tmp_path / "out.csv"
    result = _run("preprocess", "-i", str(src), "-c", cfg, "-o", str(out))

    assert result.exit_code == 0
    assert list(pd.read_csv(out)["地址"]) == ["台北"]
