import pymupdf
import pytest

from tests.pdfs import (make_cyclic_first_form_pdf, make_cyclic_form_pdf, make_form_pdf, make_merged_form_pdf, make_pdf,
                        make_same_name_form_pdf)
from tests.test_documents import upload


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


@pytest.fixture
def doc_id(client) -> str:
    return upload(client, make_form_pdf()).json()["doc_id"]


def export(client, doc_id: str, ops: list, flatten: bool = False) -> pymupdf.Document:
    r = client.post(f"/documents/{doc_id}/export", json={"ops": ops, "flatten_forms": flatten})
    assert r.status_code == 200, r.text
    return pymupdf.open(stream=r.content, filetype="pdf")


def values(doc: pymupdf.Document) -> dict[str, list]:
    out: dict[str, list] = {}
    for page in doc:
        for w in page.widgets():
            out.setdefault(w.field_name, []).append(w.field_value)
    return out


def form_set(op_id: str, name: str, value) -> dict:
    return {"id": op_id, "type": "form.set", "fieldName": name, "value": value}


def layout(doc_id: str, *indexes: int) -> dict:
    keys = {}
    pages = []
    for i in indexes:
        key = f"o{i}" if i not in keys else f"u-dup{i}"
        keys[i] = key
        pages.append({"pageKey": key, "src": {"doc": doc_id, "index": i}})
    return {"id": "L", "type": "pages.layout", "pages": pages}


def test_structure_lists_fields(client, doc_id):
    fields = client.get(f"/documents/{doc_id}/structure").json()["fields"]
    assert [(f["name"], f["type"], f["page"]) for f in fields] == [
        ("nama", "text", 0), ("catatan", "text", 0), ("setuju", "checkbox", 0), ("warna", "radio", 0), ("warna", "radio", 0),
        ("kota", "combo", 0), ("hari", "list", 0), ("kirim", "button", 0), ("hal2", "text", 1)]
    by = {(f["name"], f["onState"]): f for f in fields}
    assert by[("nama", None)] | {"rect": None} == {
        "name": "nama", "type": "text", "value": "", "onState": None, "options": None, "page": 0, "rect": None,
        "readOnly": False, "multiline": False, "fontSize": 11}
    assert by[("nama", None)]["rect"] == R(72, 100, 200, 20)
    assert by[("catatan", None)]["multiline"] is True
    assert by[("setuju", "Yes")]["value"] == "Off"
    assert {f["onState"] for f in fields if f["name"] == "warna"} == {"Merah", "Biru"}
    assert by[("kota", None)]["options"] == ["Jakarta", "Bandung", "Surabaya"] and by[("kota", None)]["value"] == "Jakarta"


def test_structure_of_pdf_without_form(client):
    doc_id = upload(client, make_pdf(pages=1)).json()["doc_id"]
    assert client.get(f"/documents/{doc_id}/structure").json()["fields"] == []


def test_fill_every_kind(client, doc_id):
    out = export(client, doc_id, [
        form_set("a", "nama", "Budi Santoso"), form_set("b", "catatan", "baris 1\nbaris 2"), form_set("c", "setuju", True),
        form_set("d", "warna", "Biru"), form_set("e", "kota", "Bandung"), form_set("f", "hari", "Selasa"),
        form_set("g", "hal2", "di halaman dua")])
    v = values(out)
    assert v["nama"] == ["Budi Santoso"] and v["catatan"] == ["baris 1\nbaris 2"] and v["setuju"] == ["Yes"]
    assert v["warna"] == ["Off", "Biru"] and v["kota"] == ["Bandung"] and v["hari"] == ["Selasa"]
    assert v["hal2"] == ["di halaman dua"]
    assert out.is_form_pdf


def test_radio_switches_and_checkbox_unchecks(client, doc_id):
    first = export(client, doc_id, [form_set("a", "warna", "Merah"), form_set("b", "setuju", False)])
    assert values(first)["warna"] == ["Merah", "Off"] and values(first)["setuju"] == ["Off"]


def test_form_survives_reorder_and_page_delete(client, doc_id):
    """Document.select() drops /AcroForm (PyMuPDF 2.1): the bake puts it back with the remaining fields."""
    out = export(client, doc_id, [layout(doc_id, 1, 0), form_set("a", "nama", "X")])
    assert out.is_form_pdf and values(out)["nama"] == ["X"]
    assert [w.field_name for w in out[0].widgets()] == ["hal2"]
    only = export(client, doc_id, [layout(doc_id, 1), form_set("a", "nama", "gone")])  # nama's page was deleted: ignored
    assert only.is_form_pdf and list(values(only)) == ["hal2"]
    kind, fields = only.xref_get_key(int(only.xref_get_key(only.pdf_catalog(), "AcroForm")[1].split()[0]), "Fields")
    assert kind == "array" and len(fields.strip("[]").split()) == 3  # one field: "x 0 R"


