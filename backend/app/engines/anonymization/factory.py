"""分派表：型別 → Generalizer、抑制方式 → Suppressor。

要新增/替換演算法，只需在此登記一個 class，pipeline 不需改動（避免型別 if/elif 分支）。
"""

from .strategies.generalize import (
    NumericalGeneralizer,
    DatetimeGeneralizer,
    CategoricalGeneralizer,
    StringGeneralizer,
)
from .strategies.masking import FullMask, PartialMask, HashMask
from .suppression import RowSuppressor, CellSuppressor
from .validation import ConfigValidator
from .metrics import KAnonymity, LDiversity, TCloseness
from .pipeline import Anonymizer

# 欄位型別 → 泛化策略
GENERALIZER_BY_TYPE = {
    "numeric": NumericalGeneralizer(),
    "temporal": DatetimeGeneralizer(),
    "categorical": CategoricalGeneralizer(),
    "string": StringGeneralizer(),
}


# 遮蔽策略 → 依欄位設定/鹽值/演算法建構對應的 Mask。
# 遮蔽類需要「逐欄參數」（mask_char/keep_chars/salt），故存「建構函式」而非預建實例。
# 要新增遮蔽策略（規格 2.1(3)A：全遮蔽/部分遮蔽/固定字元/哈希）只需在此登記一行，pipeline 不動。
# 演算法是整份設定共用的區塊層參數（不逐欄），故與 salt_key 一樣由 pipeline 一併傳入，
# 簽章三者一致：用不到的建構函式照樣收下不用。
def _build_full_mask(info, salt_key, algorithm):
    # 全遮蔽；mask_char 自訂即為「固定字元」遮蔽（規格兩者同機制、差在字元）
    # mask_length 未設＝輸出長度等於原值長度
    return FullMask(info.mask_char or "*", info.mask_length)


def _build_partial_mask(info, salt_key, algorithm):
    # 部分遮蔽保留 prefix/suffix N 字元；mask_mode 非 suffix 一律當 prefix
    mode = info.mask_mode if info.mask_mode == "suffix" else "prefix"
    return PartialMask(keep_chars=info.keep_chars, mode=mode, mask_char=info.mask_char or "*")


def _build_hash_mask(info, salt_key, algorithm):
    return HashMask(salt_key, algorithm)


MASKER_BUILDER_BY_STRATEGY = {
    "mask": _build_full_mask,       # 全遮蔽 / 固定字元
    "partial": _build_partial_mask,  # 部分遮蔽
    "hash": _build_hash_mask,        # 哈希（假名化）
}

# 抑制方式 → 依填充設定建構對應的 Suppressor。
# 比照遮蔽策略存「建構函式」而非預建實例：值抑制需要 cell_fill（全域填法）與
# column_values（設定檔逐欄指定的填入值）這兩個逐次參數，列抑制不需要、
# 簽章一致故一律收下不用。
# 合法值於 Anonymizer 建構時驗證（validate_choice_param），非法值直接拋錯。
SUPPRESSOR_BUILDER_BY_METHOD = {
    "row_suppression": lambda cell_fill, column_values: RowSuppressor(),
    "cell_suppression": lambda cell_fill, column_values: CellSuppressor(
        cell_fill, column_values
    ),
}


class AnonymizerFactory:
    """組裝並注入所有工人，產出一個接好依賴的 Anonymizer。

    本類別是工人的唯一建立處：Anonymizer 不自備預設，缺任何一個都會直接報錯。
    """

    @staticmethod
    def create(
        config,
        k: int = 5,
        l: int | None = None,  # noqa: E741
        t: float | None = None,
        suppression_limit_percent: float = 20,
        limit_exceeded_action: str = "stop_and_error",
        salt_key: str | None = None,
        suppression_method: str = "row_suppression",
        cell_fill: str = "star",
        k_qi_subset: list | None = None,
    ):
        return Anonymizer(
            config,
            k=k,
            l=l,
            t=t,
            suppression_limit_percent=suppression_limit_percent,
            limit_exceeded_action=limit_exceeded_action,
            salt_key=salt_key,
            suppression_method=suppression_method,
            cell_fill=cell_fill,
            k_qi_subset=k_qi_subset,
            # ── 把工人組好、注入 ──
            validator=ConfigValidator(),
            generalizers=GENERALIZER_BY_TYPE,
            suppressors=SUPPRESSOR_BUILDER_BY_METHOD,
            masker_builders=MASKER_BUILDER_BY_STRATEGY,
            k_metric=KAnonymity(),
            l_metric=LDiversity(),
            t_metric=TCloseness(),
        )
