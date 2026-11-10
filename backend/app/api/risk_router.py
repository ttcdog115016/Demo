"""再識別風險量測端點：三攻擊（K-匿名／DP 兩種產 syn 方式）、CAP 前後對比、PDF 報告。

三攻擊與 CAP 只量測、不改資料；報告端點無狀態，呼叫方把前面拿到的報告原封帶回來即可。
量測用的資料集可上傳檔案，或改以連線字串指定伺服器本機的資料庫來源（見
app.api.dataset_input）；CAP 收前後兩份，兩份各自選來源，四種組合皆合法。
"""
import time

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.api.processing_guard import processing_operator
from app.api.compute import run_compute
from app.api.dataset_input import resolve_dataset
from app.core.config import parse_bundled_config_from_bytes
from app.core.defaults import resolve_kanon_defaults
from app.core.errors import PetsError
from app.core.dataset_io import (
    content_disposition_attachment,
    iter_response_chunks,
)
from app.core.settings import get_default_salt
from app.engines.risk import (
    empty_subgroup_attack_report,
    empty_subgroup_cap_report,
    run_attacks,
    run_cap,
    select_subgroup,
    subgroup_notes,
    subgroup_notes_before_after,
)
from app.engines.risk.types import AttackReport, CapReport
from app.governance.audit import get_audit_logger
from app.governance.report import generate_pdf_bytes

router = APIRouter(tags=["再識別風險"])


class ReportRequest(BaseModel):
    """PDF 報告請求：把風險端點回傳的報告原封帶回來（無狀態，呼叫方自帶結果）。

    attack_report／cap_report 至少要有一包；處理配置由 attack_report 內引擎親手回填的
    processing_config 帶出，故不需另行手打 method／params。
    """

    task_id: str = "risk-report"
    attack_report: AttackReport | None = None
    cap_report: CapReport | None = None


