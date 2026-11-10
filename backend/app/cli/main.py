import typer
import json
import os
import sys
import time
from contextlib import contextmanager
from collections.abc import Iterator

from pydantic import ValidationError

# Windows 主控台預設 CP950，中文與特殊字元會編碼錯誤，故改設為 UTF-8。
# 這是顯示層的加分項，設定失敗不影響任何功能，只會讓非 ASCII 字元顯示成亂碼，
# 因此不中斷程式；但要讓使用者知道原因，否則看到亂碼會無從查起。
# 訊息刻意只用 ASCII：此刻編碼設定正是失敗的那件事，用中文可能再引發編碼錯誤。
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError) as exc:
        print(
            f"[warn] cannot set UTF-8 console output ({type(exc).__name__}: {exc}); "
            "non-ASCII characters may be garbled",
            file=sys.stderr,
        )

# 引入核心模組
from app.core.dataset_io import (
    DatasetFormat,
    declared_format_conflict,
    export_result,
    load_dataset,
    load_dataset_with_format,
)
from app.core.config import parse_bundled_config
from app.core.defaults import resolve_kanon_defaults
from app.core.errors import EXIT_AUDIT_UNVERIFIED, EXIT_UNEXPECTED, PetsError
from app.core.logging_setup import configure_logging
from app.core.settings import get_default_salt
from app.engines.anonymization import run_k_anonymity
from app.engines.dp import run_dp
from app.engines.preprocess import run_preprocess
from app.engines.risk import (
    run_attacks,
    run_cap,
    select_subgroup,
    subgroup_notes,
    subgroup_notes_before_after,
    empty_subgroup_attack_report,
    empty_subgroup_cap_report,
)
from app.engines.risk.types import AttackReport, CapReport
from app.governance.auth import get_auth_manager
from app.governance.audit import get_audit_logger
from app.governance.report import generate_pdf_report

cli = typer.Typer(help="通用資料去識別化與隱私保護 CLI 系統")


# 不寫 docstring：Typer 會拿 callback 的 docstring 當整個 CLI 的說明，
# 蓋掉上面 Typer(help=...) 那句。說明改以註解留在原始碼裡。
@cli.callback()
def _configure_cli(
    log_file: str | None = typer.Option(
        None, "--log-file", help="系統日誌檔路徑；未指定時僅輸出至畫面"
    ),
    log_level: str | None = typer.Option(
        None, "--log-level", help="系統日誌等級（DEBUG/INFO/WARNING/ERROR）；預設 WARNING"
    ),
) -> None:
    # 在任何子指令之前執行一次，決定系統日誌的落點與格式（見 core/logging_setup）。
    # 指令列給的值蓋過環境變數：操作者當下的明示意圖優先於部署環境的預設。
    configure_logging(log_file=log_file, level=log_level)


@contextmanager
def _cli_operation(operation: str) -> Iterator[None]:
    """指令的統一收尾：失敗時留痕、印出與 API 相同的錯誤碼與說明，並回對應的離開代碼。

    與 API 共用 app.core.errors 的同一份分類：同一個問題在兩個介面得到同一個錯誤碼與同一句話，
    離開代碼則與 HTTP 狀態碼一一對應（對照表見 app.core.errors.HTTP_STATUS_EXIT_CODE；
    1＝未預期錯誤）。

    指令內要中止時一律拋 PetsError，不要自行拋 typer.Exit——後者是 RuntimeError 的
    子類，會被稽核留痕當成未預期失敗記下來，且繞過錯誤碼與離開代碼的對應。
    """
    try:
        with get_audit_logger().failures(operation):
            yield
    except PetsError as exc:
        typer.echo(f"執行失敗［{exc.error_code}］：{exc.message}", err=True)
        for rec in exc.recommendations:
            typer.echo(f"建議：{rec}", err=True)
        raise typer.Exit(code=exc.exit_code) from exc
    except typer.Exit:
        raise
    except Exception as exc:
        typer.echo(f"執行失敗［ERR_INTERNAL］：{exc}", err=True)
        raise typer.Exit(code=EXIT_UNEXPECTED) from exc


def _get_salt() -> str | None:
    """取得假名化用的鹽值：只由部署環境的 .env 提供，未設定時回傳 None。

    鹽值是機密，不接受從指令列或設定檔傳入——指令列參數會留在殼層歷史紀錄，
    設定檔則會被存檔、納入版本控管並隨交付包傳遞。

    沒設定不擋：鹽為選填，未提供即對值本身做雜湊，與 API 同一套作法。
    """
    return get_default_salt()


