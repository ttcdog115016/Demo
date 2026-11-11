"""API 層的錯誤收斂：所有失敗回應在此轉成同一種形狀，路由不各自組裝。

狀態碼由 app.core.errors 的對照表決定，回應主體固定為
    {"error_code": ..., "message": ..., "recommendations": [...]}
recommendations 只在引擎確實給了建議時出現。
"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.errors import PetsError, default_code_for_status
from app.core.settings import get_max_upload_bytes


def _body(error_code: str, message: str, recommendations=None) -> dict:
    body = {"error_code": error_code, "message": message}
    if recommendations:
        body["recommendations"] = recommendations
    return body


def register_error_handlers(app: FastAPI) -> None:
    """掛上四種例外的統一處理；註冊順序不影響，FastAPI 依型別分派。"""

    @app.exception_handler(PetsError)
    async def _handle_pets_error(_: Request, exc: PetsError) -> JSONResponse:
        # 引擎與設定檔解析拋出的可預期錯誤：錯誤碼自帶狀態碼，此處只負責序列化
        return JSONResponse(
            status_code=exc.http_status,
            content=_body(exc.error_code, exc.message, exc.recommendations),
        )

    @app.exception_handler(ValueError)
    async def _handle_value_error(_: Request, exc: ValueError) -> JSONResponse:
        # 未帶錯誤碼的值錯誤：一律回 400（ERR_BAD_REQUEST）
        return JSONResponse(
            status_code=400, content=_body("ERR_BAD_REQUEST", str(exc))
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http_exception(
        _: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        # 框架自己丟的（404 路徑不存在、405 方法不符等）也收斂成同一種主體
        return JSONResponse(
            status_code=exc.status_code,
            content=_body(default_code_for_status(exc.status_code), str(exc.detail)),
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_request_validation(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # 請求本身欄位缺漏／型別不符（如未附上 file）：框架預設回 detail 陣列，
        # 這裡整理成一句話，讓整合方不必為這一種錯誤另寫解析。
        parts = []
        for item in exc.errors():
            loc = "→".join(str(x) for x in item.get("loc", ()) if x != "body")
            parts.append(f"{loc or '請求'}：{item.get('msg', '')}")
        return JSONResponse(
            status_code=422,
            content=_body(
                "ERR_VALIDATION_FAILED", "請求欄位不合法。" + "；".join(parts)
            ),
        )


def _too_large(received: int, max_bytes: int) -> JSONResponse:
    # middleware 早於例外處理器，需自行組回應
    return JSONResponse(
        status_code=413,
        content=_body(
            "ERR_PAYLOAD_TOO_LARGE",
            f"上傳內容 {received / 1024 / 1024:.1f} MB 超過伺服器允許的上限 "
            f"{max_bytes / 1024 / 1024:.0f} MB。請改以較小的資料集分批處理，"
            f"或請部署方調整 OPEN_PETS_MAX_UPLOAD_MB 設定。",
        ),
    )


def register_upload_limit(app: FastAPI) -> None:
    """限制單次請求大小：超過上限直接回 413，不把整包讀進記憶體再說。

    先看 Content-Length，對方申報的數字就已超過上限時，一個位元組都不必收就能回覆，
    誤傳大檔的整合方可以立刻得到明確答案。但這個標頭是由對方填寫、分塊傳輸更是完全不帶，
    只憑它把關等同於沒有上限，故另以實際收到的位元組數為準：邊收邊累加，一超過就中斷。
    關鍵在於不能先收完再判斷，否則記憶體早被佔滿，限制形同虛設。
    上限設為 0 代表部署方明確要求不設限。
    """

    @app.middleware("http")
    async def _limit_upload_size(request: Request, call_next):
        max_bytes = get_max_upload_bytes()
        if not max_bytes:
            return await call_next(request)

        raw_length = request.headers.get("content-length")
        if raw_length and raw_length.isdigit() and int(raw_length) > max_bytes:
            return _too_large(int(raw_length), max_bytes)

        received = 0
        exceeded = False
        upstream_receive = request.receive

        async def counting_receive():
            # 收一塊算一塊；超過上限就當作對方斷線，後續內容不再往下游送。
            # 這裡不改用拋例外中斷，是因為表單解析會把例外收斂成自己的格式錯誤，
            # 「檔案太大」會被講成「內容格式有誤」，整合方看了會往錯的方向修。
            nonlocal received, exceeded
            message = await upstream_receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > max_bytes:
                    exceeded = True
                    return {"type": "http.disconnect"}
            return message

        request._receive = counting_receive
        try:
            response = await call_next(request)
        except Exception:
            # 中斷串流會讓下游以讀取失敗收場，那是本層造成的，改回覆真正的原因；
            # 與大小無關的錯誤照原樣往上拋，不在此吞掉。
            if exceeded:
                return _too_large(received, max_bytes)
            raise
        return _too_large(received, max_bytes) if exceeded else response


__all__ = ["register_error_handlers", "register_upload_limit"]