@router.post("/risk/k-anonymity")
async def api_risk_k_anonymity(
    request: Request,
    original: UploadFile | None = File(
        None, description="原始資料集（未去識別）；與 source 二擇一"
    ),
    source: str | None = Form(
        None,
        description="伺服器本機的資料來源連線字串（如 sqlite:////data/x.db）；與 original 二擇一",
    ),
    table: str | None = Form(
        None, description="source 為 SQLite 連線字串時必填的資料表名稱"
    ),
    config: UploadFile = File(
        ..., description="設定檔 (YAML/JSON)，需同時開啟 risk_attacks 與 k_anonymity 區塊"
    ),
    # 其餘參數一律隨設定檔提供，不另開表單欄位；鹽值為機密，只讀部署環境的 .env
):
    """
    三攻擊（K-匿名）端點。

    只需原始資料（以 original 上傳，或以 source＋table 指定伺服器本機的來源，
    兩者擇一），引擎自己「切 80/20 → 只對 80% 以 K-匿名去識別產 syn →
    20% 為 holdout → 跑指認性／連結性／推斷性三攻擊」，回三攻擊指標（不含 CAP）。
    設定檔為一份大包，本端點需要兩個區塊：risk_attacks 出攻擊角色、連結性 A／B、
    實驗參數與子群體，k_anonymity 出產 syn 用的泛化階層與 K-匿名參數；兩塊的
    enabled 都要設為 true，其餘區塊開啟與否不影響本次處理。兩塊各有自己的 columns，內容本來就不同
    （風險的 role 只收 quasi_identifier／sensitive，K-匿名收四值且帶 strategy），
    故欄位清單須各寫一份。
    子群體條件於自產 syn 前先對原始資料篩一次（處理前篩）。
    n_repeats>1 時反覆執行「切分→處理→評估」並回平均風險分數（規格 §3(1)A）。
    資料僅於請求處理期間使用，不寫入伺服器磁碟。
    """
    # 鹽值只讀 .env（同 /k-anonymity）：syn 由引擎呼叫 K-匿名產生，故此端點亦取鹽值。
    # 未設定時不擋、改以無鹽雜湊產 syn。
    start_time = time.time()
    effective_salt = get_default_salt()
    with get_audit_logger().failures("risk_k_anonymity"):
        # 先解析設定檔再讀資料：輸入格式與實驗參數都寫在設定檔內
        # （純 config 錯誤於解析時擋）；k_anonymity 區塊供 DeidBridge 自產 syn
        config_bytes = await config.read()
        cfgs = parse_bundled_config_from_bytes(
            config_bytes, config.filename, "risk_k_anonymity"
        )
        rc = cfgs.risk
        kanon_cfg = cfgs.kanon
        qi_cols = rc.qi_columns()
        s_cols = rc.sensitive_columns()
        link_a, link_b = rc.linkability_pair()

        data = await resolve_dataset(
            file=original,
            source=source,
            table=table,
            input_format=rc.input_format,
            file_field="original",
            source_field="source",
            table_field="table",
        )
        df_ori = data.df

        # K-匿名旋鈕邊界層預設 resolve（同 /k-anonymity），並記錄以供報告透明告知
        # 與 /k-anonymity 共用同一份決議（見 app.core.defaults）
        d = resolve_kanon_defaults(
            kanon_cfg.k,
            kanon_cfg.suppression_limit_percent,
            kanon_cfg.limit_exceeded_action,
            kanon_cfg.suppression_method,
            kanon_cfg.cell_fill,
        )
        applied_defaults = d.notes
        deid_params = {
            "k": d.k,
            "l": kanon_cfg.l,
            "t": kanon_cfg.t,
            "suppression_limit_percent": d.suppression_limit_percent,
            "limit_exceeded_action": d.limit_exceeded_action,
            "salt_key": effective_salt,
            "suppression_method": d.suppression_method,
            "cell_fill": d.cell_fill,
        }

        # 子群體前篩（處理前篩原始）：條件形狀不對＝400（解析時已擋）、欄位不存在＝422
        conditions = rc.subgroup_conditions()
        sub = select_subgroup(df_ori, conditions)
        # 篩不到＝空群：據實回降級收據告知前後筆數，不進引擎、不崩
        if sub.n_after == 0:
            return empty_subgroup_attack_report(sub).model_dump()

        report = await run_compute(
            request,
            run_attacks,
            original_df=sub.df,
            qi_cols=qi_cols,
            sensitive_cols=s_cols,
            method="k-anon",
            deid_config=kanon_cfg,
            deid_params=deid_params,
            n_iter=rc.n_iter,
            ctrl_ratio=rc.ctrl_ratio,
            seed=rc.seed,
            n_subset=rc.n_subset,
            link_cols_a=link_a,
            link_cols_b=link_b,
            n_repeats=rc.n_repeats,
            overlap_ratio=rc.overlap_ratio,
        )

        # 報告透明：系統套用的 K-匿名預設與子群體前後筆數一併寫入 message
        extra = list(applied_defaults)
        if conditions:
            extra += subgroup_notes(sub)
        if extra:
            report.message = report.message + " " + " ".join(extra)

        get_audit_logger().log_operation(
            "risk_k_anonymity",
            "success",
            {
                "original": data.origin,
                "singling_out_risk": report.singling_out_risk,
                "linkability_risk": report.linkability_risk,
                "inference_risk": report.inference_risk,
                **cfgs.audit_fields(),
            },
            user=processing_operator(request),
        )
        report.elapsed_seconds = round(time.time() - start_time, 2)
        return report.model_dump()


