from typing import Any, Callable

import pymupdf

from edith.bake.context import BakeContext

Handler = Callable[[pymupdf.Page, Any, BakeContext], None]
HANDLERS: dict[str, Handler] = {}
PHASE: dict[str, str] = {}
# Handlers of the text-only redaction pass, which runs before the "redact" pass (see bake()).
TEXT_REDACTIONS: dict[str, Handler] = {}


def register(op_type: str, phase: str = "draw"):
    """phase "draw" or "redact": the op's main handler. phase "redact_text": an extra handler that
    marks text for the text-only redaction pass (an op type may have both)."""
    assert phase in ("redact_text", "redact", "draw")

    def deco(fn: Handler) -> Handler:
        if phase == "redact_text":
            TEXT_REDACTIONS[op_type] = fn
        else:
            HANDLERS[op_type] = fn
            PHASE[op_type] = phase
        return fn

    return deco
