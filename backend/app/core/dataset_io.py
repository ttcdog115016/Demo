import io
import os
import re
import pandas as pd
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote

from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import DatabaseError

from app.core.cancellation import check_cancelled
from app.core.errors import PetsError

# 結果資料沿用輸入的格式輸出，故讀取時要一併帶回「輸入是哪一種格式」。
DatasetKind = Literal["csv", "json", "jsonl", "excel", "sqlite"]

# JSON 同一份資料有多種合法寫法（records 為每列一物件的陣列、columns 為以欄名為鍵），
# 讀進 DataFrame 後就看不出原本是哪一種，因此在讀取當下記下來，輸出時照原樣還原。
JsonOrient = Literal["records", "columns"]

_EXTENSION_BY_KIND: dict[DatasetKind, str] = {
    "csv": ".csv",
    "json": ".json",
    "jsonl": ".jsonl",
    "excel": ".xlsx",
    "sqlite": ".csv",  # 資料庫是輸入來源而非檔案格式，結果一律輸出 CSV
}

_MEDIA_TYPE_BY_KIND: dict[DatasetKind, str] = {
    "csv": "text/csv",
    "json": "application/json",
    "jsonl": "application/x-ndjson",
    "excel": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "sqlite": "text/csv",
}


@dataclass(frozen=True)
class DatasetFormat:
    """輸入資料集的格式，決定結果資料要用哪一種格式輸出。

    檔案輸入沿用同一種格式（CSV 進 CSV 出、Excel 進 Excel 出、JSON 進 JSON 出）；
    資料庫輸入沒有對應的「輸出成資料庫」語意——寫回來源會蓋掉尚未去識別化的原始
    資料，且需要來源端的寫入權限——故一律輸出 CSV，與各家資料庫工具的匯出慣例一致。
    """

    kind: DatasetKind
    json_orient: JsonOrient | None = None
    json_lines: bool = False

    @property
    def output_extension(self) -> str:
        return _EXTENSION_BY_KIND[self.kind]

    @property
    def media_type(self) -> str:
        return _MEDIA_TYPE_BY_KIND[self.kind]


CSV_FORMAT = DatasetFormat(kind="csv")

# 檔案內容本身能表達的格式。資料庫不在其中——它是連線來源而非一種檔案長相，
# 只有吃路徑的入口收得到（CLI 的 --input、API 的 source 表單欄位），
# 吃上傳位元組的入口收不到。
_FILE_KINDS: frozenset[str] = frozenset({"csv", "json", "jsonl", "excel"})
_PATH_KINDS: frozenset[str] = _FILE_KINDS | {"sqlite"}

def _kind_from_extension(name: str) -> DatasetKind:
    """由副檔名判定輸入格式；認不得就擋，不猜。"""
    _, ext = os.path.splitext(name.lower())
    if ext == ".csv":
        return "csv"
    if ext == ".json":
        return "json"
    if ext == ".jsonl":
        return "jsonl"
    if ext == ".xlsx":
        return "excel"
    raise PetsError(
        "ERR_UNSUPPORTED_FILE_FORMAT",
        f"不支援的檔案格式：「{ext or '無'}」。請使用 CSV、JSON、JSONL 或 Excel（.xlsx）。"
        "若檔案沒有副檔名，請改以輸入格式參數明確指定。",
    )


def _kind_from_declared(declared: str, allowed: frozenset[str]) -> DatasetKind:
    """由呼叫端明講的格式判定；不在該入口的合法值之內就擋。

    合法值隨入口而異（見 _FILE_KINDS／_PATH_KINDS），故由呼叫端傳入而非寫死。
    """
    kind = declared.strip().lower()
    if kind in allowed:
        return kind  # type: ignore[return-value]
    if kind == "sqlite":
        raise PetsError(
            "ERR_UNSUPPORTED_FILE_FORMAT",
            "此入口不接受 sqlite：收到的是上傳的檔案內容，沒有資料庫連線可用。"
            "資料庫來源請改以連線字串指定（API 為 source 表單欄位、CLI 為 --input）。",
        )
    raise PetsError(
        "ERR_UNSUPPORTED_FILE_FORMAT",
        f"不支援的資料格式「{declared}」。請使用 {'、'.join(sorted(allowed))}。",
    )


