import math
import re
import yaml
import json
import os

import pandas as pd
from dataclasses import dataclass
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.core.errors import PetsError

# 資料檔不見得帶副檔名（前端串接、暫存檔、資料湖匯出都可能沒有），此時副檔名判定
# 無從下手，由使用者在設定檔明講。各設定類別共用這段說明，措辭才不會各處抄寫時走樣。
# 此欄位一律寫在大包設定檔的根層（每種功能都會用到的唯一欄位），由拆袋子時灌進各區塊。
INPUT_FORMAT_DESC = (
    "明確指定輸入格式 csv/json/jsonl/excel（CLI 另可用 sqlite 連線字串）；"
    "未填時依檔名的副檔名判定，供沒有副檔名的檔案使用"
)

# 各設定類別共用：不認識的欄位一律擋，不靜默忽略。
# pydantic 預設是靜默丟掉多餘欄位，連 n_iterr 這種打錯字都吞掉，使用者會以為自己設過了。
_STRICT_FIELDS = ConfigDict(extra="forbid")


def parse_level_value(name: str, val: Any) -> tuple[int, int]:
    """解析泛化層級值，回傳 (min, max)。

    val 可為：
      - 單一整數 → 固定層級（min == max）
      - [min, max] 兩個整數 → 範圍（規格 2.1(2) 最大/最小泛化層級）
    驗證（fail fast）：必須整數（拒絕浮點數與布林）、min >= 0、min <= max。
    """
    if isinstance(val, bool):
        raise ValueError(f"泛化層級 '{name}' 不可為布林值：{val}")
    if isinstance(val, int):
        lo = hi = val
    elif isinstance(val, (list, tuple)):
        if len(val) != 2:
            raise ValueError(
                f"泛化層級 '{name}' 若指定範圍須為 [min, max] 兩個整數，收到：{val}"
            )
        lo, hi = val
    else:
        raise ValueError(
            f"泛化層級 '{name}' 必須是整數（固定層級）或 [min, max] 兩個整數，收到：{val}"
        )
    for v in (lo, hi):
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError(f"泛化層級 '{name}' 必須為整數，不接受浮點數：{val}")
    if lo < 0:
        raise ValueError(f"泛化層級 '{name}' 不可為負數：{val}")
    if lo > hi:
        raise ValueError(f"泛化層級 '{name}' 的 min({lo}) 不可大於 max({hi})。")
    return lo, hi


def _parse_bin_bound(col: str, idx: int, key: str, val: Any, open_allowed: bool) -> float:
    """解析單一區間端點。None 代表開放端（僅首段的 min 與末段的 max 可省略）。"""
    if val is None:
        if not open_allowed:
            raise ValueError(
                f"欄位 '{col}' 的 bins 第 {idx + 1} 段 {key} 不可省略："
                f"只有第一段可以沒有下界、最後一段可以沒有上界。"
            )
        return -math.inf if key == "min" else math.inf
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        raise ValueError(
            f"欄位 '{col}' 的 bins 第 {idx + 1} 段 {key} 必須是數字或不填（開放端），收到：{val}"
        )
    return float(val)


def parse_numeric_bins(col: str, raw: Any) -> list[tuple[float, float, str]]:
    """解析數值自訂區間，回傳 [(下界, 上界, 標籤), ...]；下界含、上界不含。

    使用者逐段寫明「從幾、到幾、叫什麼」，系統不自動產生任何切點或標籤。
    驗證（fail fast，純設定即可判定）：
      - 至少一段，每段須為含 min/max/label 的物件，label 不可空白
      - 同段 min < max；首段可省 min、末段可省 max 表示開放端
      - 段與段須由小到大排列且不重疊（允許中間留空隙，落入空隙的值視同未涵蓋）
    區間重疊之所以擋而非放行，是因為切箱採整欄向量化，重疊會使邊界無法遞增。
    """
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"欄位 '{col}' 的 bins 必須是至少含一段區間的陣列。")
    parsed: list[tuple[float, float, str]] = []
    last = len(raw) - 1
    for idx, seg in enumerate(raw):
        if not isinstance(seg, dict):
            raise ValueError(
                f"欄位 '{col}' 的 bins 第 {idx + 1} 段必須是物件（含 min、max、label），收到：{seg}"
            )
        label = seg.get("label")
        if not isinstance(label, str) or not label.strip():
            raise ValueError(
                f"欄位 '{col}' 的 bins 第 {idx + 1} 段缺少 label，或 label 為空白字串。"
            )
        lo = _parse_bin_bound(col, idx, "min", seg.get("min"), open_allowed=(idx == 0))
        hi = _parse_bin_bound(col, idx, "max", seg.get("max"), open_allowed=(idx == last))
        if lo >= hi:
            raise ValueError(
                f"欄位 '{col}' 的 bins 第 {idx + 1} 段 min 必須小於 max，"
                f"收到 min={seg.get('min')}、max={seg.get('max')}。"
            )
        if parsed and lo < parsed[-1][1]:
            raise ValueError(
                f"欄位 '{col}' 的 bins 第 {idx + 1} 段與前一段重疊，"
                f"或未由小到大排列（前段上界 {parsed[-1][1]}、本段下界 {lo}）。"
            )
        parsed.append((lo, hi, label.strip()))
    return parsed


# 時間粒度由細到粗。日期泛化採解析（pandas 讀得懂的西元格式），系統看得懂各粒度的
# 意思，故可固定列舉並據以檢查排列順序。
TEMPORAL_LEVEL_ORDER = ("second", "minute", "hour", "day", "month", "year")

# 一天之內的粒度：時段對照表（time_periods）只在泛化到這幾級時才有東西可換。
TEMPORAL_TIME_LEVELS = ("second", "minute", "hour")

# 時間界線字串：HH:MM 或 HH:MM:SS，另允許 24:00 表示整日上界。
_TIME_BOUND_PATTERN = re.compile(r"^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$")

_SECONDS_PER_DAY = 24 * 60 * 60


def parse_temporal_levels(col: str, raw: Any) -> list[str]:
    """解析日期欄的粒度階梯宣告，回傳由細到粗的粒度名稱。

    寫法採整合方設定檔的 levels（如 ["day", "month", "year"]）：**只列要泛化到的粒度**，
    層級 1＝第一項（此例為日）、層級 2＝第二項，依此類推；層級 0 保留給「不泛化」
    （維持原值），與類別階層「階梯第 0 格是原始值」及業界工具的慣例一致。
    可用的粒度為 second／minute／hour／day／month／year。
    驗證（fail fast）：至少一段、名稱須為可用粒度、不可重複，且必須由細到粗排列——
    排反了會泛化成最細的粒度、把識別力最強的部分留下來，屬實質錯誤故擋而非提醒。
    """
    if not isinstance(raw, list) or not raw:
        raise ValueError(
            f"欄位 '{col}' 的 levels 必須是至少含一項的陣列（由細到粗列出時間粒度）。"
        )
    names: list[str] = []
    for idx, name in enumerate(raw):
        if not isinstance(name, str) or name.strip().lower() not in TEMPORAL_LEVEL_ORDER:
            raise ValueError(
                f"欄位 '{col}' 的 levels 第 {idx + 1} 項不是可用的時間粒度，收到：{name}。"
                f"可用的粒度為 {list(TEMPORAL_LEVEL_ORDER)}。"
            )
        clean = name.strip().lower()
        if clean in names:
            raise ValueError(f"欄位 '{col}' 的 levels 有重複的粒度 '{clean}'，各項須互異。")
        if names and TEMPORAL_LEVEL_ORDER.index(clean) < TEMPORAL_LEVEL_ORDER.index(names[-1]):
            raise ValueError(
                f"欄位 '{col}' 的 levels 必須由細到粗排列，'{names[-1]}' 之後不可接 '{clean}'。"
            )
        names.append(clean)
    return names


