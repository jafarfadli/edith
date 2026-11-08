"""redact.add removes everything under its box — not only page content, but also annotations, links and
form fields (with their values) from the source and from the user's own ops."""
import pymupdf
import pytest

from tests.pdfs import make_secrets_pdf
from tests.test_documents import upload

SECRETS = ("Secret text", "secret note", "sticky secret", "SSN 123", "NEW SECRET", "user secret", "user markup",
           "old.example", "leak.example")


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def everything_in(doc: pymupdf.Document) -> str:
    """Every object and (decompressed) stream of the file: what a reader of the bytes could recover."""
    parts = []
    for xref in range(1, doc.xref_length()):
        try:
            parts.append(doc.xref_object(xref, compressed=False))
            if doc.xref_is_stream(xref):
                parts.append(doc.xref_stream(xref).decode("latin-1"))
        except Exception:  # noqa: BLE001  (free entries)
            continue
    return "\n".join(parts)


@pytest.mark.parametrize("flatten", [False, True])
def test_redaction_removes_annotations_links_and_fields_under_it(client, flatten):
    doc_id = upload(client, make_secrets_pdf()).json()["doc_id"]
    ops = [
        {"id": "fs", "type": "form.set", "fieldName": "f", "value": "NEW SECRET"},
        {"id": "fk", "type": "form.set", "fieldName": "keep", "value": "still visible"},
        {"id": "n", "type": "annot.add", "pageKey": "o0", "kind": "note", "point": [150, 95], "color": "#facc15",
         "content": "user secret"},
        {"id": "m", "type": "annot.add", "pageKey": "o0", "kind": "highlight", "quads": [R(72, 88, 60, 14)],
         "color": "#ffeb3b", "content": "user markup"},
        {"id": "l", "type": "link.add", "pageKey": "o0", "rect": R(100, 90, 50, 10), "target": {"url": "https://leak.example"}},
        {"id": "ok", "type": "annot.add", "pageKey": "o0", "kind": "note", "point": [400, 700], "color": "#facc15",
         "content": "user public"},
        {"id": "r", "type": "redact.add", "pageKey": "o0", "rect": R(60, 80, 160, 32), "fill": "black"},
    ]
    r = client.post(f"/documents/{doc_id}/export", json={"ops": ops, "flatten_forms": flatten})
    assert r.status_code == 200, r.text
    out = pymupdf.open(stream=r.content, filetype="pdf")
    page = out[0]
    contents = sorted(a.info["content"] for a in page.annots() if a.type[1] != "Popup")
    assert contents == ["public note", "user public"]
    assert page.get_links() == []
    text = page.get_text()
    assert "Secret text" not in text
    if flatten:
        assert list(page.widgets()) == [] and "still visible" in text
    else:
        assert [(w.field_name, w.field_value) for w in page.widgets()] == [("keep", "still visible")]
    raw = everything_in(out)
    for secret in SECRETS:
        assert secret not in raw, secret
