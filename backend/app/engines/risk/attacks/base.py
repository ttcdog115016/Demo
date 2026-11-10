"""攻擊策略介面。

三種攻擊（指認性／連結性／推斷性）共用同一回傳契約：
    (S_ori, S_ctrl, S_base) ＝ (主要攻擊成功率, 控制攻擊成功率, 基準攻擊成功率)
規格的風險公式 max(0, (S_ori − max(S_ctrl, S_base)) / (1 − max(S_ctrl, S_base)))
由 AttackAssessor 統一套用，攻擊本身不需要知道公式。

各攻擊所需的額外參數不同（n_iter／n_subset／sensitive_col），故介面只約定
回傳契約、不強制同一簽名；工人皆無狀態，參數於呼叫時傳入。
"""
from abc import ABC, abstractmethod
from collections.abc import Sequence

import pandas as pd
from sklearn.preprocessing import LabelEncoder


# 缺值在編碼時的代表字：缺值自成一類，與任何實際值都不相同。
# 不能只靠 astype(str)——pandas 3 轉字串時缺值仍是缺值，不會變成 "nan"。
_MISSING_LABEL = "\x00缺值"


def as_labels(series: pd.Series) -> pd.Series:
    """把一欄轉成可編碼的文字標籤，缺值一律換成同一個代表字（自成一類）。"""
    return series.astype(str).where(series.notna(), _MISSING_LABEL)


def fit_shared_label_encoders(
    cols: list[str], frames: Sequence[pd.DataFrame]
) -> dict[str, LabelEncoder]:
    """對每個欄位以所有資料集值域的聯集共同 fit 一個 LabelEncoder。

    syn／ori／ctrl 必須共用同一編碼空間：各自 fit 會讓不同值（如「台北」與
    「台中」）在不同資料集裡編到同一個數字，距離比對與模型評分全數失真。
    fit 涵蓋全部資料集，transform 不會遇到未見值。
    """
    encoders: dict[str, LabelEncoder] = {}
    for col in cols:
        vals = pd.concat([as_labels(f[col]) for f in frames])
        encoders[col] = LabelEncoder().fit(vals)
    return encoders


class AttackStrategy(ABC):
    """再識別攻擊基底：對 (syn, ori, ctrl) 模擬攻擊，回傳三種攻擊成功率。"""

    @abstractmethod
    def run(
        self,
        syn: pd.DataFrame,
        ori: pd.DataFrame,
        ctrl: pd.DataFrame,
        *args,
        **kwargs,
    ) -> tuple[float, float, float]:  # pragma: no cover - 介面
        ...