def parse_categorical_mapping(col: str, raw: Any) -> dict[str, list[str]]:
    """解析類別欄的階層宣告，回傳「原始值 → 由細到粗的階梯」。

    寫法採整合方設定檔的 mapping 物件（如 {"大安區": ["大安區", "台北市", "北部"]}）：
    鍵為原始值，陣列第 0 格＝原始值本身（層級 0＝不泛化）、第 1 格起為逐級泛化的結果，
    與日期欄 levels「層級 0 保留給不泛化」的語意一致。
    以原始值為鍵而非逐列排放，同一個原始值不可能宣告兩次。
    驗證（fail fast）：須有 mapping、至少一筆、階梯為非空字串陣列，且第 0 格須等於該鍵——
    第 0 格是拿來當原值用的，與鍵不同代表設定寫錯，照收會泛化出使用者沒預期的值。
    """
    if not isinstance(raw, dict) or "mapping" not in raw:
        raise ValueError(
            f"欄位 '{col}' 的類別階層必須以 mapping 包裝"
            f"（如 {{\"mapping\": {{\"大安區\": [\"大安區\", \"台北市\"]}}}}）。"
        )
    mapping = raw["mapping"]
    if not isinstance(mapping, dict) or not mapping:
        raise ValueError(f"欄位 '{col}' 的 mapping 必須是至少含一筆的物件（原始值對應階梯）。")
    parsed: dict[str, list[str]] = {}
    for value, ladder in mapping.items():
        if not isinstance(ladder, list) or not ladder:
            raise ValueError(
                f"欄位 '{col}' 的 mapping 中 '{value}' 必須對應至少含一項的階梯陣列。"
            )
        if any(not isinstance(item, str) or not item.strip() for item in ladder):
            raise ValueError(f"欄位 '{col}' 的 mapping 中 '{value}' 的階梯各項必須是非空字串。")
        clean = [item.strip() for item in ladder]
        if clean[0] != str(value).strip():
            raise ValueError(
                f"欄位 '{col}' 的 mapping 中 '{value}' 階梯第 1 項為 '{clean[0]}'，"
                f"須與原始值相同（第 1 項代表未泛化的原值）。"
            )
        parsed[str(value).strip()] = clean
    return parsed


def parse_time_bound(col: str, raw: Any) -> float:
    """時間界線字串（HH:MM 或 HH:MM:SS）→ 當日的第幾秒；24:00 代表整日上界。"""
    if not isinstance(raw, str) or not _TIME_BOUND_PATTERN.match(raw.strip()):
        raise ValueError(
            f"欄位 '{col}' 的 time_periods 界線必須是 HH:MM 或 HH:MM:SS 的時間字串，收到：{raw}"
        )
    hh, mm, ss = _TIME_BOUND_PATTERN.match(raw.strip()).groups()
    seconds = int(hh) * 3600 + int(mm) * 60 + int(ss or 0)
    if seconds > _SECONDS_PER_DAY:
        raise ValueError(
            f"欄位 '{col}' 的 time_periods 界線 '{raw}' 超出一天的範圍（上限為 24:00）。"
        )
    return float(seconds)


def parse_time_periods(col: str, raw: Any) -> list[tuple[float, float, str]]:
    """解析時段對照表（把一天之內的時間換成標籤），回傳 [(下界秒, 上界秒, 標籤), ...]。

    用途是讓時間輸出看得懂的名字而非數字：06:00~12:00 換成「上午」。界線寫時間字串
    （下界含、上界不含），故 06:30 這類非整點的切分同樣表達得出來；轉成當日秒數後
    直接重用 parse_numeric_bins 的所有檢查（排列、重疊、開放端、標籤）。
    跨午夜這類繞一圈的範圍，寫成兩段同名即可（22:00~24:00 與 00:00~06:00 都叫「深夜」）。
    驗證（fail fast）：須為陣列、界線格式合法、區間本身合法、標籤不可含 "*"
    （該字元保留給「未落入任何區間」的標記，混用會無法分辨）。
    """
    if not isinstance(raw, list) or not raw:
        raise ValueError(
            f"欄位 '{col}' 的 time_periods 必須是至少含一段的陣列（每段含 min、max、label）。"
        )
    normalized: list[dict] = []
    for seg in raw:
        if not isinstance(seg, dict):
            raise ValueError(
                f"欄位 '{col}' 的 time_periods 每段必須是物件（含 min、max、label），收到：{seg}"
            )
        normalized.append(
            {
                "min": None if seg.get("min") is None else parse_time_bound(col, seg.get("min")),
                "max": None if seg.get("max") is None else parse_time_bound(col, seg.get("max")),
                "label": seg.get("label"),
            }
        )
    table = parse_numeric_bins(f"{col}（time_periods）", normalized)
    for _, _, label in table:
        if "*" in label:
            raise ValueError(
                f"欄位 '{col}' 的 time_periods 標籤 '{label}' 不可含 '*'："
                f"該字元保留給未落入任何區間的值。"
            )
    return table


def parse_rounding_unit(col: str, raw: Any) -> float:
    """解析 rounding：四捨五入到該數的倍數（如 10），數值大小不限、由使用者自訂。"""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError(f"欄位 '{col}' 的 rounding 必須是數字（四捨五入到該數的倍數，如 10），收到：{raw}")
    if raw <= 0:
        raise ValueError(
            f"欄位 '{col}' 的 rounding 必須大於 0（0 會造成除以零、負數無意義），收到：{raw}"
        )
    return float(raw)


class ColumnInfo(BaseModel):
    """單一欄位的角色、型別與處理策略定義"""

    model_config = _STRICT_FIELDS

    role: str = Field(
        ...,
        description="欄位角色: identifier, quasi_identifier, sensitive, non_sensitive",
    )
    type: str = Field(
        ..., description="欄位型別: numeric, categorical, temporal, string"
    )
    strategy: str | None = Field(
        None,
        description=(
            "使用者自訂策略: mask(全遮蔽/固定字元), partial(部分遮蔽), hash, generalize, "
            "remove(移除整個欄位), clear(值清空、欄位保留), none"
        ),
    )
    mask_char: str | None = Field(
        "*", description="遮蔽字元（全遮蔽/固定字元/部分遮蔽共用），預設為 *"
    )
    mask_mode: str | None = Field(
        "prefix",
        description="prefix（保留前綴）、suffix（保留後綴）、length（字串泛化以字元長度分級）；部分遮蔽採 prefix/suffix",
    )
    keep_chars: int = Field(
        3, ge=0, description="部分遮蔽保留的字元數（其餘遮蔽），預設 3"
    )
    mask_length: int | None = Field(
        None,
        ge=1,
        description="全遮蔽輸出的固定字元數；未設定則沿用原值長度（原值長度本身也是資訊）",
    )
    cell_fill_value: str | None = Field(
        None,
        description="值抑制時本欄要填入的值（如泛化樹頂層「台灣」）；未設定則沿用呼叫端的 cell_fill",
    )

    @field_validator("cell_fill_value", mode="before")
    def validate_cell_fill_value(cls, v):
        # 設定檔為人手寫，填數字（如 0）屬合理輸入，照實轉成字串收下而非報型別錯。
        # 但空字串一律擋：那是「填空值」的意思，應改用呼叫端 cell_fill=missing，
        # 否則輸出會混入空字串，與真正的空值在下游行為不同（空字串仍會汙染數值欄型別）。
        if v is None:
            return None
        s = str(v)
        if not s.strip():
            raise ValueError(
                "cell_fill_value 不可為空字串或空白；若要讓值抑制填入空值，"
                "請於呼叫時指定 cell_fill=missing。"
            )
        return s

    @field_validator("role")
    def validate_role(cls, v):
        allowed = ["identifier", "quasi_identifier", "sensitive", "non_sensitive"]
        if v.lower() not in allowed:
            raise ValueError(f"不合法的 role: {v}。必須是 {allowed} 之一。")
        return v.lower()

    @field_validator("type")
    def validate_type(cls, v):
        allowed = ["numeric", "categorical", "temporal", "string"]
        if v.lower() not in allowed:
            raise ValueError(f"不合法的 type: {v}。必須是 {allowed} 之一。")
        return v.lower()

    @field_validator("mask_mode")
    def validate_mask_mode(cls, v):
        if v is None:
            return "prefix"
        allowed = ["prefix", "suffix", "length"]
        if v.lower() not in allowed:
            raise ValueError(f"不合法的 mask_mode: {v}。必須是 {allowed} 之一。")
        return v.lower()

    @field_validator("strategy")
    def validate_strategy(cls, v):
        # None＝省略，採用角色預設策略（見 get_effective_strategy）
        if v is None:
            return None
        # remove 與 clear 是兩種不同的處置：remove 連欄位一起刪，clear 只清值、欄位留著。
        # 後者供下游資料表欄位固定、欄位消失會導致匯入失敗的整合情境使用。
        allowed = ["mask", "partial", "hash", "generalize", "remove", "clear", "none"]
        if v.lower() not in allowed:
            raise ValueError(
                f"不合法的 strategy: {v}。必須是 {allowed} 之一（或省略以採用角色預設）。"
            )
        return v.lower()

    def get_effective_strategy(self) -> str:
        """回傳實際使用的策略：優先採用使用者自訂，否則依角色套用預設值"""
        if self.strategy:
            return self.strategy

        # 各角色的預設處理策略
        defaults = {
            "identifier": "hash",         # 直接識別欄位預設假名化（hash）；僅 strategy=remove 才移除
            "quasi_identifier": "generalize",  # 準識別欄位預設泛化
            "sensitive": "none",          # 敏感欄位預設不處理（由 l/t 機制管控）
            "non_sensitive": "none",      # 非敏感欄位預設不處理
        }
        return defaults.get(self.role, "none")