def _emit_report(report) -> None:
    """報告一律以 JSON 輸出至標準輸出，結構與對應 API 端點回傳的相同。

    操作訊息（進度／成功／失敗／警告）一律走標準錯誤，與報告分流：人在畫面上兩種都
    看得到，而把輸出導向檔案時取得的是乾淨的 JSON，可直接餵給 report 指令產 PDF。
    """
    typer.echo(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))


def _load_report_json(path: str | None, model, option: str):
    """讀入報告 JSON 檔：風險評估指令的輸出可直接存檔帶入，不需經過 API。

    檔案、語法與內容三種問題都屬呼叫方的輸入，分別回與 API 相同的錯誤碼：
    檔案不存在＝參數錯、語法壞掉＝讀不懂、欄位不符報告格式＝講不通。
    """
    if not path:
        return None
    if not os.path.isfile(path):
        raise PetsError("ERR_INVALID_PARAM", f"{option} 指定的檔案不存在：{path}")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise PetsError(
            "ERR_BAD_REQUEST", f"{option} 指定的檔案不是合法的 UTF-8 JSON：{path}"
        ) from exc
    try:
        return model.model_validate(data).model_dump()
    except ValidationError as exc:
        parts = [
            f"{'→'.join(str(x) for x in item.get('loc', ())) or '整份'}：{item.get('msg', '')}"
            for item in exc.errors()
        ]
        raise PetsError(
            "ERR_VALIDATION_FAILED",
            f"{option} 指定的檔案不符合報告格式。" + "；".join(parts),
        ) from exc


_TABLE_HELP = "資料表名稱；輸入為 SQLite 連線字串（sqlite:///…）時必填"

# 吃大包設定檔的指令差別只在「這次要開哪些區塊」，故說明文字組出來就好。
def _config_help(*blocks: str) -> str:
    return f"設定檔（YAML/JSON），需開啟 {'、'.join(blocks)} 區塊"


def _note_format_override(path: str, input_format: str | None) -> None:
    """指定的格式蓋過副檔名判定時告知一聲（報告透明），不影響讀取行為。"""
    note = declared_format_conflict(path, input_format)
    if note:
        typer.echo(note, err=True)


def _check_output_extension(path: str, fmt: DatasetFormat) -> None:
    """結果資料沿用輸入格式輸出；副檔名對不上時據實告知，不擅自改寫使用者給的路徑。"""
    ext = os.path.splitext(path.lower())[1]
    expected = fmt.output_extension
    if ext != expected:
        typer.echo(
            f"結果資料沿用輸入資料集的格式輸出（{expected}），但指定路徑的副檔名為"
            f"「{ext or '無'}」，檔案內容仍為 {expected} 格式。",
            err=True,
        )


@cli.command("create-user")
def create_user(
    username: str = typer.Option(..., "--username", "-u", help="使用者帳號"),
    password: str = typer.Option(..., "--password", "-p", help="密碼"),
    role: str = typer.Option("user", "--role", "-r", help="角色 (admin, user)"),
):
    """建立系統使用者角色 (RBAC)

    與 API 的 POST /users 共用同一份建立邏輯（AuthManager.create_user）：角色白名單、
    密碼雜湊與重複帳號的判斷只寫一次。帳號已存在時該方法會拋出帶錯誤碼的例外，
    由 _cli_operation 統一轉成訊息與非零離開代碼，腳本不會誤判為建立成功。
    """
    with _cli_operation("create_user"):
        get_auth_manager().create_user(username, password, role)
        typer.echo(f"成功建立使用者 [{username}]，角色為 [{role.strip().lower()}]。")


