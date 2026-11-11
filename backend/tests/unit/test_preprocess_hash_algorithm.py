"""
★ TTC 2026-11-04：前處理雜湊可逐欄指定演算法
涵蓋：
  - hash 動作的 params.algorithm 優先於區塊層 algorithm
  - 未給時沿用區塊層（舊設定檔行為不變）
  - 動作層寫錯演算法名稱一律擋
"""
import pandas as pd
import pytest

from app.core.config import PreprocessConfig
from app.core.errors import PetsError
from app.engines.anonymization.strategies.masking import hash_mask
from app.engines.preprocess import run_preprocess


def _hash_entry(column: str, **params) -> dict:
    return {"column": column, "actions": [{"action": "hash", "params": params}]}


def test_each_column_can_use_its_own_algorithm():
    """兩欄各指定不同演算法：輸出長度與內容各依自己的演算法。"""
    df = pd.DataFrame({"A": ["X001"], "B": ["X001"]})
    config = PreprocessConfig(
        columns=[
            _hash_entry("A", salt="s1", algorithm="sha256"),
            _hash_entry("B", salt="s1", algorithm="sha3-512"),
        ],
        algorithm="sha3-256",
    )
    out = run_preprocess(df, config)
    assert out["A"][0] == hash_mask("X001", "s1", "sha256")
    assert out["B"][0] == hash_mask("X001", "s1", "sha3-512")
    assert len(out["A"][0]) == 64 and len(out["B"][0]) == 128


def test_action_without_algorithm_falls_back_to_block_default():
    """動作沒給 algorithm → 用區塊層的值。"""
    df = pd.DataFrame({"A": ["X001"], "B": ["X001"]})
    config = PreprocessConfig(
        columns=[_hash_entry("A", salt="s1"), _hash_entry("B", salt="s1", algorithm="sha256")],
        algorithm="sha3-512",
    )
    out = run_preprocess(df, config)
    assert out["A"][0] == hash_mask("X001", "s1", "sha3-512")
    assert out["B"][0] == hash_mask("X001", "s1", "sha256")


def test_action_algorithm_is_case_insensitive():
    """大小寫變體視為同一演算法（與區塊層一致）。"""
    df = pd.DataFrame({"A": ["X001"]})
    out = run_preprocess(df, PreprocessConfig(columns=[_hash_entry("A", salt="s1", algorithm="SHA256")]))
    assert out["A"][0] == hash_mask("X001", "s1", "sha256")


@pytest.mark.parametrize("bad", ["md5", "", 256])
def test_unknown_action_algorithm_rejected(bad):
    """動作層演算法寫錯、空白或不是字串一律擋，不靜默退回預設。"""
    df = pd.DataFrame({"A": ["X001"]})
    config = PreprocessConfig(columns=[_hash_entry("A", salt="s1", algorithm=bad)])
    with pytest.raises(PetsError) as exc:
        run_preprocess(df, config)
    assert exc.value.error_code in {"ERR_INVALID_PARAM", "ERR_PREPROCESS_PARAM_INVALID"}