def test_export_without_form_ops_keeps_the_form(client, doc_id):
    out = export(client, doc_id, [])
    assert out.is_form_pdf and len(values(out)) == 8


def test_duplicated_page_shows_the_value_on_both_copies(client, doc_id):
    out = export(client, doc_id, [layout(doc_id, 0, 0), form_set("a", "nama", "Dua kali")])
    assert values(out)["nama"] == ["Dua kali", "Dua kali"]
    flat = export(client, doc_id, [layout(doc_id, 0, 0), form_set("a", "nama", "Dua kali")], flatten=True)
    assert all("Dua kali" in page.get_text() for page in flat)  # both appearances were regenerated


def test_flatten_turns_fields_into_content_and_keeps_other_annotations(client, doc_id):
    out = export(client, doc_id, [
        form_set("a", "nama", "Budi Santoso"), form_set("c", "setuju", True),
        {"id": "h", "type": "annot.add", "pageKey": "o0", "kind": "highlight", "quads": [R(72, 79.2, 60, 13.8)], "color": "#ffeb3b"},
        {"id": "l", "type": "link.add", "pageKey": "o0", "rect": R(72, 300, 100, 20), "target": {"pageKey": "o1"}},
    ], flatten=True)
    assert not out.is_form_pdf and values(out) == {}
    assert "Budi Santoso" in out[0].get_text()
    assert [a.type[1] for a in out[0].annots()] == ["Highlight"]
    assert out[0].get_links()[0]["page"] == 1


def test_wrong_value_kind_is_bake_failed(client, doc_id):
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [form_set("bad", "setuju", "ya")]})
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "bake_failed" and r.json()["error"]["op_id"] == "bad"


def _fields_array(doc: pymupdf.Document) -> list[int]:
    acro = int(doc.xref_get_key(doc.pdf_catalog(), "AcroForm")[1].split()[0])
    refs = doc.xref_get_key(acro, "Fields")[1].strip("[]").split()
    return [int(refs[i]) for i in range(0, len(refs), 3)]


def test_duplicated_merged_widget_becomes_one_field(client):
    doc_id = upload(client, make_merged_form_pdf()).json()["doc_id"]
    out = export(client, doc_id, [layout(doc_id, 0, 0), form_set("a", "nama", "Dua")])
    assert out.is_form_pdf and values(out) == {"nama": ["Dua", "Dua"]}
    fields = _fields_array(out)
    assert len(fields) == 1
    assert out.xref_get_key(fields[0], "T")[1] == "nama" and out.xref_get_key(fields[0], "FT")[1] == "/Tx"
    for page in out:
        for w in page.widgets():
            assert out.xref_get_key(w.xref, "Parent")[1] == f"{fields[0]} 0 R"
            assert out.xref_get_key(w.xref, "T")[0] == "null"
            assert out.xref_get_key(w.xref, "P")[1] == f"{page.xref} 0 R"


def test_malformed_widget_does_not_break_structure_or_export(client):
    r = upload(client, make_cyclic_form_pdf())
    assert r.status_code == 201
    doc_id = r.json()["doc_id"]
    assert client.get(f"/documents/{doc_id}/structure").status_code == 200
    assert client.post(f"/documents/{doc_id}/export", json={"ops": []}).status_code == 200


def test_acroform_defaults_survive_export(client):
    doc_id = upload(client, make_merged_form_pdf()).json()["doc_id"]
    out = export(client, doc_id, [])
    acro = int(out.xref_get_key(out.pdf_catalog(), "AcroForm")[1].split()[0])
    assert out.xref_get_key(acro, "NeedAppearances")[1] == "true"
    assert out.xref_get_key(acro, "DA")[0] == "string"
    assert out.xref_get_key(acro, "DR")[0] in ("dict", "xref")


def test_same_name_source_fields_are_left_alone(client):
    doc_id = upload(client, make_same_name_form_pdf()).json()["doc_id"]
    src = pymupdf.open(stream=make_same_name_form_pdf(), filetype="pdf")
    out = export(client, doc_id, [])
    shape = lambda d: [(w.field_name, w.field_type, w.field_value, w.field_flags) for p in d for w in p.widgets()]  # noqa: E731
    assert shape(out) == shape(src)
    assert [w.field_type for w in out[0].widgets()][:2] == [pymupdf.PDF_WIDGET_TYPE_TEXT, pymupdf.PDF_WIDGET_TYPE_CHECKBOX]
    assert len(_fields_array(out)) == 4


def test_healthy_widget_after_a_cyclic_one_is_listed(client):
    doc_id = upload(client, make_cyclic_first_form_pdf()).json()["doc_id"]
    fields = client.get(f"/documents/{doc_id}/structure").json()["fields"]
    assert "ok" in [f["name"] for f in fields]
    out = export(client, doc_id, [form_set("a", "ok", "baru")])
    assert values(out)["ok"] == ["baru"]