class ColumnConfig(BaseModel):
    """
    完整的欄位設定檔模型。

    欄位說明：
        columns                  : 各欄位的角色、型別與策略定義
        generalization_hierarchies: 數值型 QI 的區間／捨入設定、日期型 QI 的粒度階梯（levels）、
                                    字串型 QI 的長度級距（bin_size）
        generalization_matrices  : 類別型 QI 欄位的自訂階層（mapping 寫法）
        qi_generalization_levels : 各 QI 欄位的泛化層級（數值型不適用，見下）

    數值型 QI 一律由使用者明確指定泛化方式，系統不提供預設切法，二擇一：
        bins     — 逐段寫明「從幾、到幾、叫什麼」，輸出為區間標籤（文字）
        rounding — 四捨五入至該數字的倍數，輸出仍為數字
    兩者皆未指定＝該欄不泛化（報告會提醒）；同時指定則報錯。數值型不吃泛化層級，
    因為切法已由使用者逐段寫死，沒有「第幾層」可選。

    日期型 QI 由使用者以 levels 宣告粒度階梯（由細到粗，如 ["day", "month", "year"]），
    泛化層級 1＝第一個粒度、層級 2＝第二個，依此類推；層級 0 代表不泛化。
    輸入須為 pandas 解析得動的西元格式（進引擎前檢查整欄），
    輸出為該粒度的標準寫法（如 1993-05）。未指定 levels＝該欄不泛化（報告會提醒）。
    可另以 time_periods 附時段對照表，把一天之內的時間換成標籤（06:00~12:00 →「上午」，
    界線寫時間字串故非整點亦可）；對照表只在泛化到時／分／秒時生效，泛化到日以上
    不擋、於報告提醒。時間與日期建議分為兩欄上傳（日期欄做降階、時間欄出時段），
    與業界工具「一欄一個時間屬性」的慣例一致。

    YAML 設定範例：
        k: 5                       # 選填，以下為整體參數，未填即採預設
        suppression_method: row_suppression
        columns:
          年齡:
            role: quasi_identifier
            type: numeric
          薪資:
            role: quasi_identifier
            type: numeric
        generalization_hierarchies:
          年齡:
            bins:
              - {min: null, max: 18, label: 未成年}
              - {min: 18, max: 65, label: 青壯年}
              - {min: 65, max: null, label: 銀髮族}
          薪資:
            rounding: 1000
    """

    model_config = _STRICT_FIELDS

    columns: dict[str, ColumnInfo]
    generalization_hierarchies: dict[str, Any] | None = Field(default_factory=dict)
    # 類別型 QI 的階層宣告：{欄位: {"mapping": {原始值: [原始值, 上一層, ...]}}}。
    # 採整合方設定檔的 mapping 寫法，其類別階層區塊可直接餵入、不需轉換。
    generalization_matrices: dict[str, Any] | None = Field(default_factory=dict)
    # 各 QI 欄位的泛化層級：單一整數（固定）或 [min, max]（範圍，規格 2.1(2)）。
    # 0 表示不泛化，數字越大泛化程度越高。
    qi_generalization_levels: dict[str, Any] | None = Field(default_factory=dict)

    # ── 整體參數（一律隨設定檔提供）─────────────────────────────────────────────
    # 全部選填：未填＝未指定，由邊界層填上內建預設並於報告 applied_defaults 告知。
    # 值本身的合法性（列舉值、百分比範圍）仍由引擎建構時驗證，此處只收型別。
    # 鹽值不在此列——機密不進設定檔，一律由部署環境的 .env 提供。
    input_format: str | None = Field(None, description=INPUT_FORMAT_DESC)
    k: int | None = Field(None, description="K-匿名等價類最小列數（未填→預設 5）")
    l: int | None = Field(None, description="l-多樣性門檻（選填）")  # noqa: E741
    t: float | None = Field(None, description="t-相近性門檻（選填）")
    suppression_limit_percent: float | None = Field(
        None, description="最大允許抑制率百分比（未填→預設 20）"
    )
    limit_exceeded_action: str | None = Field(
        None, description="超出上限行為 stop_and_error／allow_with_warning（未填→後者）"
    )
    suppression_method: str | None = Field(
        None, description="抑制方式 row_suppression／cell_suppression（未填→前者）"
    )
    cell_fill: str | None = Field(
        None, description="值抑制填法 star／missing（未填→star）"
    )
    # 假名化／雜湊遮蔽用的演算法。此為整份設定共用的區塊層參數，不逐欄指定：
    # 同一次處理內各欄用不同演算法沒有意義，只會讓輸出無從比對。
    # 有預設值（不像上面幾個以 None 表示未填）：本次用了哪個演算法一律寫進品質報告，
    # 使用者看得到，不必再走 applied_defaults 那條告知路徑。
    # 合法值與對照表在 app.engines.anonymization.strategies.masking，由引擎建構時驗證。
    algorithm: str = Field(
        "sha3-256", description="雜湊演算法 sha256／sha3-256／sha3-512（未填→sha3-256）"
    )

    @field_validator("generalization_hierarchies")
    def validate_hierarchies(cls, v):
        # 數值泛化設定於解析設定檔時即完整驗證（純 config、不需比對資料），
        # 避免錯誤設定拖到跑資料當中才炸。
        for col, spec in (v or {}).items():
            if not isinstance(spec, dict):
                raise ValueError(
                    f"欄位 '{col}' 的泛化設定必須是物件（如 bins / rounding / bin_size），收到：{spec}"
                )
            if "bins" in spec and "rounding" in spec:
                raise ValueError(
                    f"欄位 '{col}' 同時設定了 bins 與 rounding，"
                    f"數值泛化請擇一：bins 為自訂區間、rounding 為四捨五入。"
                )
            if "bins" in spec:
                parse_numeric_bins(col, spec["bins"])
            if "rounding" in spec:
                parse_rounding_unit(col, spec["rounding"])
            if "levels" in spec:
                parse_temporal_levels(col, spec["levels"])
                if "time_periods" in spec:
                    parse_time_periods(col, spec["time_periods"])
            elif "time_periods" in spec:
                raise ValueError(
                    f"欄位 '{col}' 設定了 time_periods 卻沒有 levels："
                    f"時段對照表要在泛化到時／分／秒時才會套用，請先以 levels 宣告粒度階梯。"
                )
        return v

    @field_validator("generalization_matrices")
    def validate_matrices(cls, v):
        # 類別階層同樣於解析設定檔時即完整驗證（純 config、不需比對資料）。
        for col, spec in (v or {}).items():
            parse_categorical_mapping(col, spec)
        return v

    @field_validator("qi_generalization_levels")
    def validate_levels(cls, v):
        # 解析設定檔時即驗證每個層級值（整數或 [min,max]），非法即報錯
        if v:
            for name, val in v.items():
                parse_level_value(name, val)
        return v

    def validate_config(self):
        """執行整體配置的合理性檢查（純 config 的型別/策略/設定衝突，前置 fail fast）。

        皆不需比對實際資料 → 於解析設定檔時即可擋（在進入引擎前），符合「擋的檢查前置」原則。
        """
        for col_name, info in self.columns.items():
            strategy = info.get_effective_strategy()
            # 日期格式不支援字元遮蔽，需改用泛化
            if strategy == "mask" and info.type == "temporal":
                raise ValueError(
                    f"欄位 '{col_name}' 為日期格式，不支援遮蔽 (mask) 策略。"
                )

            # 類別型 QI 設了泛化層級（實際套用的 min 層級 > 0）卻沒提供階層：
            # 想泛化卻無矩陣可用，欄位會默默維持原值＝k-匿名保護悄悄變弱。屬「該設定卻沒設定」，
            # 純 config 即可判定 → 前置擋（fail fast），不留到泛化流程中才發現。
            if info.role == "quasi_identifier" and info.type == "categorical":
                level_val = (self.qi_generalization_levels or {}).get(col_name)
                if level_val is not None:
                    lo, _ = parse_level_value(col_name, level_val)
                    has_matrix = (
                        bool(self.generalization_matrices)
                        and col_name in self.generalization_matrices
                    )
                    if lo > 0 and not has_matrix:
                        raise ValueError(
                            f"欄位 '{col_name}' 為類別型準識別欄位並設定了泛化層級 {level_val}，"
                            f"但未於 generalization_matrices 提供對應階層，無法進行泛化，請補上後重試。"
                        )


