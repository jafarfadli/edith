from typing import Any, Callable

import pymupdf

from edith.bake.context import BakeContext

Handler = Callable[[pymupdf.Page, Any, BakeContext], None]
HANDLERS: dict[str, Handler] = {}
PHASE: dict[str, str] = {}
# Handlers of the text-only redaction pass, which runs before the "redact" pass (see bake()).
TEXT_REDACTIONS: dict[str, Handler] = {}
# Handlers of the decoration redaction pass (text.edit: the underline / strike / highlight marks of the lines it
# redraws), which removes line art fully inside its rects and nothing else (see bake()).
DECOR_REDACTIONS: dict[str, Handler] = {}
# Handlers that paint over the page's original content after the redactions and before any drawn object (text.ocr_edit
# covers the old picture of its text there, as text.edit removes original glyphs: under every object).
COVERS: dict[str, Handler] = {}


def register(op_type: str, phase: str = "draw"):
    """phase "redact", "draw", "annot" or "link": the op's main handler; per page, bake() runs the
    redactions, then the drawn content, then native annotations, then links (spec: Urutan bake).
    Within a phase, ops run in request order (the web's z-order); apps/web/src/lib/zorder.ts zStage mirrors
    PHASE, so change both together.
    phase "redact_text": an extra handler that marks text for the text-only redaction pass (an op
    type may have both). phase "redact_decor": one that marks drawn decorations for the decoration pass. phase "cover": an extra handler run after the redactions, before the drawn content."""
    assert phase in ("redact_text", "redact_decor", "cover", "redact", "draw", "annot", "link")

    def deco(fn: Handler) -> Handler:
        if phase == "redact_text":
            TEXT_REDACTIONS[op_type] = fn
        elif phase == "redact_decor":
            DECOR_REDACTIONS[op_type] = fn
        elif phase == "cover":
            COVERS[op_type] = fn
        else:
            HANDLERS[op_type] = fn
            PHASE[op_type] = phase
        return fn

    return deco
