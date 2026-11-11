"""API 層的資料來源解析：上傳檔案與 SQLite 連線字串二擇一。

CLI 的輸入一律是字串（`--input` 同時收檔案路徑與 `sqlite:///…`），故單一參數即可；
API 的上傳是 multipart 的檔案欄位、連線字串是文字欄位，兩者型別不同必須分開宣告。
本模組把「兩個欄位擇一」收斂成同一個回傳形狀，六個端點共用同一段檢查與同一則訊息。

連線字串指的是伺服器本機的路徑（SQLite 是檔案不是伺服器，沒有主機、埠號與帳密），
服務包在容器內時須寫容器內的路徑，且路徑基準為容器的工作目錄。
"""
import os
from dataclasses import dataclass

import pandas as pd
from fastapi import UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.dataset_io import (
    DatasetFormat,
    load_dataframe_with_format,
    load_dataset_with_format,
)
from app.core.errors import PetsError
from app.core.settings import ALLOWED_SOURCE_DIRS_ENV, get_allowed_source_dirs, get_data_dir

_SQLITE_PREFIX = "sqlite:///"


@dataclass(frozen=True)
class ResolvedDataset:
    """一份已讀進記憶體的資料集，以及它從哪裡來。

    origin 供稽核紀錄（上傳檔名，或「連線字串#資料表」）；name 供下載檔名，
    資料庫來源沒有原始檔名可沿用，故以資料表名加上輸出副檔名充當。
    """

    df: pd.DataFrame
    fmt: DatasetFormat
    origin: str
    name: str


def _is_sqlite(source: str, input_format: str | None) -> bool:
    """判定連線字串是否指向 SQLite；判定順序與 load_dataset_with_format 一致。

    明講的格式優先於前綴推測——設定檔寫了 input_format 就以它為準。
    """
    if input_format:
        return input_format.strip().lower() == "sqlite"
    return source.startswith(_SQLITE_PREFIX)


def _is_within(path: str, root: str) -> bool:
    try:
        return os.path.commonpath([path, root]) == root
    except ValueError:  # Windows 不同磁碟機
        return False


def _require_allowed_source(source: str, source_field: str) -> None:
    """★ TTC 2026-10-30：source 只能指向部署者開放的目錄，且一律不得落在系統資料目錄。

    未限制時，任何登入者都能把使用者資料庫（密碼雜湊、refresh token）、系統資料庫
    或稽核日誌當成資料集讀出來。路徑先解析符號連結與「..」再比對，避免繞道。
    """
    allowed = get_allowed_source_dirs()
    if not allowed:
        raise PetsError(
            "ERR_FORBIDDEN",
            f"此伺服器未開放以 {source_field} 讀取本機資料來源，請改以上傳檔案提供資料"
            f"（部署者可以環境變數 {ALLOWED_SOURCE_DIRS_ENV} 開放特定目錄）。",
        )
    raw = source[len(_SQLITE_PREFIX):] if source.startswith(_SQLITE_PREFIX) else source
    path = os.path.realpath(raw)
    if _is_within(path, os.path.realpath(get_data_dir())) or not any(
        _is_within(path, root) for root in allowed
    ):
        raise PetsError(
            "ERR_FORBIDDEN", f"{source_field} 指向的路徑不在允許讀取的資料目錄內。"
        )


async def resolve_dataset(
    *,
    file: UploadFile | None,
    source: str | None,
    table: str | None,
    input_format: str | None,
    file_field: str,
    source_field: str,
    table_field: str,
) -> ResolvedDataset:
    """取得一份資料集：上傳的檔案內容，或伺服器本機的資料來源，二擇一。

    三個 *_field 是端點實際採用的表單欄位名，只用於組錯誤訊息——CAP 同時收兩份
    資料，欄位名各帶前綴（original_source／processed_source），訊息須指名是哪一份。

    :param file: 上傳的資料集，未提供時為 None
    :param source: 資料來源連線字串（如 sqlite:////data/x.db）
    :param table: source 指向 SQLite 時的資料表名稱
    :param input_format: 設定檔宣告的輸入格式，未宣告則由副檔名或前綴判定
    :return: 資料、輸入格式、稽核用來源標示與下載用檔名
    """
    if file is not None and source:
        raise PetsError(
            "ERR_INVALID_PARAM",
            f"{file_field} 與 {source_field} 只能擇一提供："
            f"{file_field} 是上傳的檔案內容，{source_field} 是伺服器本機的資料來源。",
        )
    if file is None and not source:
        raise PetsError(
            "ERR_INVALID_PARAM",
            f"必須提供 {file_field}（上傳資料集）或 {source_field}"
            f"（資料來源連線字串，如 sqlite:////data/x.db）其中之一。",
        )

    if file is not None:
        content = await file.read()
        # 大檔解析可能要數十秒（還可能依編碼重讀），丟執行緒池以免卡住事件迴圈
        df, fmt = await run_in_threadpool(
            load_dataframe_with_format, content, file.filename, input_format
        )
        return ResolvedDataset(df=df, fmt=fmt, origin=file.filename, name=file.filename)

    _require_allowed_source(source, source_field)

    # 缺資料表名擋在連線之前（擋的檢查前置）。此處自行檢查而非交給 dataset_io，
    # 是因為訊息要指名本端點的欄位名，各端點的欄位名不同。
    if _is_sqlite(source, input_format) and not table:
        raise PetsError(
            "ERR_INVALID_PARAM",
            f"{source_field} 為 SQLite 連線字串時，必須一併提供 {table_field}（資料表名稱）。",
        )

    df, fmt = await run_in_threadpool(load_dataset_with_format, source, input_format, table)
    origin = f"{source}#{table}" if table else source
    return ResolvedDataset(
        df=df,
        fmt=fmt,
        origin=origin,
        name=f"{table or 'dataset'}{fmt.output_extension}",
    )


__all__ = ["ResolvedDataset", "resolve_dataset"]
