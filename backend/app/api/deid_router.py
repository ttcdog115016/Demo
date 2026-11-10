"""去識別化端點：K-匿名化與差分隱私。

兩者都是「吃資料、回資料」：提供原始資料集與設定檔，處理後沿用輸入的格式串流
回傳，品質／預算報告放在回應標頭。資料集可上傳檔案，或改以連線字串指定伺服器
本機的資料庫來源（與 CLI 同一種分工，見 app.api.dataset_input）。依架構原則，
去識別化不會自動觸發再識別風險量測，那是 risk_router 的職責。
"""
import json

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.api.processing_guard import processing_operator
from app.api.compute import run_compute
from app.api.dataset_input import resolve_dataset
from app.core.config import parse_bundled_config_from_bytes
from app.core.defaults import resolve_kanon_defaults
from app.core.dataset_io import (
    content_disposition_attachment,
    dataframe_to_bytes,
    iter_response_chunks,
)
from app.core.settings import get_default_salt
from app.engines.anonymization import run_k_anonymity
from app.engines.dp import run_dp
from app.governance.audit import get_audit_logger

router = APIRouter(tags=["去識別化"])


@router.post("/k-anonymity")
async def api_k_anonymity(
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
        ..., description="設定檔 (YAML/JSON)，需開啟 k_anonymity 區塊"
    ),
    # 其餘參數一律隨設定檔提供，不另開表單欄位；鹽值為機密，只讀部署環境的 .env
):
    """
    K-匿名化端點。

    提供原始資料集與設定檔，執行去識別化後沿用輸入的格式串流回傳。
    資料集以 file 上傳，或以 source（＋SQLite 的 table）指定伺服器本機的來源，
    兩者擇一：都給或都不給皆擋。資料庫來源無對應的輸出格式語意，一律輸出 CSV。
    設定檔為一份大包：根層放輸入格式等共通欄位，k_anonymity 區塊放本功能的設定
    並將 enabled 設為 true，其餘區塊開啟與否不影響本次處理。
    k、抑制方式、輸入格式等參數全部寫在設定檔內，一份設定檔即可完整重現一次處理。
    品質報告（suppression_rate_percent、建議等）附於 X-Quality-Report 回應標頭。
    資料僅於請求處理期間使用，不寫入伺服器磁碟。
    """
    # 鹽值只由部署者在 .env 設定，不接受呼叫端傳入：機密若隨設定檔或表單流動，
    # 會被存檔、納入版本控管、夾在交付包裡傳遞。未設定時不擋、改以無鹽雜湊照跑
    # （鹽為選填功能，加不加由部署者決定），本次加了沒有寫在品質報告裡。
    effective_salt = get_default_salt()

    with get_audit_logger().failures("k_anonymity"):
        # 先解析設定檔再讀資料：輸入格式寫在設定檔內，且設定檔本身的錯誤
        # 不必等資料讀完才發現（擋的檢查前置）。
        config_bytes = await config.read()
        cfgs = parse_bundled_config_from_bytes(
            config_bytes, config.filename, "k_anonymity"
        )
        col_config = cfgs.kanon

        data = await resolve_dataset(
            file=file,
            source=source,
            table=table,
            input_format=col_config.input_format,
            file_field="file",
            source_field="source",
            table_field="table",
        )
        df, dataset_format = data.df, data.fmt

        # 邊界層預設 resolve（設定檔未填→內建預設），並記錄 applied_defaults（報告透明）。
        # 四個入口（API／CLI × 去識別／風險評估）共用同一份決議，見 app.core.defaults
        d = resolve_kanon_defaults(
            col_config.k,
            col_config.suppression_limit_percent,
            col_config.limit_exceeded_action,
            col_config.suppression_method,
            col_config.cell_fill,
        )
        applied_defaults = d.notes
        # 註：salt 的 .env 設定屬「部署者設定」而非「系統採用的預設值」，故不列入
        # applied_defaults（此清單只放系統替使用者選的預設值）；有無加鹽另見報告的 hash_salted。

        def compute():
            # 泛化層級一律取自設定檔（col_config.qi_generalization_levels），呼叫端不覆蓋
            df_out, report = run_k_anonymity(
                df=df,
                config=col_config,
                k=d.k,
                l=col_config.l,
                t=col_config.t,
                suppression_limit_percent=d.suppression_limit_percent,
                limit_exceeded_action=d.limit_exceeded_action,
                salt_key=effective_salt,
                suppression_method=d.suppression_method,
                cell_fill=d.cell_fill,
            )
            # 沿用輸入格式序列化為 bytes，不落地磁碟
            return dataframe_to_bytes(df_out, dataset_format), report

        result_bytes, report = await run_compute(request, compute)
        # 邊界層預設（k／抑制）補在引擎偵測（bin_size）之前，一起呈現
        report.applied_defaults = applied_defaults + report.applied_defaults

        get_audit_logger().log_operation(
            "k_anonymity",
            "success",
            {
                "dataset": data.origin,
                "k": d.k,
                "suppression_rate_percent": report.suppression_rate_percent,
                **cfgs.audit_fields(),
            },
            user=processing_operator(request),
        )

        # 品質報告放入回應標頭；HTTP 標頭只收 latin-1，ensure_ascii=True 把中文跳脫成 \uXXXX
        headers = {
            "X-Quality-Report": json.dumps(report.to_dict(), ensure_ascii=True),
            "Content-Disposition": content_disposition_attachment(
                f"anonymized_{data.name}"
            ),
        }
        return StreamingResponse(
            iter_response_chunks(result_bytes),
            media_type=dataset_format.media_type,
            headers=headers,
        )