@cli.command("preprocess")
def cli_preprocess(
    dataset_path: str = typer.Option(..., "--input", "-i", help="輸入資料集路徑"),
    table_name: str | None = typer.Option(None, "--table", help=_TABLE_HELP),
    config_path: str = typer.Option(
        ..., "--config", "-c", help=_config_help("preprocess")
    ),
    output_path: str = typer.Option(..., "--output", "-o", help="輸出資料儲存路徑"),
    # 逐欄逐項的動作與參數一律隨設定檔提供，不另開指令列選項（同其他指令）
):
    """依設定檔清單由上往下對指定欄位執行資料前處理（去空白、截斷、轉型、填補等 11 項）"""
    with _cli_operation("preprocess"):
        typer.echo("正在載入資料與設定檔...", err=True)
        cfgs = parse_bundled_config(config_path, "preprocess")
        config = cfgs.preprocess
        _note_format_override(dataset_path, config.input_format)
        df, dataset_format = load_dataset_with_format(
            dataset_path, config.input_format, table_name
        )

        typer.echo("正在執行資料前處理...", err=True)
        df_out = run_preprocess(df, config)

        _check_output_extension(output_path, dataset_format)
        out_abs = export_result(df_out, output_path, dataset_format)

        get_audit_logger().log_operation(
            "preprocess",
            "success",
            {
                "dataset": dataset_path,
                "output": output_path,
                "columns": len(config.columns),
                "actions": sum(len(entry.actions) for entry in config.columns),
                **cfgs.audit_fields(),
            },
        )

        # 前處理只改資料、不產統計，故無報告可印（其他指令的 _emit_report 在此無對應物）
        typer.echo(f"資料前處理完成！結果已儲存至：{out_abs}", err=True)


@cli.command("k-anonymity")
def cli_k_anonymity(
    dataset_path: str = typer.Option(..., "--input", "-i", help="輸入資料集路徑"),
    table_name: str | None = typer.Option(None, "--table", help=_TABLE_HELP),
    config_path: str = typer.Option(
        ..., "--config", "-c", help=_config_help("k_anonymity")
    ),
    output_path: str = typer.Option(..., "--output", "-o", help="輸出資料儲存路徑"),
    # k、抑制方式、輸入格式等參數一律隨設定檔提供，不另開指令列選項；
    # 鹽值為機密，只讀部署環境的 .env（不進設定檔、不走指令列）
):
    """執行 K-匿名化、l-多樣性、t-相近性與抑制處理"""
    with _cli_operation("k_anonymity"):
        start_time = time.time()
        # 鹽值只由 .env 提供（同 API）：機密走指令列會留在殼層歷史紀錄裡
        salt_key = _get_salt()
        typer.echo("正在載入資料與設定檔...", err=True)
        cfgs = parse_bundled_config(config_path, "k_anonymity")
        config = cfgs.kanon
        _note_format_override(dataset_path, config.input_format)
        df, dataset_format = load_dataset_with_format(
            dataset_path, config.input_format, table_name
        )

        typer.echo("正在進行 K-匿名化（泛化與抑制）去識別化...", err=True)
        # 邊界層預設 resolve（設定檔未填→內建預設），記錄 applied_defaults（報告透明）。
        # 四個入口（API／CLI × 去識別／風險評估）共用同一份決議，見 app.core.defaults
        d = resolve_kanon_defaults(
            config.k,
            config.suppression_limit_percent,
            config.limit_exceeded_action,
            config.suppression_method,
            config.cell_fill,
        )
        applied_defaults = d.notes

        # 泛化層級一律取自設定檔（config.qi_generalization_levels），指令列不覆蓋
        df_out, report = run_k_anonymity(
            df=df,
            config=config,
            k=d.k,
            l=config.l,
            t=config.t,
            suppression_limit_percent=d.suppression_limit_percent,
            limit_exceeded_action=d.limit_exceeded_action,
            salt_key=salt_key,
            suppression_method=d.suppression_method,
            cell_fill=d.cell_fill,
        )
        report.applied_defaults = applied_defaults + report.applied_defaults

        typer.echo("正在匯出結果...", err=True)
        _check_output_extension(output_path, dataset_format)
        out_abs = export_result(df_out, output_path, dataset_format)

        # 依模組解耦原則：去識別化只負責產出資料與品質報告，不在此自動進行
        # 再識別風險量測（規格將其列為獨立的資料治理功能 3(1)）。再識別風險評估
        # 由 risk-k-anonymity／risk-dp／risk-cap 指令（或對應 API
        # 端點）提供；PDF 報告請用 `report` 指令。
        duration = time.time() - start_time

        # 審計留痕
        get_audit_logger().log_operation(
            "k_anonymity",
            "success",
            {
                "dataset": dataset_path,
                "output": output_path,
                "k": d.k,
                "suppression_rate_percent": report.suppression_rate_percent,
                **cfgs.audit_fields(),
            },
        )

        typer.echo(
            f"去識別化處理成功（耗時 {duration:.2f} 秒）！結果已儲存至：{out_abs}",
            err=True,
        )
        typer.echo(
            "如需再識別風險評估請使用 risk-k-anonymity／risk-dp／risk-cap 指令；如需 PDF 報告請執行 report 指令。",
            err=True,
        )
        _emit_report(report)