@router.post("/risk/dp")
async def api_risk_dp(
    request: Request,
    original: UploadFile | None = File(
        None, description="原始資料集（未去識別）；與 source 二擇一"
    ),
    source: str | None = Form(
        None,
        description="伺服器本機的資料來源連線字串（如 sqlite:////data/x.db）；與 original 二擇一",
    ),
    table: str | None = Form(
        None, description="source 為 SQLite 連線字串時必填的資料表名稱"
    ),
    config: UploadFile = File(
        ...,
        description="設定檔 (YAML/JSON)，需同時開啟 risk_attacks 與 differential_privacy 區塊",
    ),
    # 其餘參數一律隨設定檔提供，不另開表單欄位
):
    """
    三攻擊（DP）端點。

    只需原始資料（以 original 上傳，或以 source＋table 指定伺服器本機的來源，
    兩者擇一），引擎自己「切 80/20 → 只對 80% 以差分隱私加噪產 syn →
    20% 為 holdout → 跑指認性／連結性／推斷性三攻擊」，回三攻擊指標（不含 CAP）。
    與 K-匿名端點的差別僅在去識別方法：使用 differential_privacy 區塊、DP 無鹽值需求。
    子群體條件於自產 syn 前先對原始資料篩一次（處理前篩）。
    n_repeats>1 時反覆執行「切分→處理→評估」並回平均風險分數（規格 §3(1)A）。
    資料僅於請求處理期間使用，不寫入伺服器磁碟。
    """
    start_time = time.time()
    with get_audit_logger().failures("risk_dp"):
        # 先解析設定檔再讀資料（同 /risk/k-anonymity）；
        # differential_privacy 區塊的逐欄預算供 DeidBridge 自產 syn
        config_bytes = await config.read()
        cfgs = parse_bundled_config_from_bytes(config_bytes, config.filename, "risk_dp")
        rc = cfgs.risk
        dp_cfg = cfgs.dp
        qi_cols = rc.qi_columns()
        s_cols = rc.sensitive_columns()
        link_a, link_b = rc.linkability_pair()

        deid_params = {
            "accumulated_epsilon": dp_cfg.accumulated_epsilon,
            "accumulated_delta": dp_cfg.accumulated_delta,
            "default_delta": dp_cfg.default_delta,
        }

        data = await resolve_dataset(
            file=original,
            source=source,
            table=table,
            input_format=rc.input_format,
            file_field="original",
            source_field="source",
            table_field="table",
        )
        df_ori = data.df

        # 子群體前篩（處理前篩原始）：條件形狀不對＝400（解析時已擋）、欄位不存在＝422
        conditions = rc.subgroup_conditions()
        sub = select_subgroup(df_ori, conditions)
        # 篩不到＝空群：據實回降級收據告知前後筆數，不進引擎、不崩
        if sub.n_after == 0:
            return empty_subgroup_attack_report(sub).model_dump()

        report = await run_compute(
            request,
            run_attacks,
            original_df=sub.df,
            qi_cols=qi_cols,
            sensitive_cols=s_cols,
            method="dp",
            deid_config=dp_cfg,
            deid_params=deid_params,
            n_iter=rc.n_iter,
            ctrl_ratio=rc.ctrl_ratio,
            seed=rc.seed,
            n_subset=rc.n_subset,
            link_cols_a=link_a,
            link_cols_b=link_b,
            n_repeats=rc.n_repeats,
            overlap_ratio=rc.overlap_ratio,
        )

        # 報告透明：子群體前後筆數寫入 message
        if conditions:
            report.message = report.message + " " + " ".join(subgroup_notes(sub))

        get_audit_logger().log_operation(
            "risk_dp",
            "success",
            {
                "original": data.origin,
                "singling_out_risk": report.singling_out_risk,
                "linkability_risk": report.linkability_risk,
                "inference_risk": report.inference_risk,
                **cfgs.audit_fields(),
            },
            user=processing_operator(request),
        )
        report.elapsed_seconds = round(time.time() - start_time, 2)
        return report.model_dump()


