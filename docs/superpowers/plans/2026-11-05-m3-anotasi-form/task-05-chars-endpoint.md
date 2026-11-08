# Task 5: `GET /documents/{id}/pages/{index}/chars` — character boxes for text markup

The client selects original text for highlight/underline/strike by character, so it needs each character's x extent per line. They come from `page.get_text("rawdict")` with the paragraph extraction's flags, per source page and on demand (a 200-page document would be megabytes in `/text`). Rotated lines are left out (they are not editable in M2 either).

**Files:**
- Create: `apps/api/edith/chars.py`
- Modify: `apps/api/edith/errors.py`
- Modify: `apps/api/edith/routes/text.py`
- Create: `apps/api/tests/test_chars.py`

**Interfaces:**
- Consumes: M2 `edith.paragraphs.FLAGS`, `routes/text.py` `_open_source`.
- Produces: `edith.chars.page_chars(page) -> list[{text, boxes: [[x0, x1], …], baseline, size}]` (one box per code point of `text`, U+00A0/tab → space, blank lines dropped); route `GET /documents/{doc_id}/pages/{index}/chars` → `200 {doc_id, index, lines}`, `404 page_not_found` for an index outside the document; `edith.errors.PageNotFound` (404, `page_not_found`).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_chars.py`:
```python
import pymupdf
import pytest

from tests.pdfs import make_paragraphs_pdf, make_pdf
from tests.test_documents import upload


def chars_of(client, data: bytes, index: int = 0):
    doc_id = upload(client, data).json()["doc_id"]
    return client.get(f"/documents/{doc_id}/pages/{index}/chars")


def test_lines_with_one_box_per_character(client):
    r = chars_of(client, make_pdf(pages=1))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["index"] == 0
    [line] = body["lines"]
    assert line["text"] == "Page 0" and len(line["boxes"]) == 6
    assert line["baseline"] == 72 and line["size"] == 14
    assert line["boxes"][0][0] == 72
    expected = 72 + pymupdf.get_text_length("Page 0", fontname="helv", fontsize=14)
    assert line["boxes"][-1][1] == pytest.approx(expected, abs=0.01)
    xs = [x for box in line["boxes"] for x in box]
    assert xs == sorted(xs)  # left to right, boxes touch


def test_rotated_text_is_left_out(client):
    lines = chars_of(client, make_paragraphs_pdf()).json()["lines"]
    texts = [line["text"] for line in lines]
    assert "Paragraf A baris satu yang cukup panjang" in texts
    assert not any("diputar" in t for t in texts)
    assert all(len(line["text"]) == len(line["boxes"]) for line in lines)


def test_rotated_page_uses_unrotated_coordinates(client):
    [line] = chars_of(client, make_pdf(pages=1, rotation=90)).json()["lines"]
    assert (line["boxes"][0][0], line["baseline"]) == (72, 72)


def test_unknown_page(client):
    r = chars_of(client, make_pdf(pages=1), index=3)
    assert r.status_code == 404 and r.json()["error"]["code"] == "page_not_found"
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest tests/test_chars.py -q`
Expected: `4 failed` — the route answers `404 not_found` (`KeyError: 'lines'`).

- [ ] **Step 3: Implement**

Create `apps/api/edith/chars.py`:
```python
"""Character boxes of a page's original text, for text-markup annotations (the client turns a
selection into one quad per line)."""
import pymupdf

from edith.paragraphs import FLAGS


def _num(v: float) -> float:
    return round(v, 2)


def page_chars(page: pymupdf.Page) -> list[dict]:
    """Horizontal text lines in content order: `text` (one character per code point) with the
    `[x0, x1]` box of each character, the line's baseline and size (of its largest span).
    Unrotated-CropBox points; rotated text and blank lines are left out."""
    out = []
    for block in page.get_text("rawdict", flags=FLAGS)["blocks"]:
        for line in block.get("lines", []):
            dx, dy = line["dir"]
            if abs(dx - 1) > 1e-3 or abs(dy) > 1e-3:
                continue
            chars = [c for span in line["spans"] for c in span["chars"]]
            text = "".join(c["c"] for c in chars).replace("\xa0", " ").replace("\t", " ")
            if not text.strip():
                continue
            main = max(line["spans"], key=lambda s: (s["size"], len(s["chars"])))
            out.append({
                "text": text,
                "boxes": [[_num(c["bbox"][0]), _num(c["bbox"][2])] for c in chars],
                "baseline": _num(main["origin"][1]),
                "size": _num(main["size"]),
            })
    return out
```

Modify `apps/api/edith/errors.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/errors.py
+++ b/apps/api/edith/errors.py
@@ -42,6 +42,10 @@ class AssetNotFound(EdithError):
     status, code = 404, "asset_not_found"
 
 
+class PageNotFound(EdithError):
+    status, code = 404, "page_not_found"
+
+
 class FontNotFound(EdithError):
     status, code = 404, "font_not_found"
```

Modify `apps/api/edith/routes/text.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/routes/text.py
+++ b/apps/api/edith/routes/text.py
@@ -2,8 +2,9 @@ import re
 
 from fastapi import APIRouter, Request, Response
 
+from edith.chars import page_chars
 from edith.doc_fonts import font_bytes
-from edith.errors import DocExpired, FontNotFound
+from edith.errors import DocExpired, FontNotFound, PageNotFound
 from edith.extract import extract_text, open_pdf
 
 router = APIRouter()
@@ -28,6 +29,17 @@ def get_text(request: Request, doc_id: str) -> dict:
         doc.close()
 
 
+@router.get("/documents/{doc_id}/pages/{index}/chars")
+def get_chars(request: Request, doc_id: str, index: int) -> dict:
+    doc = _open_source(request, doc_id)
+    try:
+        if not 0 <= index < doc.page_count:
+            raise PageNotFound(f"no page {index}")
+        return {"doc_id": doc_id, "index": index, "lines": page_chars(doc[index])}
+    finally:
+        doc.close()
+
+
 @router.get("/documents/{doc_id}/fonts/{ref}")
 def get_font(request: Request, doc_id: str, ref: str) -> Response:
     if not re.fullmatch(r"f[0-9]{1,9}", ref):
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/api && uv run pytest tests/test_chars.py -q`
Expected: `4 passed`.

- [ ] **Step 5: Full check**

Run: `cd apps/api && uv run pytest -q`
Expected: `295 passed`, no warnings summary.

- [ ] **Step 6: Commit**

```bash
git add apps/api/edith/chars.py apps/api/edith/errors.py apps/api/edith/routes/text.py apps/api/tests/test_chars.py
git commit -m "feat(api): character boxes of original text for text markup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