def declared_format_conflict(name: str, input_format: str | None) -> str | None:
    """指定格式與副檔名判定不同時，回一句告知；相符或無從比較時回 None。

    指定的格式一律優先（明講的意圖勝過由檔名推測），但覆蓋掉推測結果這件事本身
    要讓使用者看得到，否則副檔名寫錯時會拿到一份自己沒預期的輸出格式。副檔名
    認不得時不告知——那正是本參數要解決的情境，沒有「被覆蓋」可言。
    """
    if not input_format:
        return None
    try:
        by_extension = _kind_from_extension(name)
    except PetsError:
        return None
    declared = input_format.strip().lower()
    if declared == by_extension:
        return None
    return (
        f"輸入格式已指定為「{declared}」，與副檔名判定的「{by_extension}」不同，"
        f"依指定的格式讀取，結果資料也以「{declared}」輸出。"
    )


def _peek_json_orient(head: bytes) -> JsonOrient:
    """以第一個非空白字元判斷 JSON 的寫法：陣列為 records，物件為 columns。"""
    return "records" if head.lstrip()[:1] == b"[" else "columns"


def _unreadable(reason: str) -> PetsError:
    """資料檔本身讀不懂：屬呼叫方送來的內容有問題，一律講明原因，不外露函式庫的原文。"""
    return PetsError("ERR_DATASET_UNREADABLE", f"資料檔無法讀取：{reason}")


_CSV_FIELD_COUNT = re.compile(r"Expected (\d+) fields in line (\d+), saw (\d+)")

# 0 開頭且後面還接數字（09007、-01），即代碼而非數值；單獨的 0 與 0.5 不算。
_LEADING_ZERO = r"^\s*[+-]?0\d"


def _keep_leading_zero_columns(
    df: pd.DataFrame, source: str | io.BytesIO, encoding: str
) -> pd.DataFrame:
    """被讀成數字、但原文有 0 開頭值的欄位，換回原文字。

    CSV 不帶型別，pandas 看到全是數字就轉成數值，09007 會變成 9007（縣市、村里、
    郵遞區號等代碼皆然），輸出即與原始資料不同。比照 R readr 的判斷：整欄只要有一格
    0 開頭，整欄當文字。只重讀數值欄來比對，其餘欄位與數值結果維持 pandas 原本的判斷。
    """
    positions = [
        i
        for i, col in enumerate(df.columns)
        if pd.api.types.is_numeric_dtype(df[col]) and not pd.api.types.is_bool_dtype(df[col])
    ]
    if not positions:
        return df
    if isinstance(source, io.BytesIO):
        source.seek(0)
    # 以欄位位置對應，避免重複欄名被 pandas 改名後對不上
    text = pd.read_csv(
        source, encoding=encoding, usecols=positions, dtype=str, low_memory=False
    )
    for pos, col in zip(positions, text.columns):
        # 只比對相異值：代碼欄重複值多（500 萬筆村里代碼僅 7,748 種），逐格比對徒增耗時
        distinct = pd.Series(text[col].dropna().unique())
        if distinct.str.match(_LEADING_ZERO).any():
            df.isetitem(pos, text[col])
    return df


def _read_csv(source: str | io.BytesIO) -> pd.DataFrame:
    """支援 UTF-8、BOM-UTF-8 與 Big5 自動降級。"""
    for encoding in ("utf-8", "utf-8-sig", "big5"):
        try:
            if isinstance(source, io.BytesIO):
                source.seek(0)
            # low_memory=False：整欄讀完才決定型別。預設會分批各自判斷，同一欄可能一批
            # 是數字、另一批是文字（例如夾了一格 *），同值被當成兩種而分到不同組。
            df = pd.read_csv(source, encoding=encoding, low_memory=False)
            return _keep_leading_zero_columns(df, source, encoding)
        except UnicodeDecodeError as exc:
            if encoding == "big5":
                raise _unreadable(
                    "無法辨識文字編碼，請另存為 UTF-8 或 Big5 後重試。"
                ) from exc
        except pd.errors.EmptyDataError as exc:
            raise _unreadable("檔案沒有任何內容（連表頭都沒有）。") from exc
        except pd.errors.ParserError as exc:
            found = _CSV_FIELD_COUNT.search(str(exc))
            reason = (
                f"第 {found[2]} 行有 {found[3]} 個欄位，與表頭的 {found[1]} 個不一致。"
                if found
                else "CSV 格式錯誤，無法切分出欄位。"
            )
            raise _unreadable(reason) from exc
    raise AssertionError("unreachable")  # pragma: no cover