@router.post("/risk/cap")
async def api_risk_cap(
    request: Request,
    original: UploadFile | None = File(
        None, description="原始資料集（未去識別）；與 original_source 二擇一"
    ),
    original_source: str | None = Form(
        None,
        description="原始資料集的伺服器本機來源連線字串（如 sqlite:////data/x.db）；與 original 二擇一",
    ),
    original_table: str | None = Form(
        None, description="original_source 為 SQLite 連線字串時必填的資料表名稱"
    ),
    processed: UploadFile | None = File(
        None, description="去識別後資料集（成品）；與 processed_source 二擇一"
    ),
    processed_source: str | None = Form(
        None,
        description="去識別後資料集的伺服器本機來源連線字串；與 processed 二擇一",
    ),
    processed_table: str | None = Form(
        None, description="processed_source 為 SQLite 連線字串時必填的資料表名稱"
    ),
    config: UploadFile = File(
        ..., description="設定檔 (YAML/JSON)，需開啟 risk_cap 區塊"
    ),
    # 其餘參數一律隨設定檔提供，不另開表單欄位；前後兩份的格式各自宣告——原始資料集的
    # 格式寫在根層 input_format，去識別後那份寫在 risk_cap 區塊的 processed_format
    # （兩份是不同來源的檔案、不保證同一種格式）
):
    """
    CAP 前後對比端點（§3(1)B）。

    需同時提供原始與去識別後兩份現成資料，引擎不做去識別，只各自算一次正確歸因機率並
    對比（cap_before／cap_after）。兩份各自以上傳或連線字串提供、互不相干，故上傳＋上傳、
    來源＋上傳、上傳＋來源、來源＋來源四種組合皆合法；同一份兩者都給或都不給則擋。
    子群體條件對前後兩份各篩一次（同一值條件）。
    設定檔為一份大包，本端點只用 risk_cap 區塊，其餘區塊開啟與否不影響本次處理。
    資料僅於請求處理期間使用，不寫入伺服器磁碟。
    """
    start_time = time.time()
    with get_audit_logger().failures("risk_cap"):
        # 先解析設定檔再讀兩份資料：兩份的輸入格式都寫在設定檔內
        config_content = await config.read()
        cfgs = parse_bundled_config_from_bytes(
            config_content, config.filename, "risk_cap"
        )
        rc = cfgs.risk
        qi_cols = rc.qi_columns()
        s_cols = rc.sensitive_columns()

        ori = await resolve_dataset(
            file=original,
            source=original_source,
            table=original_table,
            input_format=rc.input_format,
            file_field="original",
            source_field="original_source",
            table_field="original_table",
        )
        proc = await resolve_dataset(
            file=processed,
            source=processed_source,
            table=processed_table,
            input_format=rc.processed_format,
            file_field="processed",
            source_field="processed_source",
            table_field="processed_table",
        )
        df_ori = ori.df
        df_proc = proc.df

        # 子群體對前後各篩一次（值篩，不靠 index）：欄位不存在＝422
        conditions = rc.subgroup_conditions()
        sub_ori = select_subgroup(df_ori, conditions)
        sub_proc = select_subgroup(df_proc, conditions)
        # 原始子群體為空＝無基準可比，降級告知不爆
        if conditions and sub_ori.n_after == 0:
            return empty_subgroup_cap_report(sub_ori, sub_proc).model_dump()

        report = await run_compute(
            request,
            run_cap,
            original_df=sub_ori.df,
            processed_df=sub_proc.df,
            qi_cols=qi_cols,
            sensitive_cols=s_cols,
        )

        # 報告透明：子群體前後筆數與轉換備註寫入 message
        if conditions:
            extra = subgroup_notes_before_after(sub_ori, sub_proc)
            report.message = report.message + " " + " ".join(extra)

        get_audit_logger().log_operation(
            "risk_cap",
            "success",
            {
                "original": ori.origin,
                "processed": proc.origin,
                "cap_before": report.cap_before,
                "cap_after": report.cap_after,
                **cfgs.audit_fields(),
            },
            user=processing_operator(request),
        )
        report.elapsed_seconds = round(time.time() - start_time, 2)
        return report.model_dump()


@router.post("/report")
async def api_report(
    req: ReportRequest,
    request: Request,
):
    """彙整再識別風險量測結果、產出並下載 PDF 報告（規格 §3(4)）。

    無狀態：呼叫方把先前風險端點回傳的報告（attack_report／cap_report）原封帶回來，
    引擎只負責排版成 PDF、不回頭查任何伺服器狀態，PDF 亦不落地（StreamingResponse）。
    """
    if req.attack_report is None and req.cap_report is None:
        raise PetsError(
            "ERR_BAD_REQUEST",
            "attack_report 與 cap_report 至少須提供一包，否則無內容可產出報告。",
        )
    with get_audit_logger().failures("export_report"):
        try:
            # ★ TTC 2026-11-02：排版 PDF 是同步運算，原本直接在事件迴圈上跑，期間整台服務（含換發 token、
            #   取消運算）都停擺；改丟執行緒池。
            pdf_bytes = await run_in_threadpool(
                generate_pdf_bytes,
                task_id=req.task_id,
                attack_report=(
                    req.attack_report.model_dump() if req.attack_report else None
                ),
                cap_report=req.cap_report.model_dump() if req.cap_report else None,
            )
        except PetsError:
            raise
        except Exception as e:
            # 排版失敗（如缺少內建字型）屬伺服器自身問題，不是呼叫方能修的，維持 500。
            # from e 保留原始例外，伺服器端的追蹤記錄才看得到真正的失敗點。
            raise HTTPException(status_code=500, detail=f"PDF 產出失敗：{str(e)}") from e

        get_audit_logger().log_operation(
            "export_report", "success", {"task_id": req.task_id},
            user=processing_operator(request),
        )
        return StreamingResponse(
            iter_response_chunks(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": content_disposition_attachment(
                    f"risk_report_{req.task_id}.pdf"
                )
            },
        )