@cli.command("dp")
def cli_dp(
    dataset_path: str = typer.Option(..., "--input", "-i", help="輸入資料集路徑"),
    table_name: str | None = typer.Option(None, "--table", help=_TABLE_HELP),
    config_path: str = typer.Option(
        ..., "--config", "-c", help=_config_help("differential_privacy")
    ),
    output_path: str = typer.Option(..., "--output", "-o", help="輸出資料儲存路徑"),
    # 逐欄預算與全域參數（累計預算、全域 δ、輸入格式）一律由設定檔提供，不另開指令列選項
):
    """對資料集欄位套用差分隱私雜訊，並回報預算消耗"""
    with _cli_operation("dp"):
        typer.echo("正在載入資料與設定檔...", err=True)
        # 純 config 的值域/型別衝突於解析時即 fail fast（擋的檢查前置）
        cfgs = parse_bundled_config(config_path, "dp")
        dp_config = cfgs.dp
        _note_format_override(dataset_path, dp_config.input_format)
        df, dataset_format = load_dataset_with_format(
            dataset_path, dp_config.input_format, table_name
        )

        typer.echo("正在加入差分隱私雜訊...", err=True)
        df_out, report = run_dp(
            df,
            dp_config,
            accumulated_epsilon=dp_config.accumulated_epsilon,
            accumulated_delta=dp_config.accumulated_delta,
            default_delta=dp_config.default_delta,
        )

        _check_output_extension(output_path, dataset_format)
        out_abs = export_result(df_out, output_path, dataset_format)

        get_audit_logger().log_operation(
            "dp",
            "success",
            {
                "dataset": dataset_path,
                "output": output_path,
                "consumed_epsilon": report.consumed_epsilon,
                **cfgs.audit_fields(),
            },
        )

        typer.echo(f"差分隱私處理成功！結果已儲存至：{out_abs}", err=True)
        # 逐欄預算明細（機制、ε／δ、sensitivity 與其來源）皆在報告的 per_column 內
        _emit_report(report)