@router.post("/dp")
async def api_dp(
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
        ..., description="設定檔 (YAML/JSON)，需開啟 differential_privacy 區塊"
    ),
    # 逐欄預算與全域參數（accumulated_*／default_delta）一律由設定檔提供，不另開表單欄位
):
    """
    差分隱私端點。

    提供原始資料集與設定檔，加噪後沿用輸入的格式串流回傳。
    資料集以 file 上傳，或以 source（＋SQLite 的 table）指定伺服器本機的來源，
    兩者擇一：都給或都不給皆擋。資料庫來源無對應的輸出格式語意，一律輸出 CSV。
    設定檔為一份大包：逐欄預算放 differential_privacy 區塊並將 enabled 設為 true，
    其餘區塊開啟與否不影響本次處理。
    累計預算、全域 δ、輸入格式等參數全部寫在設定檔內。
    預算報告（消耗/累計/逐欄明細）附於 X-Budget-Report 回應標頭。
    資料僅於請求處理期間使用，不寫入伺服器磁碟。
    """
    with get_audit_logger().failures("dp"):
        # 先解析設定檔再讀資料（同 /k-anonymity）：純 config 的值域/型別衝突
        # 於解析時即 fail fast（擋的檢查前置）
        config_bytes = await config.read()
        cfgs = parse_bundled_config_from_bytes(config_bytes, config.filename, "dp")
        dp_config = cfgs.dp

        data = await resolve_dataset(
            file=file,
            source=source,
            table=table,
            input_format=dp_config.input_format,
            file_field="file",
            source_field="source",
            table_field="table",
        )
        df, dataset_format = data.df, data.fmt

        # 欄名存在性、型別相符等需比對資料的前置驗證在引擎入口（BudgetValidator），
        # 不合法會拋帶錯誤碼的 PetsError，由 app.api.errors 的處理器統一轉成回應。
        def compute():
            df_out, report = run_dp(
                df,
                dp_config,
                accumulated_epsilon=dp_config.accumulated_epsilon,
                accumulated_delta=dp_config.accumulated_delta,
                default_delta=dp_config.default_delta,
            )
            return dataframe_to_bytes(df_out, dataset_format), report

        result_bytes, report = await run_compute(request, compute)

        get_audit_logger().log_operation(
            "dp",
            "success",
            {
                "dataset": data.origin,
                "consumed_epsilon": report.consumed_epsilon,
                **cfgs.audit_fields(),
            },
            user=processing_operator(request),
        )

        headers = {
            "X-Budget-Report": json.dumps(report.to_dict(), ensure_ascii=True),
            "Content-Disposition": content_disposition_attachment(
                f"dp_{data.name}"
            ),
        }
        return StreamingResponse(
            iter_response_chunks(result_bytes),
            media_type=dataset_format.media_type,
            headers=headers,
        )