def _parse_time_bound(col: str, raw: str) -> "pd.Timestamp":
    """把 time_clipping_bounds 的一個界線字串解析成時間點；解析不出來即 fail fast。

    採與資料同一套的寬鬆解析（pd.to_datetime），使用者寫 "1930-01-01" 或
    "1930/01/01 08:00" 都收；純 config 即可判定 → 於解析設定檔時就擋。
    """
    parsed = pd.to_datetime(raw, errors="coerce")
    if pd.isna(parsed):
        raise PetsError(
            "ERR_DP_INVALID_BUDGET",
            f"欄位 '{col}' 的 time_clipping_bounds 界線必須是可解析的日期時間字串，"
            f"收到：{raw}",
        )
    return parsed


class ColumnBudget(BaseModel):
    """單一欄位的 DP 預算與機制宣告（對齊 ColumnInfo：逐欄設定一律放設定檔）。"""

    model_config = _STRICT_FIELDS

    # 欄位型別為必填（比照 ColumnInfo.type，不給即報錯、不自動猜）。
    # DP 只在乎「量 vs 名字」，故兩大型別＋datetime：
    #   continuous  → 數值加噪（離散型 Laplace/Gaussian，由 delta 決定）
    #   categorical → k-RR 翻面（含 2 值＝Binary 特例；不需 delta/sensitivity）
    #   datetime    → 日期抖動（對齊 noise_unit 後轉成該單位的數值，復用數值加噪）
    type: str = Field(..., description="欄位型別: continuous, categorical, datetime")
    # 鍵名採整合方文件的用字（epsilon_budget／delta_budget），設定檔可直接互通；
    # 型別詞彙仍用本工具自己的一套（DP 只分「量」與「名字」，比 K-匿名少一類）。
    epsilon_budget: float
    # δ 為 Optional 以區分「沒給」（None → 可由全域 default_delta 補）與
    # 「明確設 0」（使用者指定要純 ε 保證＝離散型 Laplace，全域值不得覆蓋）。
    delta_budget: float | None = None
    sensitivity: float | None = None
    # datetime 專用：雜訊注入與輸出的時間單位（day / hour / minute / second）。
    # 未給即 day。★ sensitivity 的單位跟著它走——同樣寫 30，
    # day 是 30 天、second 是 30 秒，故兩者須一起看。
    noise_unit: str | None = None
    # ── 以下三個為 datetime 專用（刻度與上下界；與數值欄刻意不共用欄位名）─────────
    # 幾個 noise_unit 算一格：noise_unit: minute + noise_step: 5 ＝ 以 5 分鐘為刻度。
    # 未給即 1（＝1 個 noise_unit）。
    noise_step: int | None = None
    # 後處理用的合理上下界，寫成日期字串 ["1930-01-01", "2026-12-31"]；未給即不做超界處理。
    time_clipping_bounds: tuple[str, str] | None = None
    # 超界時的處理方式：clamp／wrap／fold（與數值欄同義，欄位名分開以免兩者混填）。
    # 有給 time_clipping_bounds 卻沒給策略時採 clamp。
    time_out_of_bounds_strategy: str | None = None
    # ── 以下三個為 continuous 專用（離散型 DP）───────────────────────────────
    # 公開的最小單位（刻度）：加噪前資料全部除以它變整數，加噪後再乘回去。未給即 1。
    # datetime 欄不設此參數——它的 noise_unit 已把序數壓成整數，最小單位即 1 個 noise_unit。
    minimum_unit: float | None = None
    # 後處理用的合理上下界，寫成 [min, max]；未給即不做超界處理。
    clipping_bounds: tuple[float, float] | None = None
    # 超界時的處理方式：clamp（截斷至邊界）／wrap（繞至另外一端）／fold（反向計算剩餘值）。
    # 有給 clipping_bounds 卻沒給策略時採 clamp。
    out_of_bounds_strategy: str | None = None

    @field_validator("type")
    def validate_type(cls, v):
        allowed = ["continuous", "categorical", "datetime"]
        if v.lower() not in allowed:
            raise ValueError(f"不合法的 type: {v}。必須是 {allowed} 之一。")
        return v.lower()

    @field_validator("noise_unit")
    def validate_noise_unit(cls, v):
        if v is None:
            return v
        allowed = ["day", "hour", "minute", "second"]
        if v.lower() not in allowed:
            raise ValueError(f"不合法的 noise_unit: {v}。必須是 {allowed} 之一。")
        return v.lower()

    @field_validator("out_of_bounds_strategy", "time_out_of_bounds_strategy")
    def validate_out_of_bounds_strategy(cls, v, info):
        if v is None:
            return v
        allowed = ["clamp", "wrap", "fold"]
        if v.lower() not in allowed:
            raise ValueError(
                f"不合法的 {info.field_name}: {v}。必須是 {allowed} 之一。"
            )
        return v.lower()


