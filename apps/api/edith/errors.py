from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


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


class DocExpired(EdithError):
    status, code = 410, "doc_expired"


class InvalidOp(EdithError):
    status, code = 422, "invalid_op"


class BakeFailed(EdithError):
    status, code = 500, "bake_failed"


def _body(code: str, message: str, **extra) -> dict:
    return {"error": {"code": code, "message": message, **extra}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(EdithError)
    async def _edith(_: Request, exc: EdithError):
        return JSONResponse(_body(exc.code, exc.message, **exc.extra), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        extra = {}
        for err in errors:
            loc = list(err.get("loc", []))
            if len(loc) >= 3 and loc[0] == "body" and loc[1] == "ops" and isinstance(loc[2], int):
                extra["op_index"] = loc[2]
                break
        msg = "; ".join(f"{'.'.join(map(str, e.get('loc', [])))}: {e.get('msg')}" for e in errors[:5])
        return JSONResponse(_body("invalid_op", msg, **extra), status_code=422)
