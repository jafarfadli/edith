import logging

import pytest
from fastapi.testclient import TestClient

from edith.main import create_app
from edith.settings import Settings
from tests.pdfs import make_edit_pdf, make_pdf

ORIGIN = "https://web.example"


@pytest.fixture
def cors_client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path / "data", cors_origins=[ORIGIN]))

    @app.get("/boom")
    def boom():
        raise RuntimeError("secret detail")

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_unhandled_error_is_json_500_with_cors(cors_client, caplog):
    """A cross-origin browser must read the 500 (not see a network error): CORSMiddleware wraps the catch-all."""
    with caplog.at_level(logging.ERROR, logger="edith"):
        r = cors_client.get("/boom", headers={"Origin": ORIGIN})
    assert r.status_code == 500
    assert r.json() == {"error": {"code": "internal", "message": "internal error"}}
    assert r.headers.get("access-control-allow-origin") == ORIGIN
    assert "secret detail" not in r.text
    assert any(rec.exc_info and "secret detail" in str(rec.exc_info[1]) for rec in caplog.records)


def test_unhandled_error_in_export_carries_cors(cors_client, monkeypatch):
    import edith.routes.export as export

    def broken(*_, **__):
        raise RuntimeError("bug")

    monkeypatch.setattr(export, "bake", broken)
    doc_id = cors_client.post("/documents", files={"file": ("a.pdf", make_pdf(1), "application/pdf")}).json()["doc_id"]
    r = cors_client.post(f"/documents/{doc_id}/export", json={"ops": []}, headers={"Origin": ORIGIN})
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal"
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_edith_errors_keep_their_shape_and_cors(cors_client):
    r = cors_client.get("/documents/nope/text", headers={"Origin": ORIGIN})
    assert r.status_code == 404 and r.json()["error"]["code"] == "doc_not_found"
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_font_subsetting_failure_is_bake_failed(cors_client, monkeypatch):
    import edith.bake as bake

    def broken(*_, **__):
        raise RuntimeError("bad glyf")

    monkeypatch.setattr(bake, "trim_to_unicode", broken)
    doc_id = cors_client.post("/documents", files={"file": ("e.pdf", make_edit_pdf(), "application/pdf")}).json()["doc_id"]
    run = {"text": "Diganti", "font": {"kind": "bundled", "family": "Arimo"}, "size": 12, "color": "#000000"}
    edit = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": "g0", "box": {
        "rect": {"x": 72, "y": 88, "w": 300, "h": 16}, "lineHeight": 12, "paragraphs": [[run]],
        "layout": [{"baseline": 12, "segments": [{"x": 0, "text": "Diganti", "runIndex": 0}]}]}}
    r = cors_client.post(f"/documents/{doc_id}/export", json={"ops": [edit], "paragraphs_version": 3},
                         headers={"Origin": ORIGIN})
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "bake_failed" and "bad glyf" in r.json()["error"]["message"]
    assert r.headers.get("access-control-allow-origin") == ORIGIN


@pytest.mark.parametrize("path", ["export", "render-page"])
def test_paragraphs_version_is_accepted(client, path):
    """The web sends paragraphs_version (since M5): an API without the field would refuse every export (422)."""
    doc_id = client.post("/documents", files={"file": ("a.pdf", make_pdf(1), "application/pdf")}).json()["doc_id"]
    body = {"ops": [], "paragraphs_version": 3, **({"pageKey": "o0"} if path == "render-page" else {})}
    assert client.post(f"/documents/{doc_id}/{path}", json=body).status_code == 200