class DPColumnConfig(BaseModel):
    """
    完整的差分隱私欄位預算設定檔模型（對齊 ColumnConfig）。

    逐欄預算放 column_budgets，全域參數（accumulated_*／default_delta）比照 K-匿名的
    k/l/t 一併放在同一份設定檔內，讓一份檔案能完整重現一次處理。

    ★ accumulated_epsilon／accumulated_delta 是「到目前為止已經用掉多少」的狀態值。
    引擎只讀不寫（記憶體零留存，不回寫設定檔），跑完後的新累計值由預算報告
    （X-Budget-Report 的 accumulated_epsilon）帶出，呼叫方須自行填回下一次要用的設定檔；
    若一直沿用同一份未更新的檔案，等於每次都從同一個數字重新起算，預算不會累計。

    YAML 設定範例：
        accumulated_epsilon: 0.0   # 選填，已用掉的 ε（未填＝從 0 起算）
        default_delta: 1.0e-5      # 選填，補沒設 δ 的 continuous/datetime 欄
        column_budgets:
          薪資:
            type: continuous
            epsilon_budget: 1.0
            delta_budget: 1.0e-5   # 注意：須寫 1.0e-5，寫 1e-5 會被 YAML 當字串
            sensitivity: 5000
            minimum_unit: 100      # 選填，公開的最小單位（未給即 1）
            clipping_bounds: [0, 200000]      # 選填，加噪後的合理上下界
            out_of_bounds_strategy: clamp     # 選填，超界處理（未給即 clamp）
          性別:
            type: categorical
            epsilon_budget: 0.5
          就診時間:
            type: datetime
            epsilon_budget: 1.0
            noise_unit: minute # 未給即 day；sensitivity 的單位跟著它走
            noise_step: 5      # 選填，幾個 noise_unit 算一格（此例＝5 分鐘；未給即 1）
            sensitivity: 60    # ＝60 分鐘（若 noise_unit 為 day 則是 60 天）
            time_clipping_bounds: ["2020-01-01", "2026-12-31"]  # 選填，加噪後的合理範圍
            time_out_of_bounds_strategy: clamp                  # 選填，未給即 clamp
    """

    model_config = _STRICT_FIELDS

    column_budgets: dict[str, ColumnBudget]

    # ── 整體參數（一律隨設定檔提供）─────────────────────────────────────────────
    input_format: str | None = Field(None, description=INPUT_FORMAT_DESC)
    accumulated_epsilon: float = Field(
        0.0, description="已累積消耗的 ε（無狀態設計：由呼叫方自帶並自行更新）"
    )
    accumulated_delta: float = Field(0.0, description="已累積消耗的 δ")
    default_delta: float | None = Field(
        None, description="全域（相同）δ：補沒設 δ 的 continuous/datetime 欄"
    )

    def validate_config(self):
        """執行整體配置的合理性檢查（純 config 的值域/型別衝突，前置 fail fast）。

        皆不需比對實際資料 → 於解析設定檔時即可擋（在進入引擎前），符合「擋的檢查前置」原則。
        引擎入口（BudgetValidator._self_check）亦會再呼叫一次，確保直接呼叫引擎者不繞過。
        """
        # ★ TTC 2026-11-02：數值一律須為有限值。NaN 與任何數比較皆為假，原本 NaN ε 會通過「> 0」檢查，
        #   進到 k-RR 後整欄翻轉；inf 讓 exp(ε) 溢位。累計值為 NaN 會汙染整份預算帳。
        for name, value in (
            ("accumulated_epsilon", self.accumulated_epsilon),
            ("accumulated_delta", self.accumulated_delta),
        ):
            if not (math.isfinite(value) and value >= 0):
                raise PetsError(
                    "ERR_DP_INVALID_BUDGET", f"{name} 必須為大於或等於 0 的有限數值（收到 {value}）。"
                )
        for col, budget in self.column_budgets.items():
            for name, value in (
                ("sensitivity", budget.sensitivity),
                ("minimum_unit", budget.minimum_unit),
                *(
                    (f"clipping_bounds[{i}]", bound)
                    for i, bound in enumerate(budget.clipping_bounds or ())
                ),
            ):
                if value is not None and not math.isfinite(value):
                    raise PetsError(
                        "ERR_DP_INVALID_BUDGET", f"欄位 '{col}' 的 {name} 必須為有限數值（收到 {value}）。"
                    )
            # ★ TTC 2026-11-02：sensitivity 為 0 或負值原本被悄悄改成 1 個最小單位，並標示為使用者申報
            if budget.sensitivity is not None and budget.sensitivity <= 0:
                raise PetsError(
                    "ERR_DP_INVALID_BUDGET",
                    f"欄位 '{col}' 的 sensitivity 必須 > 0（收到 {budget.sensitivity}）。",
                )
            # ε 必須為正（ε≤0 在 DP 無意義）
            if not (math.isfinite(budget.epsilon_budget) and budget.epsilon_budget > 0):
                raise PetsError(
                    "ERR_DP_INVALID_BUDGET",
                    f"欄位 '{col}' 的 epsilon_budget 必須 > 0（收到 {budget.epsilon_budget}）。",
                )
            # δ 未設（None）時交由全域 default_delta 補洞，此處只驗「有明確設」的值；
            # δ 為機率、須落在 [0, 1)。
            if budget.delta_budget is not None and not (0 <= budget.delta_budget < 1):
                raise PetsError(
                    "ERR_DP_INVALID_BUDGET",
                    f"欄位 '{col}' 的 delta_budget 必須大於等於 0 且小於 1"
                    f"（收到 {budget.delta_budget}）。",
                )
            # categorical 走 k-RR（純 ε 機制），δ/sensitivity 對它無意義。若使用者「明確設了」
            # 非預設值（δ>0 或 sensitivity 非 None）→ fail fast：這通常代表對該欄型別的誤解，
            # 且 δ 一旦設了會被計入預算總帳（收錢卻不生效），故偏嚴、擋而非靜默忽略。
            if budget.type == "categorical":
                has_delta = budget.delta_budget is not None and budget.delta_budget > 0
                if has_delta or budget.sensitivity is not None:
                    raise PetsError(
                        "ERR_DP_INVALID_BUDGET",
                        f"欄位 '{col}' 宣告為 categorical（k-RR 為純 ε 機制），"
                        f"不需要 delta_budget/sensitivity，請移除後重試。",
                    )
            # noise_unit 只有日期欄用得到。設在別的型別上不會生效，且通常代表把欄位型別
            # 認錯了（比照上面 categorical 的處置：偏嚴、擋而非靜默忽略）。
            if budget.type != "datetime" and budget.noise_unit is not None:
                raise PetsError(
                    "ERR_DP_INVALID_BUDGET",
                    f"欄位 '{col}' 宣告為 {budget.type}，noise_unit 只適用於 datetime 欄位，"
                    f"請移除後重試。",
                )
            # 日期欄的刻度與上下界只有 datetime 用得到（比照 noise_unit 的處置）。
            if budget.type != "datetime":
                for name, value in (
                    ("noise_step", budget.noise_step),
                    ("time_clipping_bounds", budget.time_clipping_bounds),
                    ("time_out_of_bounds_strategy", budget.time_out_of_bounds_strategy),
                ):
                    if value is not None:
                        raise PetsError(
                            "ERR_DP_INVALID_BUDGET",
                            f"欄位 '{col}' 宣告為 {budget.type}，{name} 只適用於 "
                            f"datetime 欄位，請移除後重試。",
                        )
            # 一格至少要有一個 noise_unit：填 0 或負數等於刻度沒有意義。
            if budget.noise_step is not None and budget.noise_step <= 0:
                raise PetsError(
                    "ERR_DP_INVALID_BUDGET",
                    f"欄位 '{col}' 的 noise_step 必須 > 0（收到 {budget.noise_step}）。",
                )
            # 上下界須解析得出日期，且下界不得晚於上界（比照數值欄的空範圍檢查）。
            if budget.time_clipping_bounds is not None:
                low, high = [
                    _parse_time_bound(col, raw) for raw in budget.time_clipping_bounds
                ]
                if low > high:
                    raise PetsError(
                        "ERR_DP_INVALID_BUDGET",
                        f"欄位 '{col}' 的 time_clipping_bounds 下界不得晚於上界"
                        f"（收到 {list(budget.time_clipping_bounds)}）。",
                    )
            if (
                budget.time_out_of_bounds_strategy is not None
                and budget.time_clipping_bounds is None
            ):
                raise PetsError(
                    "ERR_DP_INVALID_BUDGET",
                    f"欄位 '{col}' 設了 time_out_of_bounds_strategy 卻沒有 "
                    f"time_clipping_bounds，請補上上下界後重試。",
                )
            # 離散化的三個參數只有 continuous 用得到：datetime 的刻度由 noise_unit
            # 搭 noise_step 表示，categorical 沒有「量」可談。
            # 設在別的型別上不會生效 → 比照 noise_unit 的處置，擋而非靜默忽略。
            if budget.type != "continuous":
                for name, value in (
                    ("minimum_unit", budget.minimum_unit),
                    ("clipping_bounds", budget.clipping_bounds),
                    ("out_of_bounds_strategy", budget.out_of_bounds_strategy),
                ):
                    if value is not None:
                        raise PetsError(
                            "ERR_DP_INVALID_BUDGET",
                            f"欄位 '{col}' 宣告為 {budget.type}，{name} 只適用於 "
                            f"continuous 欄位，請移除後重試。",
                        )
            # 最小單位須為正數：填 0 會除以零、填負數會讓整欄變號，都是設定本身就矛盾。
            if budget.minimum_unit is not None and budget.minimum_unit <= 0:
                raise PetsError(
                    "ERR_DP_INVALID_BUDGET",
                    f"欄位 '{col}' 的 minimum_unit 必須 > 0（收到 {budget.minimum_unit}）。",
                )
            # 上下界顛倒：範圍是空的，三種超界策略都無從執行。
            if budget.clipping_bounds is not None:
                low, high = budget.clipping_bounds
                if low > high:
                    raise PetsError(
                        "ERR_DP_INVALID_BUDGET",
                        f"欄位 '{col}' 的 clipping_bounds 下界不得大於上界"
                        f"（收到 [{low}, {high}]）。",
                    )
            # 有策略卻沒有界線：沒有範圍就談不上超界，通常代表少填了一半。
            if (
                budget.out_of_bounds_strategy is not None
                and budget.clipping_bounds is None
            ):
                raise PetsError(
                    "ERR_DP_INVALID_BUDGET",
                    f"欄位 '{col}' 設了 out_of_bounds_strategy 卻沒有 clipping_bounds，"
                    f"請補上上下界後重試。",
                )


def _read_config_text(path: str) -> tuple[str, str]:
    """讀入設定檔並回傳 (文字, 副檔名)，供 CLI 用的 parse_bundled_config 使用。

    檔案不存在屬呼叫方給錯路徑（非系統故障），故帶錯誤碼拋出，
    讓 CLI 據以回「使用者輸入錯誤」的離開代碼，而不是落入未預期錯誤。
    """
    if not os.path.exists(path):
        raise PetsError("ERR_INVALID_PARAM", f"設定檔不存在：{path}")
    _, ext = os.path.splitext(path.lower())
    with open(path, "rb") as f:
        return _decode_config_bytes(f.read()), ext


# ── 再識別風險評估：獨立區塊（不與 K-匿名 ColumnConfig／DP DPColumnConfig 共用）─────

