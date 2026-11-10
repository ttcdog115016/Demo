"""推斷性攻擊（Inference）。

問題：攻擊者知道某人的 QI，能不能推出他的敏感值？
手法（規格逐條）：以 syn 為訓練集（X=QI 特徵、Y=敏感欄）訓練 Random Forest →
套用於 ori 預測，與真實值完全相等即主要攻擊成功；ctrl 相同預測為控制攻擊；
基準攻擊＝天真模型（類別型輸出眾數、數值型輸出中位數）。
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

from app.core.cancellation import check_cancelled

from .base import AttackStrategy, as_labels, fit_shared_label_encoders


class InferenceAttack(AttackStrategy):
    """推斷性攻擊模擬（無狀態）。"""

    def run(
        self,
        syn: pd.DataFrame,
        ori: pd.DataFrame,
        ctrl: pd.DataFrame,
        qi_cols: list[str],
        sensitive_col: str,
        rng: np.random.Generator | None = None,
    ) -> tuple[float, float, float]:
        if len(syn) == 0 or len(ori) == 0 or len(ctrl) == 0:
            return 0.0, 0.0, 0.0

        # 預處理特徵：每欄的編碼方式一次定案、三份資料共用——
        # 三者皆為數值型才走數值分支，否則以共同 fit 的 LabelEncoder 統一編碼，
        # 確保模型訓練與評分建立在同一特徵空間上
        frames = (syn, ori, ctrl)
        numeric_cols = {
            col
            for col in qi_cols
            if all(pd.api.types.is_numeric_dtype(f[col]) for f in frames)
        }
        encoders = fit_shared_label_encoders(
            [c for c in qi_cols if c not in numeric_cols], frames
        )

        # 數值欄缺值以「值域外哨兵」填補：對三份資料聯集取該欄最小值再減 1，
        # 三份共用同一哨兵。不填 0 是因為 0 常是合法值（如年收入 0），
        # 會讓缺值與真實 0 混為一類；哨兵落在所有真實值之下，樹模型可將缺值獨立切出
        # 一支、不污染特徵。整欄皆缺時無最小值可算，退回 0.0（該欄已無資訊，僅為可執行）。
        numeric_fill = {}
        for col in numeric_cols:
            col_min = pd.concat([f[col] for f in frames]).min()
            numeric_fill[col] = (col_min - 1.0) if pd.notna(col_min) else 0.0

        def prepare_data(df_in: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
            X = pd.DataFrame()
            for col in qi_cols:
                if col in numeric_cols:
                    # 一律以位置語意填入，避免抽樣後的索引在欄位間錯位對齊
                    X[col] = df_in[col].fillna(numeric_fill[col]).to_numpy()
                else:
                    X[col] = encoders[col].transform(as_labels(df_in[col]))
            # 敏感欄的缺值同樣自成一類，否則分類模型拿到空的目標值會直接拒絕訓練
            y = as_labels(df_in[sensitive_col])
            return X, y

        X_train, y_train = prepare_data(syn)
        X_ori, y_ori = prepare_data(ori)
        X_ctrl, y_ctrl = prepare_data(ctrl)

        # 訓練隨機森林（樹的隨機性由請求級亂數源衍生；未傳入時固定用 42）
        rf_seed = int(rng.integers(2**32)) if rng is not None else 42
        clf = RandomForestClassifier(
            n_estimators=50, max_depth=10, random_state=rf_seed, n_jobs=-1
        )
        check_cancelled()  # ★ TTC 2026-10-31：fit 本身無法中途打斷，前後各查一次
        clf.fit(X_train, y_train)
        check_cancelled()

        # 主要攻擊成功率
        s_ori = clf.score(X_ori, y_ori)

        # 控制攻擊成功率
        s_ctrl = clf.score(X_ctrl, y_ctrl)

        # 基準攻擊：天真預測模型（規格 §3(1)iii）——
        # 敏感欄類別型→永遠輸出 syn 欄位眾數；數值型→永遠輸出 syn 欄位中位數。
        # 「配對成功機率」對齊主要攻擊之「完全相等」語意：天真輸出恰等於 ori 真實值才算命中。
        # 註：連續型數值敏感欄的中位數幾乎不會與任何真實值完全相等，s_base 會趨近 0，
        # 此為規格「完全相等」設計對連續值的先天結果（主／控攻擊亦同），非本分支缺陷。
        if pd.api.types.is_numeric_dtype(syn[sensitive_col]) and pd.api.types.is_numeric_dtype(
            ori[sensitive_col]
        ):
            median_val = syn[sensitive_col].median()
            s_base = (ori[sensitive_col] == median_val).mean() if pd.notna(median_val) else 0.0
        else:
            mode_series = y_train.mode()
            mode_val = mode_series.iloc[0] if not mode_series.empty else "*"
            s_base = (y_ori == mode_val).mean()

        return float(s_ori), float(s_ctrl), float(s_base)
