"""達標檢測（k / l / t）。

邏輯放在 KAnonymity / LDiversity / TCloseness 類別（OOP 主體，演算法可個別替換）。
"""

import numpy as np
import pandas as pd


def wildcard_group_sizes(keys: pd.DataFrame) -> pd.Series:
    """每一列的等價類大小，空值（NaN）視為萬用字元。

    空值代表「這一格可能是任何值」，故兩列在每個 QI 欄上「值相同，或其中一方為空」即
    視為相容；一列的等價類大小＝與它相容的列數（含自己）。一列可同時計入多個組，
    各列大小加總可能大於總列數。例外：
      - QI 全為空的列與每一列都相容，大小＝總列數；
      - QI 多於一欄時，不含空值的列不計入 QI 全為空的列（只含一欄時照常計入）。

    依「哪幾欄為空」的組合分批計算：每一種組合對每一種組合做一次分組加總，
    組合數至多 2^QI 欄數，不需逐列兩兩比對。
    """
    cols = list(keys.columns)
    n = len(keys)
    if n == 0 or not cols:
        return pd.Series(np.zeros(n, dtype=np.int64), index=keys.index)
    gid = keys.groupby(cols, sort=False, dropna=False).ngroup().to_numpy()
    na = keys.isna().to_numpy()
    if not na.any():
        return pd.Series(np.bincount(gid)[gid], index=keys.index)

    # 每個相異鍵的列數、代表列與空值位置（位元為 1＝該欄為空）
    group_n = np.bincount(gid)
    _, first = np.unique(gid, return_index=True)
    uniq = keys.iloc[first].reset_index(drop=True)
    pattern = (na[first] * (1 << np.arange(len(cols)))).sum(axis=1)
    all_na = (1 << len(cols)) - 1

    sizes = np.zeros(len(uniq), dtype=np.int64)
    patterns = np.unique(pattern)
    for pi in patterns:
        tgt = np.flatnonzero(pattern == pi)
        if pi == all_na:
            sizes[tgt] = n
            continue
        for pj in patterns:
            if len(cols) > 1 and pi == 0 and pj == all_na:
                continue
            src = np.flatnonzero(pattern == pj)
            # 兩邊都有值的欄位才需要比對；其餘欄位至少一方為空，必相容
            shared = [c for b, c in enumerate(cols) if not (pi | pj) >> b & 1]
            if not shared:
                sizes[tgt] += int(group_n[src].sum())
                continue
            added = (
                uniq.iloc[src][shared]
                .assign(_n=group_n[src])
                .groupby(shared, sort=False)["_n"]
                .sum()
            )
            matched = uniq.iloc[tgt][shared].merge(
                added.reset_index(), on=shared, how="left"
            )["_n"]
            sizes[tgt] += matched.fillna(0).to_numpy(dtype=np.int64)
    return pd.Series(sizes[gid], index=keys.index)


class KAnonymity:
    """k-匿名達標檢測：每個等價類列數須 >= k。

    QI 的空值視為萬用字元（見 wildcard_group_sizes）。值抑制挖掉的格子不論填了什麼，
    都以 suppressed 標出、一律當成空值計算。
    """

    def check(
        self,
        df: pd.DataFrame,
        qi_cols: list[str],
        k: int,
        suppressed: pd.DataFrame | None = None,
    ) -> tuple[bool, pd.Series]:
        if len(df) == 0 or not qi_cols:
            return True, pd.Series(dtype=int)
        keys = df[qi_cols]
        if suppressed is not None:
            keys = keys.mask(suppressed.reindex(index=df.index, columns=qi_cols, fill_value=False))
        counts = wildcard_group_sizes(keys)
        is_valid = (counts >= k).all()
        return bool(is_valid), counts


class LDiversity:
    """l-多樣性（distinct）達標檢測：每個等價類內不重複敏感值數須 >= l。"""

    def check(
        self, df: pd.DataFrame, qi_cols: list[str], sensitive_col: str, l: int  # noqa: E741
    ) -> tuple[bool, list[str]]:
        if len(df) == 0:
            return True, []
        groups = df.groupby(qi_cols, dropna=False)
        failures = []
        for name, group in groups:
            unique_vals = group[sensitive_col].dropna().unique()
            if len(unique_vals) < l:
                failures.append(
                    f"等價類 {name} 的多樣性不足：僅有 {len(unique_vals)} 種敏感值，要求 {l}。"
                )
        return len(failures) == 0, failures


class TCloseness:
    """t-相近性達標檢測：每個等價類敏感分佈與全域分佈的總變差距離須 <= t。"""

    def check(
        self,
        df: pd.DataFrame,
        qi_cols: list[str],
        sensitive_col: str,
        t: float,
        global_distribution: pd.Series,
    ) -> tuple[bool, list[str]]:
        if len(df) == 0:
            return True, []
        groups = df.groupby(qi_cols, dropna=False)
        failures = []
        for name, group in groups:
            group_counts = group[sensitive_col].value_counts(normalize=True)
            # 對齊全域分佈索引，缺少的類別補 0
            group_dist = global_distribution.copy()
            for val in group_dist.index:
                group_dist[val] = group_counts.get(val, 0.0)
            dist = 0.5 * np.sum(np.abs(group_dist - global_distribution))
            if dist > t:
                failures.append(
                    f"等價類 {name} 的敏感分佈與全域距離過大：{dist:.3f}，要求 <= {t}。"
                )
        return len(failures) == 0, failures