class RiskColumnInfo(BaseModel):
    """再識別風險評估的單一欄位宣告。

    只裝風險評估需要的兩件事：
      role: 攻擊面向——quasi_identifier（三攻擊的攻擊面）或 sensitive（推斷性的目標）。
            **只有兩值**：identifier／non_sensitive 對三攻擊沒有位置，故不接受。
      type: 欄位型別（與 K-匿名同一套詞彙）。**不參與運算**——三攻擊與 CAP 一律以實際
            dtype 判定連續／類別，資料本身即事實，不需宣告。合法值受限於下方 validator，
            與 K-匿名的欄位宣告格式一致。
    多餘欄位（strategy／epsilon_budget 等）一律擋下，避免打錯字被靜默吞掉。
    """

    model_config = _STRICT_FIELDS

    role: str = Field(..., description="風險角色: quasi_identifier 或 sensitive")
    type: str = Field(..., description="欄位型別: numeric / categorical / temporal / string")

    @field_validator("role")
    def validate_role(cls, v):
        allowed = ["quasi_identifier", "sensitive"]
        if v.lower() not in allowed:
            raise ValueError(
                f"不合法的 role: {v}。風險評估的 role 只接受 {allowed}"
                f"（identifier／non_sensitive 不參與三攻擊，請勿宣告）。"
            )
        return v.lower()

    @field_validator("type")
    def validate_type(cls, v):
        allowed = ["numeric", "categorical", "temporal", "string"]
        if v.lower() not in allowed:
            raise ValueError(f"不合法的 type: {v}。必須是 {allowed} 之一。")
        return v.lower()


class RiskLinkability(BaseModel):
    """連結性攻擊的自訂特徵子集 A／B（選填）。

    A／B 是「指定哪些欄位當子集 A、哪些當 B」＝欄位角色，故隨其他角色宣告一起
    住設定檔，不走 CLI/API 參數（比照 columns 的 role）。未提供整個 linkability 區塊時，
    引擎以 QI 池對半自動導出 A／B。
    """

    model_config = _STRICT_FIELDS

    A: list[str] | None = None
    B: list[str] | None = None


class RiskConfig(BaseModel):
    """再識別風險評估的欄位宣告設定檔（獨立 config）。

    YAML 設定範例：
        columns:
          年齡:
            role: quasi_identifier
            type: numeric
          年收入:
            role: sensitive
            type: numeric
        linkability:        # 選填；未給則由 QI 池對半導出
          A: [年齡]
          B: [地區]
        subgroup:           # 選填；未給＝評估全體
          年齡: {min: 30, max: 40}
        n_iter: 500         # 選填，以下為實驗參數，未填即採預設
    """

    model_config = _STRICT_FIELDS

    columns: dict[str, RiskColumnInfo]
    linkability: RiskLinkability | None = None

    # ── 整體參數（一律隨設定檔提供）─────────────────────────────────────────────
    # 兩份資料集的格式各自宣告：CAP 的原始與去識別後是不同來源，不保證同一種格式。
    input_format: str | None = Field(None, description=f"原始資料集：{INPUT_FORMAT_DESC}")
    processed_format: str | None = Field(
        None, description=f"去識別後資料集（僅 CAP 用）：{INPUT_FORMAT_DESC}"
    )
    # 子群體限定（§3(1)C-ii）：欄位→條件的物件，未填＝評估全體。
    # 型別刻意收成 Any、由 validate_config 自行判定：pydantic 的型別錯誤一律歸為
    # ERR_CONFIG_INVALID，會把「條件本身畸形」原有的錯誤碼吃掉。
    # 條件內容（欄位存在與否、range／isin 語意）需比對資料，仍由引擎入口判定。
    subgroup: Any = Field(
        None, description='子群體條件，如 {"年齡": {"min": 30, "max": 40}}'
    )
    # 實驗參數：與風險角色同屬「這次評估怎麼做」的宣告，故一併隨設定檔提供。
    n_iter: int = Field(500, description="指認性攻擊迭代次數")
    ctrl_ratio: float = Field(0.2, description="holdout（ctrl）切分比例")
    seed: int = Field(42, description="隨機種子")
    n_subset: int = Field(500, description="連結性攻擊評估樣本數")
    n_repeats: int = Field(1, description="重複實驗輪數，預設 1（單輪，不做交叉驗證）")
    overlap_ratio: float = Field(
        0.0, description="跨輪 ctrl 抽樣重疊比例，僅 n_repeats>1 時生效"
    )

    def subgroup_conditions(self) -> dict[str, Any] | None:
        """子群體條件；未宣告或宣告為空＝評估全體（回 None）。"""
        return self.subgroup or None

    def qi_columns(self) -> list[str]:
        """宣告為準識別符的欄位（三攻擊的攻擊面）。"""
        return [c for c, info in self.columns.items() if info.role == "quasi_identifier"]

    def sensitive_columns(self) -> list[str]:
        """宣告為敏感的欄位（推斷性與 CAP 的目標）。"""
        return [c for c, info in self.columns.items() if info.role == "sensitive"]

    def linkability_pair(self) -> tuple[list[str] | None, list[str] | None]:
        """自訂連結性 A／B 欄位；未提供 linkability 區塊時回 (None, None)，
        由引擎以 QI 池對半自動導出。"""
        if self.linkability is None:
            return None, None
        return self.linkability.A, self.linkability.B

    def validate_config(self):
        """config 自我檢查（純 config、免比對資料，於解析時前置擋）。

        重複欄名由「拒絕重複 key」的 loader 在解析階段擋（見 _load_config_no_dup）；
        此處擋語意層規則：sensitive 須恰好一個——0 個無從評估（推斷性/CAP 缺目標 Y）、
        多個無法擇一（避免宣告多個卻只評估第一個）；兩者皆為
        純 config 即可判定，故一律於解析時前置擋。
        連結性 A／B 的成對非空與互斥（純 config 即可判定）。
        子群體條件的外層形狀（須為「欄位: 條件」的物件）。
        欄名存在於「資料」的檢查仍由引擎入口 RiskInputValidator 負責（需比對資料）。
        """
        if self.subgroup is not None and not isinstance(self.subgroup, dict):
            raise PetsError(
                "ERR_SUBSET_COND_MALFORMED",
                f"subgroup 必須是「欄位: 條件」的物件"
                f"（如 {{\"年齡\": {{\"min\": 30, \"max\": 40}}}}），收到：{self.subgroup}",
            )

        sensitive = self.sensitive_columns()
        if len(sensitive) == 0:
            raise PetsError(
                "ERR_RISK_CONFIG_NO_SENSITIVE",
                "風險評估需要恰好一個 sensitive 欄位作為推斷性／CAP 的目標，"
                "但設定檔未宣告任何 sensitive。請指派一個 sensitive 欄位。",
            )
        if len(sensitive) > 1:
            raise PetsError(
                "ERR_RISK_CONFIG_MULTI_SENSITIVE",
                f"風險評估一次只評估一個 sensitive 欄位，但收到 {len(sensitive)} 個"
                f"（{sensitive}）。請分批，每次只保留一個 sensitive。",
            )

        if self.linkability is not None:
            a, b = self.linkability.A, self.linkability.B
            if not a or not b:
                raise PetsError(
                    "ERR_LINK_AB_INCOMPLETE",
                    "自訂連結性 A／B 欄位須成對提供，且各至少一欄。",
                )
            overlap = set(a) & set(b)
            if overlap:
                raise PetsError(
                    "ERR_LINK_AB_OVERLAP",
                    f"連結性 A、B 欄位不可重疊（{sorted(overlap)}）；"
                    f"垂直切割要求一欄只能在一邊。",
                )


# ── 資料前處理：獨立區塊（與 K-匿名／DP／風險三者互不共用）───────────────────
#
# 規格描述的是一張「FCFS 的列表，每列為 {欄位名稱, {功能名稱, 功能參數,…}}」，故此處
# 用陣列而非物件承載：陣列本身有序，由上往下即執行順序，同一個欄位也可以出現多次
# （例如左右各截斷一次就排兩列）。不另設編號欄位——與陣列順序重複，對不上時還要決定
# 聽誰的；報錯改以陣列位置指路。

class PreprocessActionSpec(BaseModel):
    """一次動作：功能名稱與它的參數。

    params 刻意收成寬鬆的字典，不在此逐個功能宣告型別：11 個功能的參數各不相同，
    合法與否由各功能自己判斷（見 app.engines.preprocess.factory 的登記表），
    設定類別只負責形狀。
    """

    model_config = _STRICT_FIELDS

    action: str
    params: dict[str, Any] = Field(default_factory=dict)


class PreprocessColumn(BaseModel):
    """清單的一列：對哪一欄、依序做哪些動作。"""

    model_config = _STRICT_FIELDS

    column: str
    actions: list[PreprocessActionSpec]


