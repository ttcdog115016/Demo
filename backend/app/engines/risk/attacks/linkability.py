"""連結性攻擊（Linkability）。

問題：攻擊者手上有兩份分開外洩的資料（各含一半特徵），能不能用 syn 當橋樑
把它們接回同一個人？
手法（規格逐條）：QI 切成子集 A 與 B → 對每筆，以 KNN 在 syn 中各找 A、B 的
最近鄰 → 兩邊指向 syn 同一筆即主要攻擊成功；ctrl 做相同橋接為控制攻擊。
基準攻擊＝隨機抽兩次 n 筆 syn 列號、計算兩邊剛好指到同一列的比例，即規格
「隨機抽取兩次 n 筆 index 並計算配對成功機率」之實際模擬（無資訊亂猜的底線）。
"""

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors

from .base import AttackStrategy, as_labels, fit_shared_label_encoders


class LinkabilityAttack(AttackStrategy):
    """連結性攻擊模擬（無狀態）。"""

    def run(
        self,
        syn: pd.DataFrame,
        ori: pd.DataFrame,
        ctrl: pd.DataFrame,
        qi_cols: list[str],
        n_subset: int = 500,
        rng: np.random.Generator | None = None,
        cols_A: list[str] | None = None,
        cols_B: list[str] | None = None,
    ) -> tuple[float, float, float, int]:
        # 回傳第 4 值＝實際評估筆數 n_sample（供報告如實揭露「跑了幾筆」）。
        # 特徵子集 A 與 B：使用者自訂優先，否則對 QI 池位置對半（前半 A、後半 B，奇數多的歸 B）。
        # 自訂 A/B 的成對／互斥／存在性已於引擎入口 RiskInputValidator 前置驗證。
        if cols_A is not None and cols_B is not None:
            cols_A, cols_B = list(cols_A), list(cols_B)
        else:
            # 預設對半至少需要 2 個 QI 才切得出兩個非空子集
            if len(qi_cols) < 2:
                return 0.0, 0.0, 0.0, 0
            mid = len(qi_cols) // 2
            cols_A = qi_cols[:mid]
            cols_B = qi_cols[mid:]

        n_sample = min(n_subset, len(ori), len(ctrl), len(syn))
        if n_sample <= 0:
            return 0.0, 0.0, 0.0, 0

        # 抽樣 OriA, OriB, CtrlA, CtrlB（請求級亂數源；未傳入時固定用 42）
        state = rng if rng is not None else 42
        ori_sample = ori.sample(n=n_sample, random_state=state)
        ctrl_sample = ctrl.sample(n=n_sample, random_state=state)

        # 轉為數值型矩陣以便計算距離；編碼器以 syn/ori/ctrl 三者值域共同 fit，
        # 確保同一值在三份資料編成同一數字。fit 範圍＝實際用到的 A∪B（含自訂欄位），
        # 而非僅 qi_cols——否則自訂 A/B 引用非 QI 欄位時會查無編碼器。
        ab_cols = list(dict.fromkeys(cols_A + cols_B))
        encoders = fit_shared_label_encoders(ab_cols, (syn, ori_sample, ctrl_sample))

        def encode_and_fill(df_sub: pd.DataFrame, cols: list[str]) -> np.ndarray:
            arr = np.zeros((len(df_sub), len(cols)))
            for idx, col in enumerate(cols):
                arr[:, idx] = encoders[col].transform(as_labels(df_sub[col]))
            return arr

        # 用 KNN 距離做匹配
        # 主要攻擊：將 OriA 與 OriB 在 syn 中配對
        # 這裡實作一個簡化的鄰近距離配對：如果在 syn 中距離最近的 index 相同，則代表配對成功
        syn_A = encode_and_fill(syn, cols_A)
        syn_B = encode_and_fill(syn, cols_B)

        ori_A = encode_and_fill(ori_sample, cols_A)
        ori_B = encode_and_fill(ori_sample, cols_B)

        ctrl_A = encode_and_fill(ctrl_sample, cols_A)
        ctrl_B = encode_and_fill(ctrl_sample, cols_B)

        # KNN 橋接
        nbrs_A = NearestNeighbors(n_neighbors=1, algorithm="auto").fit(syn_A)
        nbrs_B = NearestNeighbors(n_neighbors=1, algorithm="auto").fit(syn_B)

        # 主要／控制攻擊：一次批次查整批最近鄰。
        # 取每筆最近鄰的 syn 列號，A、B 兩邊指到同一列即配對成功。
        ori_nn_A = nbrs_A.kneighbors(ori_A, return_distance=False)[:, 0]
        ori_nn_B = nbrs_B.kneighbors(ori_B, return_distance=False)[:, 0]
        s_ori = int(np.sum(ori_nn_A == ori_nn_B))

        ctrl_nn_A = nbrs_A.kneighbors(ctrl_A, return_distance=False)[:, 0]
        ctrl_nn_B = nbrs_B.kneighbors(ctrl_B, return_distance=False)[:, 0]
        s_ctrl = int(np.sum(ctrl_nn_A == ctrl_nn_B))

        # 基準攻擊：隨機抽兩次 n 筆 syn 列號，計算兩邊剛好指到同一列的比例＝規格
        # 「隨機抽取兩次 n 筆 index 並計算配對成功機率」之實際模擬（最近鄰在整份 syn
        # 中找，故亂猜的列號範圍＝0 ~ len(syn)-1）。沿用請求級亂數源，未傳入時退回
        # 固定 42、與上方抽樣一致。
        gen = rng if rng is not None else np.random.default_rng(42)
        rand_A = gen.integers(0, len(syn), size=n_sample)
        rand_B = gen.integers(0, len(syn), size=n_sample)
        s_base = float(np.sum(rand_A == rand_B) / n_sample)

        return s_ori / n_sample, s_ctrl / n_sample, s_base, n_sample