def _read_json(source: str | io.BytesIO, head: bytes) -> tuple[pd.DataFrame, JsonOrient, bool]:
    # ★ TTC 2026-11-02：關閉依欄名猜日期（*_at、timestamp、date…），不把整數代碼誤讀成時間戳
    """讀 JSON，並回報原本的寫法（orient 與是否為每行一筆）供輸出時還原。

    dtype=False：JSON 本身帶型別（"09007" 是字串、41 是數字），照檔案讀、不再推斷；
    預設的推斷會把字串 "09007" 轉成 9007。
    """
    try:
        if isinstance(source, io.BytesIO):
            source.seek(0)
        return pd.read_json(source, dtype=False, convert_dates=False, keep_default_dates=False), _peek_json_orient(head), False
    except ValueError:
        # 標準 JSON 解析失敗即視為 JSON Lines；此寫法只有「每行一筆」一種長相
        if isinstance(source, io.BytesIO):
            source.seek(0)
        try:
            return pd.read_json(source, lines=True, dtype=False, convert_dates=False, keep_default_dates=False), "records", True
        except ValueError as exc:
            raise _unreadable("內容不是合法的 JSON，也不是每行一筆的 JSON Lines。") from exc


def _read_excel(source: str | io.BytesIO) -> pd.DataFrame:
    """讀 Excel；檔案毀損或其實不是 .xlsx 時講明原因。

    此處只解析呼叫方給的檔案，解析過程的任何失敗都出自檔案內容本身，故一併收斂
    （記憶體不足除外——那是伺服器的問題，照原樣往上拋）。

    dtype=object：照儲存格本身的型別讀（文字格 "09007" 維持文字），再由 infer_objects
    把全為數字／日期的欄位收回對應型別；預設的推斷會把文字格 "09007" 轉成 9007。
    """
    try:
        return pd.read_excel(source, engine="openpyxl", dtype=object).infer_objects()
    except MemoryError:
        raise
    except Exception as exc:
        raise _unreadable("Excel 檔已毀損，或不是 .xlsx 格式。") from exc


def _require_file(path: str) -> None:
    """資料檔路徑給錯屬呼叫方的輸入問題（比照設定檔路徑），不落入未預期錯誤。"""
    if not os.path.isfile(path):
        raise PetsError("ERR_INVALID_PARAM", f"資料檔不存在：{path}")


_SQLITE_PREFIX = "sqlite:///"


def _read_sqlite(url: str, table_name: str | None) -> pd.DataFrame:
    """讀 SQLite 的一張資料表；連線字串、檔案、資料表任一對不上都講明是哪一個。"""
    if not url.startswith(_SQLITE_PREFIX):
        raise PetsError(
            "ERR_INVALID_PARAM",
            f"SQLite 來源須寫成連線字串（如 sqlite:///data/x.db），收到：{url}",
        )
    if not table_name:
        raise PetsError(
            "ERR_INVALID_PARAM",
            "自 SQLite 讀取資料時，必須指定 table_name 參數。",
        )
    # 先確認檔案存在：SQLite 連到不存在的路徑會自動建一個空資料庫，不先擋會在伺服器上留下空檔
    db_path = url[len(_SQLITE_PREFIX):]
    if not os.path.isfile(db_path):
        raise PetsError("ERR_INVALID_PARAM", f"SQLite 資料庫檔不存在：{db_path}")
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            if not inspect(conn).has_table(table_name):
                raise PetsError(
                    "ERR_INVALID_PARAM", f"SQLite 資料庫中沒有資料表 '{table_name}'。"
                )
            return pd.read_sql_table(table_name, conn)
    except DatabaseError as exc:
        raise _unreadable(f"{db_path} 不是有效的 SQLite 資料庫檔。") from exc
    finally:
        engine.dispose()