class PreprocessConfig(BaseModel):
    """資料前處理設定檔模型（大包設定檔的 preprocess 區塊）。

    YAML 設定範例：
        preprocess:
          enabled: true
          columns:
            - column: 地址
              actions:
                - action: trim
                  params: { mode: edges }
                - action: slice
                  params: { side: left, count: 3 }
    """

    model_config = _STRICT_FIELDS

    columns: list[PreprocessColumn]
    # 與 K-匿名 ColumnConfig／DP DPColumnConfig 同一個欄位：一律寫在大包設定檔的根層，
    # 由拆袋子時灌進這一層（其餘三種設定亦然）。
    input_format: str | None = Field(None, description=INPUT_FORMAT_DESC)
    # 雜湊功能用的演算法：整份清單的預設值。
    # ★ TTC 2026-11-04：hash 動作的 params 可另給 algorithm 逐欄指定，沒給才用這裡的值。
    # 合法值與對照表在 app.engines.anonymization.strategies.masking，由引擎組裝動作時驗證。
    algorithm: str = Field(
        "sha3-256", description="雜湊演算法 sha256／sha3-256／sha3-512（未填→sha3-256）"
    )

    def validate_config(self):
        """設定檔自我檢查（純形狀，免比對資料，於解析時前置擋）。

        只驗「清單有東西、欄位名稱與功能名稱不是空白」；功能名稱認不認得、參數合不合法
        屬各功能自己的事，於引擎組裝時（仍在動到資料之前）檢查。
        """
        if not self.columns:
            raise PetsError(
                "ERR_CONFIG_INVALID",
                "前處理清單是空的：請至少列一列「欄位＋要做的動作」。",
            )
        for idx, entry in enumerate(self.columns):
            where = f"前處理清單第 {idx + 1} 列"
            if not entry.column.strip():
                raise PetsError(
                    "ERR_CONFIG_INVALID", f"{where}的 column 是空白字串。"
                )
            if not entry.actions:
                raise PetsError(
                    "ERR_CONFIG_INVALID",
                    f"{where}（欄位 '{entry.column}'）沒有列任何動作。",
                )
            for pos, spec in enumerate(entry.actions):
                if not spec.action.strip():
                    raise PetsError(
                        "ERR_CONFIG_INVALID",
                        f"{where}（欄位 '{entry.column}'）第 {pos + 1} 個動作的 action 是空白字串。",
                    )


class _UniqueKeySafeLoader(yaml.SafeLoader):
    """SafeLoader 變體：mapping 出現重複 key 直接報錯，而非 PyYAML 預設的「靜默後者覆蓋」。

    config 為人手寫，重複欄名（不小心貼兩次、第二次還定義錯）若被靜默覆蓋，使用者永不知情；
    這是最該告知的靜默決定，故在解析階段就擋下。

    另擋下 YAML 的錨點與別名：別名在解析後是共用同一個物件，本身不佔記憶體，
    但後續逐項走訪設定內容的程式（如切箱定義）並不知情，會把同一份資料重複走過
    天文數字次，少量文字即可讓服務長時間無回應。設定檔沒有使用別名的正當需求，
    故在解析階段就拒絕，不必等到走訪時才發現。
    """

    def compose_node(self, parent, index):
        if self.check_event(yaml.AliasEvent):
            raise yaml.YAMLError(
                "設定檔不支援 YAML 錨點與別名（& 與 *），請改用展開後的完整寫法。"
            )
        return super().compose_node(parent, index)

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in seen:
                raise ValueError(f"設定檔有重複的鍵 '{key}'，請移除重複定義後重試。")
            seen.add(key)
        return super().construct_mapping(node, deep)


def _reject_dup_json_pairs(pairs):
    """json object_pairs_hook：重複 key 報錯（JSON 預設同樣是後者靜默覆蓋）。"""
    seen = {}
    for k, v in pairs:
        if k in seen:
            raise ValueError(f"設定檔有重複的鍵 '{k}'，請移除重複定義後重試。")
        seen[k] = v
    return seen


def _load_config_no_dup(text: str, ext: str) -> Any:
    """依副檔名解析文字為資料結構，並拒絕重複 key（各種 config 共用）。

    這一層只負責「讀不讀得懂」：副檔名不收＝415、語法壞掉或重複鍵＝400。
    內容講不講得通留給 _build_config 判定（422），兩者對整合方是不同的修法。
    """
    if ext not in (".yaml", ".yml", ".json"):
        raise PetsError(
            "ERR_UNSUPPORTED_CONFIG_FORMAT",
            f"不支援的設定檔格式：「{ext or '無'}」。請使用 YAML（.yaml／.yml）或 JSON（.json）。",
        )
    try:
        if ext == ".json":
            return json.loads(text, object_pairs_hook=_reject_dup_json_pairs)
        return yaml.load(text, Loader=_UniqueKeySafeLoader)
    except yaml.YAMLError as e:
        raise PetsError(
            "ERR_CONFIG_MALFORMED", f"設定檔 YAML 語法錯誤，無法解析：{e}"
        ) from e
    except json.JSONDecodeError as e:
        raise PetsError(
            "ERR_CONFIG_MALFORMED", f"設定檔 JSON 語法錯誤，無法解析：{e}"
        ) from e
    except ValueError as e:
        # 重複鍵由 loader 掛鉤（_UniqueKeySafeLoader／_reject_dup_json_pairs）拋出
        raise PetsError("ERR_CONFIG_MALFORMED", str(e)) from e


def _decode_config_bytes(content: bytes) -> str:
    """設定檔 bytes 轉文字：非 UTF-8 屬「讀不懂」，比照語法錯誤回 400。"""
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError as e:
        raise PetsError(
            "ERR_CONFIG_MALFORMED",
            "設定檔不是 UTF-8 編碼，無法解讀，請另存為 UTF-8 後重試。",
        ) from e


def _build_config[ConfigT: BaseModel](model_cls: type[ConfigT], data: Any) -> ConfigT:
    """由已解析的資料結構建立設定物件並跑自我檢查（各種 config 共用同一套錯誤分類）。

    走到這裡代表語法已經讀得懂，剩下的都是「內容講不通」＝422。各 validate_config
    自己拋的 PetsError 已帶專屬錯誤碼（如 ERR_DP_INVALID_BUDGET），原樣放行不覆蓋；
    只有沒帶碼的（pydantic 欄位驗證、泛化層級等純值檢查）才收斂成 ERR_CONFIG_INVALID。
    """
    try:
        config = model_cls(**data)
        config.validate_config()
    except PetsError:
        raise
    except ValidationError as e:
        raise PetsError("ERR_CONFIG_INVALID", _format_validation_error(e)) from e
    except (TypeError, ValueError) as e:
        raise PetsError("ERR_CONFIG_INVALID", str(e)) from e
    return config


def _format_validation_error(err: ValidationError) -> str:
    """把 pydantic 的錯誤清單整理成一句人看得懂的話（保留欄位位置與原因）。"""
    parts: list[str] = []
    for item in err.errors():
        loc = "→".join(str(x) for x in item.get("loc", ())) or "設定檔"
        msg = str(item.get("msg", "")).replace("Value error, ", "")
        parts.append(f"{loc}：{msg}")
    return "設定檔內容不合法。" + "；".join(parts)


# ── 大包設定檔（bundled config）：一份檔案描述一次處理 ──────────────────────────
#
# 整合方只送「一包設定檔 ＋ 要處理的資料」，故各種功能的設定合成同一份檔案：
# 根層放共通欄位，五個平行區塊各裝一種功能的設定，每個區塊以 enabled 表明這次用不用它。
# 端點只拆自己要用的區塊，關掉或整塊省略的一律連內容都不看——只想跑 K-匿名的人，
# 不必為了通過驗證把差分隱私、風險與前處理各塊也填成合法內容。
#
# 每個區塊的內容即對應設定類別的欄位；風險依用途分成兩塊（三攻擊要十個欄位、
# CAP 只要四個），兩者是同一個 RiskConfig 的兩張欄位白名單。

BLOCK_K_ANONYMITY = "k_anonymity"
BLOCK_DP = "differential_privacy"
BLOCK_RISK_ATTACKS = "risk_attacks"
BLOCK_RISK_CAP = "risk_cap"
BLOCK_PREPROCESS = "preprocess"

# 根層欄位：version／dataset 只是標記這份設定檔是哪一份，不參與運算（version 另會寫進
# 稽核紀錄，事後才查得到某次處理是用哪一版設定檔跑的）；input_format 是每種功能都要
# 用到的唯一欄位，故提到根層，區塊內不得再寫一次。
ROOT_FIELDS = ("version", "dataset", "input_format")

