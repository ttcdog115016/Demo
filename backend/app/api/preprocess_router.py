"""資料前處理端點。

與去識別化兩個端點同一種形狀：吃資料、回資料——提供原始資料集與設定檔，
依清單由上往下處理後沿用輸入的格式串流回傳。資料集可上傳檔案，或改以連線字串
指定伺服器本機的資料庫來源（與 CLI 同一種分工，見 app.api.dataset_input）。

沒有報告標頭：前處理只改資料、不產統計，故無 K-匿名的 X-Quality-Report、
差分隱私的 X-Budget-Report 之對應物。
"""
from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.processing_guard import processing_operator
from app.api.compute import run_compute
from app.api.dataset_input import resolve_dataset
from app.core.config import parse_bundled_config_from_bytes
from app.core.errors import PetsError
from app.core.settings import get_default_salt
from app.core.dataset_io import (
    content_disposition_attachment,
    dataframe_to_bytes,
    iter_response_chunks,
)
from app.engines.anonymization.strategies.masking import hash_mask, validate_hash_algorithm
from app.engines.preprocess import run_preprocess
from app.engines.preprocess.actions.masking import TIMESTAMP_SALT_KEYWORD, resolve_hash_salt
from app.governance.audit import get_audit_logger

router = APIRouter(tags=["資料前處理"])

# ★ TTC 2026-11-04：雜湊預覽一次最多幾個值、每個值最長幾個字（只供畫面預覽，不是處理資料用）
HASH_PREVIEW_MAX_VALUES = 20
HASH_PREVIEW_MAX_LENGTH = 256


class HashPreviewRequest(BaseModel):
    values: list[str] = Field(..., max_length=HASH_PREVIEW_MAX_VALUES)
    algorithm: str = Field("sha3-256", max_length=20)
    salt: str | None = Field(None, max_length=1024, description="未給或空字串＝伺服器預設鹽值（同 hash 動作）")


@router.post("/preprocess/hash-preview")
def api_preprocess_hash_preview(body: HashPreviewRequest):
    """
    前處理雜湊的即時預覽（★ TTC 2026-11-04）。

    伺服器預設鹽值只在後端，前端算不出實際結果；此端點以與 hash 動作相同的鹽值規則
    （resolve_hash_salt）與雜湊函式（hash_mask）計算少量值，只回雜湊結果、不回鹽值。
    use_timestamp 的鹽要到實際處理時才取，無法預覽，一律擋下。
    不屬於處理端點（不記 run、不寫稽核紀錄），但仍須登入。
    """
    if body.salt == TIMESTAMP_SALT_KEYWORD:
        raise PetsError("ERR_PREPROCESS_PARAM_INVALID", "use_timestamp 的鹽於實際處理時才產生，無法預覽")
    if any(len(value) > HASH_PREVIEW_MAX_LENGTH for value in body.values):
        raise PetsError("ERR_PREPROCESS_PARAM_INVALID", f"預覽值每個最多 {HASH_PREVIEW_MAX_LENGTH} 字")
    algorithm = validate_hash_algorithm(body.algorithm)
    default_salt = get_default_salt()
    salt = default_salt if body.salt is None else resolve_hash_salt(body.salt, default_salt, "")
    return {"hashes": [hash_mask(value, salt, algorithm) if value != "" else "" for value in body.values]}


@router.post("/preprocess")
async def api_preprocess(
    request: Request,
    file: UploadFile | None = File(
        None, description="原始資料集 (CSV/JSON/JSONL/Excel)；與 source 二擇一"
    ),
    source: str | None = Form(
        None,
        description="伺服器本機的資料來源連線字串（如 sqlite:////data/x.db）；與 file 二擇一",
    ),
    table: str | None = Form(
        None, description="source 為 SQLite 連線字串時必填的資料表名稱"
    ),
    config: UploadFile = File(
        ..., description="設定檔 (YAML/JSON)，需開啟 preprocess 區塊"
    ),
    # 逐欄逐項的動作與參數一律隨設定檔提供，不另開表單欄位（同其他端點）
):
    """
    資料前處理端點。

    提供原始資料集與設定檔，依清單由上往下對指定欄位執行去空白、截斷、錨點截斷、
    型態轉換、文字正規化、丟棄缺失值、預設值填充、策略填充、上下界截斷、雜湊、
    正則替換共 11 項功能，每一步都用當下的資料，處理後沿用輸入的格式串流回傳。
    資料集以 file 上傳，或以 source（＋SQLite 的 table）指定伺服器本機的來源，
    兩者擇一：都給或都不給皆擋。資料庫來源無對應的輸出格式語意，一律輸出 CSV。
    設定檔為一份大包：欲處理的清單放 preprocess 區塊並將 enabled 設為 true，
    其餘區塊開啟與否不影響本次處理。
    清單引用的欄位名稱與各功能的參數都在動到資料之前檢查完畢。
    資料僅於請求處理期間使用，不寫入伺服器磁碟。
    """
    with get_audit_logger().failures("preprocess"):
        # 先解析設定檔再讀資料（同去識別化兩個端點）：輸入格式寫在設定檔內，
        # 且設定檔本身的錯誤不必等資料讀完才發現（擋的檢查前置）。
        config_bytes = await config.read()
        cfgs = parse_bundled_config_from_bytes(
            config_bytes, config.filename, "preprocess"
        )
        pp_config = cfgs.preprocess

        data = await resolve_dataset(
            file=file,
            source=source,
            table=table,
            input_format=pp_config.input_format,
            file_field="file",
            source_field="source",
            table_field="table",
        )
        df, dataset_format = data.df, data.fmt

        # 欄位名稱是否存在、參數是否合法皆由引擎在動到資料之前驗證，
        # 不合法會拋帶錯誤碼的 PetsError，由 app.api.errors 的處理器統一轉成回應。
        def compute():
            df_out = run_preprocess(df, pp_config)
            # 沿用輸入格式序列化為 bytes，不落地磁碟
            return dataframe_to_bytes(df_out, dataset_format)

        result_bytes = await run_compute(request, compute)

        get_audit_logger().log_operation(
            "preprocess",
            "success",
            {
                "dataset": data.origin,
                "columns": len(pp_config.columns),
                "actions": sum(len(entry.actions) for entry in pp_config.columns),
                **cfgs.audit_fields(),
            },
            user=processing_operator(request),
        )

        return StreamingResponse(
            iter_response_chunks(result_bytes),
            media_type=dataset_format.media_type,
            headers={
                "Content-Disposition": content_disposition_attachment(
                    f"preprocessed_{data.name}"
                )
            },
        )
