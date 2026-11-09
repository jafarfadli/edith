import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("edith")


class EdithError(Exception):
    status = 400
    code = "error"

    def __init__(self, message: str = "", **extra):
        super().__init__(message or self.code)
        self.message = message or self.code
        self.extra = extra


class PdfCorrupt(EdithError):
    status, code = 400, "pdf_corrupt"


class PdfEncrypted(EdithError):
    status, code = 400, "pdf_encrypted"


class TooLarge(EdithError):
    status, code = 413, "too_large"


class UnsupportedMedia(EdithError):
    status, code = 415, "unsupported_media"


class DocNotFound(EdithError):
    status, code = 404, "doc_not_found"


class AssetNotFound(EdithError):
    status, code = 404, "asset_not_found"


class PageNotFound(EdithError):
    status, code = 404, "page_not_found"


class FontNotFound(EdithError):
    status, code = 404, "font_not_found"


class DocExpired(EdithError):
    status, code = 410, "doc_expired"


class InvalidOp(EdithError):
    status, code = 422, "invalid_op"


class TextLocked(InvalidOp):
    """A text.edit of a paragraph whose text is invisible over a picture of it (M5c): the edit would draw the new text
    over the old picture. Clients never offer it; a draft from before M5c may still hold one (`op_index`)."""
    status, code = 422, "text_locked"


class TextOutdated(EdithError):
    """text.edit ops name paragraphs of another segmentation version (a draft or tab from before an update)."""
    status, code = 409, "text_outdated"


class BakeFailed(EdithError):
    status, code = 500, "bake_failed"


def _body(code: str, message: str, **extra) -> dict:
    return {"error": {"code": code, "message": message, **extra}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(EdithError)
    async def _edith(_: Request, exc: EdithError):
        return JSONResponse(_body(exc.code, exc.message, **exc.extra), status_code=exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(
            _body(code, str(exc.detail)), status_code=exc.status_code, headers=getattr(exc, "headers", None)
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        extra = {}
        in_ops = False
        for err in errors:
            loc = list(err.get("loc", []))
            if len(loc) >= 2 and loc[0] == "body" and loc[1] == "ops":
                in_ops = True
                if len(loc) >= 3 and isinstance(loc[2], int):
                    extra["op_index"] = loc[2]
                    break
        msg = "; ".join(f"{'.'.join(map(str, e.get('loc', [])))}: {e.get('msg')}" for e in errors[:5])
        code = "invalid_op" if in_ops else "invalid_request"
        return JSONResponse(_body(code, msg, **extra), status_code=422)



class UnhandledErrors:
    """Any other exception → 500 `internal` JSON. A middleware, not `exception_handler(Exception)`: that handler
    runs in ServerErrorMiddleware, outside CORSMiddleware, so its response has no Access-Control-Allow-Origin and
    a cross-origin browser sees a network error. Add it before CORSMiddleware so CORS wraps it."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def _send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception:
            logger.exception("unhandled error")
            if started:  # too late for a JSON body: ServerErrorMiddleware closes the connection
                raise
            await JSONResponse(_body("internal", "internal error"), status_code=500)(scope, receive, send)