# 區塊名 → (要建的設定類別, 該區塊收的欄位, 給人看的名稱)。
# 欄位清單不含 input_format：它一律寫在根層，由拆袋子時灌進來。
_BLOCK_SPECS: dict[str, tuple[type[BaseModel], tuple[str, ...], str]] = {
    BLOCK_K_ANONYMITY: (
        ColumnConfig,
        (
            "columns",
            "generalization_hierarchies",
            "generalization_matrices",
            "qi_generalization_levels",
            "k",
            "l",
            "t",
            "suppression_limit_percent",
            "limit_exceeded_action",
            "suppression_method",
            "cell_fill",
            "algorithm",
        ),
        "K-匿名化",
    ),
    BLOCK_DP: (
        DPColumnConfig,
        ("column_budgets", "accumulated_epsilon", "accumulated_delta", "default_delta"),
        "差分隱私",
    ),
    BLOCK_RISK_ATTACKS: (
        RiskConfig,
        (
            "columns",
            "linkability",
            "subgroup",
            "n_iter",
            "ctrl_ratio",
            "seed",
            "n_subset",
            "n_repeats",
            "overlap_ratio",
        ),
        "再識別風險三攻擊",
    ),
    BLOCK_RISK_CAP: (
        # CAP 不切分、不產 syn、沒有隨機性，七個實驗參數一個都用不到，故不收。
        RiskConfig,
        ("columns", "subgroup", "processed_format"),
        "再識別風險 CAP 前後對比",
    ),
    BLOCK_PREPROCESS: (
        PreprocessConfig,
        ("columns", "algorithm"),
        "資料前處理",
    ),
}

# 端點 → 必須開啟的區塊；其餘區塊開不開都不影響，故同一份設定檔可六個入口共用。
# 「這次要跑什麼」是呼叫的脈絡而非檔案的性質，故由呼叫端指名，不寫在設定檔裡。
ENDPOINT_REQUIRED_BLOCKS: dict[str, tuple[str, ...]] = {
    "k_anonymity": (BLOCK_K_ANONYMITY,),
    "dp": (BLOCK_DP,),
    "risk_k_anonymity": (BLOCK_RISK_ATTACKS, BLOCK_K_ANONYMITY),
    "risk_dp": (BLOCK_RISK_ATTACKS, BLOCK_DP),
    "risk_cap": (BLOCK_RISK_CAP,),
    "preprocess": (BLOCK_PREPROCESS,),
}

_ENDPOINT_LABELS: dict[str, str] = {
    "k_anonymity": "K-匿名化",
    "dp": "差分隱私",
    "risk_k_anonymity": "再識別風險三攻擊（K-匿名）",
    "risk_dp": "再識別風險三攻擊（差分隱私）",
    "risk_cap": "再識別風險 CAP 前後對比",
    "preprocess": "資料前處理",
}


@dataclass
class BundledConfigs:
    """大包設定檔拆出來的結果：只裝該次處理要用的區塊，其餘一律為 None。"""

    version: str | None = None
    dataset: str | None = None
    kanon: ColumnConfig | None = None
    dp: DPColumnConfig | None = None
    risk: RiskConfig | None = None
    preprocess: PreprocessConfig | None = None

    def audit_fields(self) -> dict[str, str]:
        """稽核紀錄要一併記下的設定檔識別資訊。

        設定檔版本寫進日誌，事後才查得到「這次處理是用哪一版設定檔跑的」。
        未宣告版本時整個欄位不寫，不在紀錄裡留一堆空值。
        """
        return {"config_version": self.version} if self.version else {}


def _require_config_dict(where: str, value: Any) -> dict:
    """設定檔的每一層都該是「名稱: 內容」的物件，不是就當場講明是哪一層不對。"""
    if not isinstance(value, dict):
        raise PetsError(
            "ERR_CONFIG_INVALID",
            f"{where}必須是「名稱: 內容」的物件，收到：{value}",
        )
    return value


def _reject_unknown_fields(where: str, data: dict, allowed: tuple[str, ...]) -> None:
    """不認識的欄位一律擋。

    靜默忽略的話，把 n_iter 打成 n_iterr 的人會以為自己設過了，卻拿到預設值跑出來的結果。
    """
    unknown = [key for key in data if key not in allowed]
    if unknown:
        raise PetsError(
            "ERR_CONFIG_INVALID",
            f"{where}有不認識的欄位 {unknown}；此處可用的欄位為 {list(allowed)}。",
        )


def _root_text(root: dict, key: str) -> str | None:
    """讀根層的文字欄位；未給回 None，給了就必須是非空字串。"""
    value = root.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise PetsError(
            "ERR_CONFIG_INVALID",
            f"設定檔根層的 {key} 必須是非空字串，收到：{value}",
        )
    return value.strip()


def _block_enabled(where: str, raw: Any) -> bool:
    """讀出區塊的開關：整塊省略＝不使用；寫了就必須有 enabled，且必須是 true／false。"""
    if raw is None:
        return False
    block = _require_config_dict(where, raw)
    if "enabled" not in block:
        raise PetsError(
            "ERR_CONFIG_INVALID",
            f"{where}缺少 enabled：每個區塊都要明講這次用不用它，不由系統代為判斷。",
        )
    flag = block["enabled"]
    if not isinstance(flag, bool):
        raise PetsError(
            "ERR_CONFIG_INVALID",
            f"{where}的 enabled 必須是 true 或 false，收到：{flag}",
        )
    return flag


def _unpack_bundle(data: Any, endpoint: str) -> BundledConfigs:
    """把大包設定檔拆成本次處理要用的設定物件（各處理入口共用同一份驗證）。

    順序是「驗根層欄位 → 驗本次要用的區塊有沒有開 → 根層輸入格式灌進區塊 →
    只把要用的區塊交給對應的設定類別建立」。用不到的區塊不進 _build_config，
    所以它寫什麼、enabled 是 true 還是 false，都不影響本次處理。

    同一份設定檔可以同時放六種處理的區塊，打哪個入口就取哪幾塊：
    K-匿名化取 k_anonymity，再識別風險（K-匿名）取 risk_attacks 與 k_anonymity，
    其餘區塊一律略過。
    """
    required = ENDPOINT_REQUIRED_BLOCKS[endpoint]
    feature = _ENDPOINT_LABELS[endpoint]
    root = _require_config_dict("設定檔最外層", data)
    _reject_unknown_fields("設定檔最外層", root, ROOT_FIELDS + tuple(_BLOCK_SPECS))

    input_format = _root_text(root, "input_format")
    where = {
        name: f"設定檔的 {label}（{name}）區塊"
        for name, (_, _, label) in _BLOCK_SPECS.items()
    }
    enabled = {
        name: _block_enabled(where[name], root.get(name)) for name in _BLOCK_SPECS
    }

    # 只檢查「這次要用的區塊有沒有開」；用不到的區塊開不開都不管。
    built: dict[str, Any] = {}
    for name in required:
        model_cls, fields, _ = _BLOCK_SPECS[name]
        if not enabled[name]:
            reason = (
                "設定檔沒有這個區塊"
                if root.get(name) is None
                else "該區塊的 enabled 為 false"
            )
            raise PetsError(
                "ERR_CONFIG_BLOCK_REQUIRED",
                f"{feature}需要{where[name]}，但{reason}。"
                f"請補上區塊內容並把 enabled 設為 true。",
            )
        block = {key: value for key, value in root[name].items() if key != "enabled"}
        _reject_unknown_fields(where[name], block, fields)
        if input_format is not None:
            block["input_format"] = input_format
        built[name] = _build_config(model_cls, block)

    return BundledConfigs(
        version=_root_text(root, "version"),
        dataset=_root_text(root, "dataset"),
        kanon=built.get(BLOCK_K_ANONYMITY),
        dp=built.get(BLOCK_DP),
        # 三攻擊與 CAP 不會同時出現在一次處理裡，故共用同一個欄位交給呼叫端使用
        risk=built.get(BLOCK_RISK_ATTACKS) or built.get(BLOCK_RISK_CAP),
        preprocess=built.get(BLOCK_PREPROCESS),
    )


def parse_bundled_config(path: str, endpoint: str) -> BundledConfigs:
    """從檔案路徑解析大包設定檔（供 CLI 使用）。"""
    text, ext = _read_config_text(path)
    return _unpack_bundle(_load_config_no_dup(text, ext), endpoint)


def parse_bundled_config_from_bytes(
    content: bytes, filename: str, endpoint: str
) -> BundledConfigs:
    """從 UploadFile 的 bytes 解析大包設定檔。

    供 API 層使用，不寫入磁碟，符合記憶體零留存原則。
    """
    _, ext = os.path.splitext(filename.lower())
    data = _load_config_no_dup(_decode_config_bytes(content), ext)
    return _unpack_bundle(data, endpoint)