def load_dataset_with_format(
    path_or_conn: str, input_format: str | None = None, table_name: str | None = None
) -> tuple[pd.DataFrame, DatasetFormat]:
    """
    載入多格式資料集，並一併回報輸入格式（供結果資料沿用同一種格式輸出）。

    :param path_or_conn: 檔案路徑，或者 SQLite 連線字串 (例如 'sqlite:///mydb.db')
    :param input_format: 檔案格式 ('csv', 'json', 'jsonl', 'excel', 'sqlite')，未指定則依副檔名判定
    :param table_name: 當讀取資料庫時，需指定的資料表名稱
    :return: (pandas DataFrame, 輸入格式)
    """
    if input_format:
        kind = _kind_from_declared(input_format, _PATH_KINDS)
    elif path_or_conn.startswith(_SQLITE_PREFIX):
        kind = "sqlite"
    else:
        kind = _kind_from_extension(path_or_conn)

    if kind == "sqlite":
        return _read_sqlite(path_or_conn, table_name), DatasetFormat(kind="sqlite")

    _require_file(path_or_conn)

    if kind == "csv":
        return _read_csv(path_or_conn), DatasetFormat(kind="csv")

    if kind in ("json", "jsonl"):
        with open(path_or_conn, "rb") as f:
            head = f.read(64)
        df, orient, lines = _read_json(path_or_conn, head)
        return df, DatasetFormat(kind=kind, json_orient=orient, json_lines=lines)

    # kind == "excel"
    return _read_excel(path_or_conn), DatasetFormat(kind="excel")


def load_dataset(
    path_or_conn: str, input_format: str | None = None, table_name: str | None = None
) -> pd.DataFrame:
    """只取資料本身，供不需要沿用輸入格式的呼叫端（如再識別風險評估）使用。"""
    df, _ = load_dataset_with_format(path_or_conn, input_format, table_name)
    return df


def export_result(
    df: pd.DataFrame, path: str, fmt: DatasetFormat = CSV_FORMAT
) -> str:
    """
    將結果資料以 `fmt` 指定的格式匯出至指定路徑。

    格式取自輸入資料集而非輸出路徑的副檔名——輸出路徑是「放哪裡」，輸入格式才是
    「長什麼樣」；呼叫端給的路徑一律照用，不擅自改寫（副檔名對不上時由呼叫端告知）。

    :param df: 要匯出的 DataFrame
    :param path: 輸出路徑
    :param fmt: 輸出格式，未給時為 CSV
    :return: 儲存的絕對路徑
    """
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(dataframe_to_bytes(df, fmt))
    return os.path.abspath(path)


# ── 記憶體 I/O 工具（供 API 層使用，後端不寫磁碟）──────────────────────────


def load_dataframe_with_format(
    content: bytes, filename: str, input_format: str | None = None
) -> tuple[pd.DataFrame, DatasetFormat]:
    """
    從 UploadFile 的 bytes 讀取 DataFrame，並一併回報輸入格式（供結果資料沿用同一種
    格式回傳）。支援 .csv / .json / .jsonl / .xlsx

    :param input_format: 明講的輸入格式；未給則依副檔名判定。上傳的檔案不見得帶副檔名，
        此時副檔名判定無從下手，由呼叫端以此參數指定。給了就以它為準，不再看副檔名。
    """
    kind = (
        _kind_from_declared(input_format, _FILE_KINDS)
        if input_format
        else _kind_from_extension(filename)
    )
    buf = io.BytesIO(content)

    if kind == "csv":
        return _read_csv(buf), DatasetFormat(kind="csv")

    if kind in ("json", "jsonl"):
        df, orient, lines = _read_json(buf, content[:64])
        return df, DatasetFormat(kind=kind, json_orient=orient, json_lines=lines)

    # kind == "excel"（兩條判定路徑都已排除資料庫來源，上傳的檔案內容不會是 SQLite）
    return _read_excel(buf), DatasetFormat(kind="excel")


def load_dataframe_from_bytes(
    content: bytes, filename: str, input_format: str | None = None
) -> pd.DataFrame:
    """從 bytes 讀取 DataFrame，只取資料本身、不回報輸入格式。"""
    df, _ = load_dataframe_with_format(content, filename, input_format)
    return df


_INT64_MAX = 2**63 - 1


def _integral_floats_as_int(df: pd.DataFrame) -> pd.DataFrame:
    """浮點欄的值若全為整數，改以整數寫出（45.0 → 45），空值照留空。

    整數欄只要有一格空值，pandas 讀入時就整欄轉成浮點數，原樣寫出會變成 30.0。
    只改輸出的寫法、不動運算過程；含小數的欄位與轉不成整數者（如超出整數範圍）維持原樣。
    """
    out = df
    for col in df.columns:
        series = df[col]
        if not pd.api.types.is_float_dtype(series):
            continue
        values = series.dropna()
        if values.empty or not (values % 1 == 0).all() or values.abs().max() > _INT64_MAX:
            continue
        try:
            converted = series.astype("Int64")
        except (TypeError, ValueError, OverflowError):
            continue
        if out is df:
            out = df.copy(deep=False)  # 淺複製即可：只換掉欄位，不改呼叫端手上的資料
        out[col] = converted
    return out


