"""動態資料分割（RepeatedSplitter）。

規格：依系統預設或使用者自訂比例（預設 20% 控制組／80% 原始）自動劃分資料集，
並支援多次重複實驗（交叉驗證次數＋跨次數抽樣重疊比例）→平均風險分數。
攻擊策略只吃分好的 (ori, ctrl)，不需要知道分割怎麼來。

單輪只是多輪的特例（n_repeats=1），統一走同一套邏輯。

重疊比例語意：
  - overlap_ratio 定義在 ctrl（0~1 全值域可實現；ori 佔 80% 天生重疊 ≥75% 無法獨立控制），
    控制「本輪 vs 前一輪」（鏈式）ctrl 樣本的重疊比例；對更早輪次的重疊隨距離自然衰減。
  - 抽新血優先取「當過 ctrl 次數最少的人」，全員輪過才回收 →
    overlap=0＋ctrl_ratio=0.2＋5 輪＝經典 5-fold 交叉驗證（對齊規格「交叉驗證」用詞）。
"""
from collections.abc import Iterator

import numpy as np
import pandas as pd

from app.core.errors import PetsError


class RepeatedSplitter:
    """多輪 ori/ctrl 切分：逐輪產生 (ori, ctrl)，供重複實驗取平均。

    seed 預設 42（固定可重現；使用者可於設定檔指定 seed 覆蓋）。
    """

    def __init__(
        self,
        ctrl_ratio: float = 0.2,
        overlap_ratio: float = 0.0,
        seed: int | None = 42,
    ) -> None:
        # 純參數檢查前置在建構時擋；需比對資料的可行性檢查在 splits() 入口擋
        if not 0.0 < ctrl_ratio < 1.0:
            raise PetsError(
                "ERR_INVALID_PARAM",
                f"ctrl_ratio 須大於 0 且小於 1，收到 {ctrl_ratio}。",
            )
        if not 0.0 <= overlap_ratio <= 1.0:
            raise PetsError(
                "ERR_INVALID_PARAM",
                f"overlap_ratio 須介於 0 與 1 之間（含兩端），收到 {overlap_ratio}。",
            )
        self.ctrl_ratio = ctrl_ratio
        self.overlap_ratio = overlap_ratio
        self.seed = seed

    def splits(
        self, df: pd.DataFrame, n_repeats: int = 1
    ) -> Iterator[tuple[pd.DataFrame, pd.DataFrame]]:
        """逐輪產出 (ori, ctrl)。驗證前置於呼叫當下；逐輪部分以 generator 實作，
        輪內資料用完即釋放，不整批留存。"""
        if n_repeats < 1:
            raise PetsError(
                "ERR_INVALID_PARAM", f"n_repeats 須為正整數，收到 {n_repeats}。"
            )
        n = len(df)
        ctrl_size = int(round(n * self.ctrl_ratio))
        if ctrl_size < 1 or ctrl_size >= n:
            raise PetsError(
                "ERR_SPLIT_INFEASIBLE",
                f"資料 {n} 筆依 ctrl_ratio={self.ctrl_ratio} 切出的控制組為 "
                f"{ctrl_size} 筆，無法構成有效的 ori／ctrl 分割。",
            )
        keep_n = int(round(ctrl_size * self.overlap_ratio))
        # 新血只能從「非前一輪 ctrl」抽（否則重疊會超過設定值）；池子不夠大＝設定不可行
        if ctrl_size - keep_n > n - ctrl_size:
            raise PetsError(
                "ERR_SPLIT_INFEASIBLE",
                f"overlap_ratio={self.overlap_ratio} 每輪需要 {ctrl_size - keep_n} 筆新血，"
                f"但前一輪 ctrl 之外只剩 {n - ctrl_size} 筆；"
                "請調高 overlap_ratio 或調低 ctrl_ratio。",
            )
        return self._iter_splits(df, n_repeats, ctrl_size, keep_n)

    def _iter_splits(
        self, df: pd.DataFrame, n_repeats: int, ctrl_size: int, keep_n: int
    ) -> Iterator[tuple[pd.DataFrame, pd.DataFrame]]:
        rng = np.random.default_rng(self.seed)
        usage = pd.Series(0, index=df.index)  # 各筆資料當過 ctrl 的次數
        prev_ctrl: pd.Index | None = None
        for _ in range(n_repeats):
            if prev_ctrl is None:
                ctrl_idx = self._pick(df.index, ctrl_size, usage, rng)
            else:
                kept = rng.choice(prev_ctrl.to_numpy(), size=keep_n, replace=False)
                pool = df.index.difference(prev_ctrl)
                fresh = self._pick(pool, ctrl_size - keep_n, usage, rng)
                ctrl_idx = pd.Index(np.concatenate([kept, fresh]))
            usage.loc[ctrl_idx] += 1
            prev_ctrl = ctrl_idx
            yield df.drop(index=ctrl_idx), df.loc[ctrl_idx]

    @staticmethod
    def _pick(
        pool: pd.Index, k: int, usage: pd.Series, rng: np.random.Generator
    ) -> pd.Index:
        """從 pool 抽 k 筆：當過 ctrl 次數少者優先，同次數層內隨機。"""
        chosen: list = []
        pool_usage = usage.loc[pool]
        for level in sorted(pool_usage.unique()):
            tier = pool_usage.index[pool_usage == level].to_numpy()
            take = min(k - len(chosen), len(tier))
            chosen.extend(rng.choice(tier, size=take, replace=False))
            if len(chosen) == k:
                break
        return pd.Index(chosen)
