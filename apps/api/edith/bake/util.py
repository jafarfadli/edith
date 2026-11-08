import pymupdf

from edith.ops import Rect


def rgb(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def to_rect(r: Rect) -> pymupdf.Rect:
    return pymupdf.Rect(r.x, r.y, r.x + r.w, r.y + r.h)


# Bytes PyMuPDF's insert_link() would write raw into the URI's PDF literal string: `\`, `(` and `)` can end
# the string early (a crafted URL becomes a /JavaScript action) or vanish; controls, spaces and non-ASCII
# are not valid in a URI. Shared contract with apps/web/src/lib/links.ts (encodeUnsafe) — change both together.
_UNSAFE = frozenset(b"\\()") | frozenset(range(0x21)) | frozenset(range(0x7F, 0x100))


def safe_uri(uri: str) -> str:
    """`uri` with every unsafe byte of its UTF-8 form percent-encoded; `%` is kept, so it is idempotent."""
    return "".join(f"%{b:02X}" if b in _UNSAFE else chr(b) for b in uri.encode("utf-8", "surrogatepass"))
