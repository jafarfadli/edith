from typing import Any, Callable

import pymupdf

from edith.bake.context import BakeContext

Handler = Callable[[pymupdf.Page, Any, BakeContext], None]
HANDLERS: dict[str, Handler] = {}
PHASE: dict[str, str] = {}


def register(op_type: str, phase: str = "draw"):
    assert phase in ("redact", "draw")

    def deco(fn: Handler) -> Handler:
        HANDLERS[op_type] = fn
        PHASE[op_type] = phase
        return fn

    return deco
