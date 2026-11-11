"""登記表與組裝：功能名稱 → 動作類別，並把設定檔攤平成排定好的步驟。

要新增一個前處理功能，只需寫好動作類別、在 ACTION_BY_NAME 加一行，流程不必改動
（比照 K-匿名的 AnonymizerFactory 與 DP 的 DPProcessorFactory）。
"""

from datetime import UTC, datetime

from app.core.config import PreprocessConfig
from app.core.errors import PetsError
from app.core.settings import get_default_salt
from app.engines.anonymization.strategies.masking import validate_hash_algorithm

from .actions.base import PreprocessAction
from .actions.casting import Cast
from .actions.masking import Hash, RegexReplace
from .actions.missing import DropNulls, FillDefault, Impute
from .actions.numeric import Clamp
from .actions.strings import AnchorTruncate, Normalize, Slice, Trim
from .pipeline import Preprocessor
from .types import BuildContext, PlannedAction
from .validation import PreprocessValidator

# 功能名稱 → 動作類別。名稱即設定檔裡寫的 action，順序同規格書列的 11 項。
ACTION_BY_NAME: dict[str, type[PreprocessAction]] = {
    "trim": Trim,
    "slice": Slice,
    "anchor_truncate": AnchorTruncate,
    "cast": Cast,
    "normalize": Normalize,
    "drop_nulls": DropNulls,
    "fill_default": FillDefault,
    "impute": Impute,
    "clamp": Clamp,
    "hash": Hash,
    "regex_replace": RegexReplace,
}


def build_actions(config: PreprocessConfig) -> list[PlannedAction]:
    """把設定檔攤平成一串排定好的步驟，過程中把每個動作的參數驗完。

    在此建構的用意是「擋的檢查要前置」：參數寫錯、功能名稱打錯，都在還沒動到任何
    資料時就報錯，不會出現前半份清單已經改過、後半份才失敗的情況。
    """
    # 共用值在此取一次：時間戳當鹽時，整份清單的所有欄位要拿到同一個值；
    # .env 的預設鹽同理，逐個動作各讀一次沒有意義。
    context = BuildContext(
        timestamp_salt=datetime.now(UTC).isoformat(),
        default_salt=get_default_salt(),
        # 演算法名稱在此驗一次（fail fast）：它是整份清單共用的設定，不屬於任何一個
        # 動作，於此報錯才不會被冠上「第幾列第幾個動作」這種指錯地方的位置說明。
        algorithm=validate_hash_algorithm(config.algorithm),
    )
    plan: list[PlannedAction] = []
    for idx, entry in enumerate(config.columns):
        for pos, spec in enumerate(entry.actions):
            where = (
                f"前處理清單第 {idx + 1} 列（欄位 '{entry.column}'）"
                f"的第 {pos + 1} 個動作"
            )
            action_cls = ACTION_BY_NAME.get(spec.action)
            if action_cls is None:
                raise PetsError(
                    "ERR_PREPROCESS_ACTION_UNKNOWN",
                    f"{where} '{spec.action}' 不是認得的功能名稱；"
                    f"可用的功能為 {sorted(ACTION_BY_NAME)}。",
                )
            try:
                action = (
                    action_cls(spec.params, context)
                    if action_cls.needs_context
                    else action_cls(spec.params)
                )
            except PetsError as exc:
                # 動作自己只知道是哪個功能出問題，補上它在清單裡的位置才找得到要改哪一行。
                raise PetsError(exc.error_code, f"{where}：{exc.message}") from exc
            plan.append(PlannedAction(column=entry.column, where=where, action=action))
    return plan


class PreprocessorFactory:
    """組裝 Preprocessor：驗證器與排定好的步驟一律由此建立並注入。"""

    @staticmethod
    def create(config: PreprocessConfig) -> Preprocessor:
        return Preprocessor(
            config,
            validator=PreprocessValidator(),
            plan=build_actions(config),
        )
