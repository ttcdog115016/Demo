"""前處理引擎的值物件。

逐欄逐項的設定（PreprocessConfig／PreprocessColumn／PreprocessActionSpec）住在
app.core.config，比照 K-匿名的 ColumnConfig 與 DP 的 DPColumnConfig——設定檔是
「進引擎前」的東西，API／CLI／引擎共用，故歸 core；本模組只留引擎自己的值物件。
"""

from dataclasses import dataclass

from .actions.base import PreprocessAction


@dataclass
class PlannedAction:
    """排定好的一次動作：對哪一欄、做什麼、出事時怎麼指路。

    設定檔是「欄位 → 一串動作」的巢狀形狀，執行時卻是單純的由上往下一條龍；
    工廠先把巢狀攤平成這種一維的步驟，流程就不必再處理兩層迴圈與位置計算。

    where：報錯時附上的位置說明（第幾列、哪個欄位、第幾個動作）。清單有序而不編號，
           故以陣列位置指路，訊息裡的序號一律由 1 起算，與使用者數的一樣。
    """

    column: str
    where: str
    action: PreprocessAction


@dataclass(frozen=True)
class BuildContext:
    """組裝整份清單時建立一次的共用值，交給宣告 needs_context 的動作。

    timestamp_salt：雜湊的 use_timestamp 用的鹽。時間戳若由各動作自己取會不一樣——
    A 欄整份跑完才輪到 B 欄，20 萬筆可能差好幾秒，同一種識別碼的兩欄就對不起來，
    故整份清單開跑前取一次、所有欄位共用。

    default_salt：設定檔沒指定鹽時退而求其次要用的 .env 鹽值（未設定則為 None，
    代表這次不加鹽）。同樣在開跑前讀一次，不由各動作各讀各的。

    algorithm：雜湊演算法名稱，整份清單的預設（設定檔的區塊層參數）；
    ★ TTC 2026-11-04：hash 動作的 params 有給 algorithm 時以動作的為準。
    """

    timestamp_salt: str
    default_salt: str | None = None
    algorithm: str = "sha3-256"