@cli.command("risk-k-anonymity")
def cli_risk_k_anonymity(
    dataset_path: str = typer.Option(..., "--input", "-i", help="原始資料集（未去識別）路徑"),
    table_name: str | None = typer.Option(None, "--table", help=_TABLE_HELP),
    config_path: str = typer.Option(
        ..., "--config", "-c", help=_config_help("risk_attacks", "k_anonymity")
    ),
    # 參數一律隨設定檔提供，不另開指令列選項；鹽值只讀部署環境的 .env
):
    """三攻擊（K-匿名）：只上傳原始資料，引擎自切 80/20、只對 80% 以 K-匿名產 syn 後跑三攻擊。"""
    with _cli_operation("risk_k_anonymity"):
        start_time = time.time()
        # 鹽值只由 .env 提供（同 API）：syn 由引擎呼叫 K-匿名產生，故此指令亦取鹽值。
        effective_salt = _get_salt()
        typer.echo("正在載入原始資料與設定檔...", err=True)
        cfgs = parse_bundled_config(config_path, "risk_k_anonymity")
        rc = cfgs.risk
        kanon_cfg = cfgs.kanon
        qi_cols = rc.qi_columns()
        s_cols = rc.sensitive_columns()
        link_a, link_b = rc.linkability_pair()
        _note_format_override(dataset_path, rc.input_format)
        df_ori = load_dataset(dataset_path, rc.input_format, table_name)

        # K-匿名旋鈕邊界層預設 resolve（同 k-anonymity 指令），記錄以供報告透明告知
        # 與 k-anonymity 指令共用同一份決議（見 app.core.defaults）
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

        # 子群體前篩（處理前篩原始）：條件欄位不存在於此 fail fast
        conditions = rc.subgroup_conditions()
        sub = select_subgroup(df_ori, conditions)
        if sub.n_after == 0:
            _emit_report(empty_subgroup_attack_report(sub))
            return

        typer.echo("正在切分、自產 syn 並執行三攻擊...", err=True)
        report = run_attacks(
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

        # 報告透明：系統套用的 K-匿名預設與子群體前後筆數併入 message
        extra = list(applied_defaults)
        if conditions:
            extra += subgroup_notes(sub)
        if extra:
            report.message = report.message + " " + " ".join(extra)

        get_audit_logger().log_operation(
            "risk_k_anonymity",
            "success",
            {
                "dataset": dataset_path,
                "singling_out_risk": report.singling_out_risk,
                "linkability_risk": report.linkability_risk,
                "inference_risk": report.inference_risk,
                **cfgs.audit_fields(),
            },
        )
        report.elapsed_seconds = round(time.time() - start_time, 2)
        typer.echo(f"三攻擊評估完成（耗時 {report.elapsed_seconds:.2f} 秒）", err=True)
        _emit_report(report)


@cli.command("risk-dp")
def cli_risk_dp(
    dataset_path: str = typer.Option(..., "--input", "-i", help="原始資料集（未去識別）路徑"),
    table_name: str | None = typer.Option(None, "--table", help=_TABLE_HELP),
    config_path: str = typer.Option(
        ..., "--config", "-c", help=_config_help("risk_attacks", "differential_privacy")
    ),
    # 參數一律隨設定檔提供，不另開指令列選項
):
    """三攻擊（DP）：只上傳原始資料，引擎自切 80/20、只對 80% 以差分隱私加噪產 syn 後跑三攻擊。"""
    with _cli_operation("risk_dp"):
        start_time = time.time()
        typer.echo("正在載入原始資料與設定檔...", err=True)
        cfgs = parse_bundled_config(config_path, "risk_dp")
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
        _note_format_override(dataset_path, rc.input_format)
        df_ori = load_dataset(dataset_path, rc.input_format, table_name)

        # 子群體前篩（處理前篩原始）：條件欄位不存在於此 fail fast
        conditions = rc.subgroup_conditions()
        sub = select_subgroup(df_ori, conditions)
        if sub.n_after == 0:
            _emit_report(empty_subgroup_attack_report(sub))
            return

        typer.echo("正在切分、自產 syn 並執行三攻擊...", err=True)
        report = run_attacks(
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

        # 報告透明：子群體前後筆數併入 message
        if conditions:
            report.message = report.message + " " + " ".join(subgroup_notes(sub))

        get_audit_logger().log_operation(
            "risk_dp",
            "success",
            {
                "dataset": dataset_path,
                "singling_out_risk": report.singling_out_risk,
                "linkability_risk": report.linkability_risk,
                "inference_risk": report.inference_risk,
                **cfgs.audit_fields(),
            },
        )
        report.elapsed_seconds = round(time.time() - start_time, 2)
        typer.echo(f"三攻擊評估完成（耗時 {report.elapsed_seconds:.2f} 秒）", err=True)
        _emit_report(report)


@cli.command("risk-cap")
def cli_risk_cap(
    original_path: str = typer.Option(..., "--input", "-i", help="原始資料集（未去識別）路徑"),
    table_name: str | None = typer.Option(None, "--table", help=_TABLE_HELP),
    processed_path: str = typer.Option(
        ..., "--processed", "-p", help="去識別後資料集（現成成品）路徑"
    ),
    processed_table: str | None = typer.Option(
        None, "--processed-table", help="去識別後資料集為 SQLite 連線字串時的資料表名稱"
    ),
    config_path: str = typer.Option(
        ..., "--config", "-c", help=_config_help("risk_cap")
    ),
    # 參數一律隨設定檔提供，不另開指令列選項；前後兩份的格式各自宣告——原始資料集的
    # 格式寫在根層 input_format，去識別後那份寫在 risk_cap 區塊的 processed_format
    # （兩份是不同來源的檔案、不保證同一種格式）
):
    """CAP 前後對比（§3(1)B）：同時上傳原始與去識別後兩份現成資料，引擎不去識別，只各算一次歸因機率並對比。"""
    with _cli_operation("risk_cap"):
        start_time = time.time()
        typer.echo("正在載入前後兩份資料與設定檔...", err=True)
        cfgs = parse_bundled_config(config_path, "risk_cap")
        rc = cfgs.risk
        qi_cols = rc.qi_columns()
        s_cols = rc.sensitive_columns()
        _note_format_override(original_path, rc.input_format)
        _note_format_override(processed_path, rc.processed_format)
        df_ori = load_dataset(original_path, rc.input_format, table_name)
        df_proc = load_dataset(processed_path, rc.processed_format, processed_table)

        # 子群體對前後各篩一次（值篩，不靠 index）：條件欄位不存在於此 fail fast
        conditions = rc.subgroup_conditions()
        sub_ori = select_subgroup(df_ori, conditions)
        sub_proc = select_subgroup(df_proc, conditions)
        # 原始子群體為空＝無基準可比：回降級報告，與 CAP 端點同一份形狀
        if conditions and sub_ori.n_after == 0:
            _emit_report(empty_subgroup_cap_report(sub_ori, sub_proc))
            return

        typer.echo("正在計算前後正確歸因機率（CAP）...", err=True)
        report = run_cap(
            original_df=sub_ori.df,
            processed_df=sub_proc.df,
            qi_cols=qi_cols,
            sensitive_cols=s_cols,
        )

        # 報告透明：子群體前後筆數與轉換備註併入 message
        if conditions:
            extra = subgroup_notes_before_after(sub_ori, sub_proc)
            report.message = report.message + " " + " ".join(extra)

        get_audit_logger().log_operation(
            "risk_cap",
            "success",
            {
                "original": original_path,
                "processed": processed_path,
                "cap_before": report.cap_before,
                "cap_after": report.cap_after,
                **cfgs.audit_fields(),
            },
        )
        report.elapsed_seconds = round(time.time() - start_time, 2)
        typer.echo(f"CAP 前後對比完成（耗時 {report.elapsed_seconds:.2f} 秒）", err=True)
        _emit_report(report)


@cli.command("verify-log")
def verify_log():
    """校驗鏈式防篡改日誌完整性 (完整性防護檢查)"""
    typer.echo("正在校驗審計日誌雜湊鏈條完整性...")
    result = get_audit_logger().verify_audit_log()
    if result.is_valid:
        typer.echo("校驗完成：每一行都已驗證，未發現篡改、刪除或非法插入。")
    else:
        # 不逕自宣告為竄改：無法驗證與確實損壞都會走到這裡，差別寫在各則訊息裡
        typer.echo("校驗未全數通過，請檢視以下項目：")
    for msg in result.problems:
        typer.echo(f"   {msg}")
    # 說明（如日誌尚無紀錄）不影響結論，但通過與否都要顯示，不因通過而隱藏
    for note in result.notes:
        typer.echo(f"   {note}")
    # 結論也要反映在離開代碼上：只看離開代碼的腳本才分得出通過與否
    if not result.is_valid:
        raise typer.Exit(code=EXIT_AUDIT_UNVERIFIED)


@cli.command("report")
def cli_report(
    out_pdf_path: str = typer.Option(..., "--output", "-o", help="輸出 PDF 儲存路徑"),
    task_id: str = typer.Option("risk-report", "--task", "-t", help="任務識別 ID"),
    attack_path: str = typer.Option(
        None, "--attack-report", help="三攻擊報告 JSON 檔路徑（風險評估指令或 API 端點的輸出）"
    ),
    cap_path: str = typer.Option(
        None, "--cap-report", help="CAP 報告 JSON 檔路徑（同上）"
    ),
):
    """彙整再識別風險量測結果，產生並輸出 PDF 報告（規格 §3(4)）。

    無狀態：把風險評估的報告 JSON 存成檔案後帶路徑進來即可（risk-k-anonymity／
    risk-dp／risk-cap 的輸出，或 API 對應端點的回傳），處理配置由報告內
    引擎親手回填的 processing_config 帶出、不需另行手打方法／參數。兩包至少要有一包。
    """
    with _cli_operation("export_report"):
        if not attack_path and not cap_path:
            raise PetsError(
                "ERR_BAD_REQUEST",
                "--attack-report 與 --cap-report 至少須提供一包，否則無內容可產出報告。",
            )
        attack_report = _load_report_json(attack_path, AttackReport, "--attack-report")
        cap_report = _load_report_json(cap_path, CapReport, "--cap-report")

        typer.echo("正在渲染 PDF 報告...", err=True)
        pdf_abs = generate_pdf_report(task_id, attack_report, cap_report, out_pdf_path)

        get_audit_logger().log_operation(
            "export_report", "success", {"task_id": task_id, "pdf": out_pdf_path}
        )
        typer.echo(f"報告輸出成功！絕對路徑：{pdf_abs}", err=True)


if __name__ == "__main__":
    cli()