def dataframe_to_bytes(df: pd.DataFrame, fmt: DatasetFormat = CSV_FORMAT) -> bytes:
    """
    將 DataFrame 依 `fmt` 序列化為 bytes，供寫檔與 StreamingResponse 共用。

    JSON 明確指定以 ISO 8601 寫日期（pandas 預設寫成 epoch 毫秒，會讓輸出的日期
    欄變成一串數字），並保留非 ASCII 字元原樣（預設會把中文跳脫成 \\uXXXX）。
    """
    check_cancelled()  # ★ TTC 2026-10-31：大檔序列化前最後一次可取消
    df = _integral_floats_as_int(df)
    if fmt.kind in ("json", "jsonl"):
        text = df.to_json(
            orient=fmt.json_orient,
            lines=fmt.json_lines,
            force_ascii=False,
            date_format="iso",
        )
        return (text or "").encode("utf-8")

    if fmt.kind == "excel":
        buf = io.BytesIO()
        df.to_excel(buf, index=False, engine="openpyxl")
        return buf.getvalue()

    return dataframe_to_csv_bytes(df)


def dataframe_to_csv_bytes(df: pd.DataFrame) -> bytes:
    """
    將 DataFrame 序列化為 UTF-8 CSV bytes，供 StreamingResponse 使用。
    """
    buf = io.StringIO()
    df.to_csv(buf, index=False, encoding="utf-8")
    return buf.getvalue().encode("utf-8")


# 回應主體的分塊大小：夠大以壓低每塊的固定成本，又不致一次佔用過多記憶體
RESPONSE_CHUNK_SIZE = 1024 * 1024


def iter_response_chunks(
    data: bytes, chunk_size: int = RESPONSE_CHUNK_SIZE
) -> Iterator[bytes]:
    """把整份回應內容切成固定大小的塊，供 StreamingResponse 逐塊送出。

    不直接把 io.BytesIO 交給 StreamingResponse：BytesIO 被迭代時是「一次一行」，
    而 StreamingResponse 對每一塊都會做一次執行緒往返，百萬列的 CSV 會被拆成百萬次
    傳送，傳輸時間遠超過去識別化本身的運算時間（17.6 MiB 逐行需 30 秒，分塊為
    0.02 秒）。分塊大小與資料列數無關，故不隨資料量放大。
    """
    for start in range(0, len(data), chunk_size):
        yield data[start : start + chunk_size]


# 標頭值不可出現的字元：控制字元（含換行，避免被塞進額外標頭）與會破壞引號的雙引號、反斜線
_UNSAFE_IN_HEADER = re.compile(r'[\x00-\x1f\x7f"\\]')


def content_disposition_attachment(filename: str) -> str:
    """組出下載用的 Content-Disposition 標頭值，讓中文等非 ASCII 檔名也能正常回傳。

    HTTP 標頭只放得下 latin-1，把檔名直接串進去的話，只要對方上傳的是中文檔名，
    資料都已經處理完、CSV 也產好了，卻會在送出回應的瞬間拋 UnicodeEncodeError 而變成
    500，整趟運算白費。台灣的來源資料用中文檔名是常態，故一律走這裡編碼。

    依 RFC 5987／6266 併陳兩份檔名：filename 放濾掉非 ASCII 字元的退路，只認得舊寫法的
    用戶端仍拿得到一個可存檔的名字；filename* 放 UTF-8 百分比編碼的原名，現代瀏覽器與
    HTTP 用戶端會優先採用，使用者存下來的就是原本的中文檔名。
    """
    cleaned = _UNSAFE_IN_HEADER.sub("_", filename)

    # 中文檔名濾掉非 ASCII 後可能整個空掉，退路仍須有名字，故補上通用名再接原副檔名
    stem, ext = os.path.splitext(cleaned)
    ascii_stem = stem.encode("ascii", "ignore").decode("ascii").strip(" .")
    ascii_ext = ext.encode("ascii", "ignore").decode("ascii")
    ascii_name = f"{ascii_stem or 'download'}{ascii_ext}"

    quoted = quote(cleaned, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quoted}"
