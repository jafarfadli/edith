"""AcroForm fields: what the editor shows (structure), filling them (form.set) and keeping the form
intact through the page rebuild of the bake."""
import logging

import pymupdf

from edith.ops import FormSet

FIELD_TYPES = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "text", pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radio", pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "combo",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "list", pymupdf.PDF_WIDGET_TYPE_BUTTON: "button",
    pymupdf.PDF_WIDGET_TYPE_SIGNATURE: "signature",
}
log = logging.getLogger(__name__)
READ_ONLY = 1  # PDF field flag bit 1


class FieldValueError(ValueError):
    def __init__(self, op: FormSet, message: str):
        super().__init__(message)
        self.op_id = op.id


def _num(v: float) -> float:
    return round(v, 2)


def _value(w: pymupdf.Widget) -> str:
    v = w.field_value
    if isinstance(v, list):  # multi-select list box: the editor edits one value
        v = v[0] if v else ""
    if isinstance(v, bool):
        return w.on_state() if v else "Off"
    return "" if v is None else str(v)


def _safe_widgets(page: pymupdf.Page):
    """Widgets of a page, each loaded on its own: one MuPDF cannot read (e.g. a /Parent cycle) is skipped."""
    try:
        xrefs = [x for x, kind, *_ in page.annot_xrefs() if kind == pymupdf.PDF_ANNOT_WIDGET]
    except Exception as exc:  # noqa: BLE001
        log.warning("skipping unreadable widgets on page %s: %s", page.number, exc)
        return
    for xref in xrefs:
        try:
            w = page.load_widget(xref)
        except Exception as exc:  # noqa: BLE001
            log.warning("skipping unreadable widget %s on page %s: %s", xref, page.number, exc)
            continue
        if w is not None:
            yield w


def _field_entry(w: pymupdf.Widget, page_number: int) -> dict | None:
    kind = FIELD_TYPES.get(w.field_type)
    if kind is None:
        return None
    r = w.rect
    return {
        "name": w.field_name, "type": kind, "value": _value(w),
        "onState": w.on_state() if kind in ("checkbox", "radio") else None,
        "options": list(w.choice_values or []) if kind in ("combo", "list") else None,
        "page": page_number,
        "rect": {"x": _num(r.x0), "y": _num(r.y0), "w": _num(r.width), "h": _num(r.height)},
        "readOnly": bool(w.field_flags & READ_ONLY),
        "multiline": kind == "text" and bool(w.field_flags & pymupdf.PDF_TX_FIELD_IS_MULTILINE),
        "fontSize": _num(w.text_fontsize or 0),  # 0 = auto
    }


def page_fields(page: pymupdf.Page) -> list[dict]:
    """One entry per widget, in unrotated-CropBox points. Radio buttons of one group share `name`;
    each has its own `onState` (the group's value when it is the chosen one). Malformed widgets are skipped."""
    out = []
    for w in _safe_widgets(page):
        try:
            entry = _field_entry(w, page.number)
        except Exception as exc:  # noqa: BLE001
            log.warning("skipping malformed widget on page %s: %s", page.number, exc)
            continue
        if entry is not None:
            out.append(entry)
    return out


def extract_fields(doc: pymupdf.Document) -> list[dict]:
    break_parent_cycles(doc)  # same view as the export (works on the caller's in-memory copy)
    out = []
    for page in doc:
        try:
            out.extend(page_fields(page))
        except Exception as exc:  # noqa: BLE001
            log.warning("skipping form fields of page %s: %s", page.number, exc)
    return out


def fill_forms(doc: pymupdf.Document, ops: list[FormSet]) -> None:
    """Sets every widget named by a form.set op and regenerates its appearance. Names no page has any
    more (the page was deleted) are ignored. Raises FieldValueError on a value of the wrong kind."""
    wanted = {op.fieldName: op for op in ops}
    if not wanted:
        return
    for page in doc:
        widgets = [w for w in _safe_widgets(page) if w.field_name in wanted]
        # Radio buttons: switch the others off first, then the chosen one on.
        widgets.sort(key=lambda w: w.field_type == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON
                     and w.on_state() == wanted[w.field_name].value)
        for w in widgets:
            op = wanted[w.field_name]
            kind = FIELD_TYPES.get(w.field_type)
            if kind == "checkbox":
                if not isinstance(op.value, bool):
                    raise FieldValueError(op, f"field {op.fieldName!r} is a checkbox: value must be true/false")
                w.field_value = op.value
            elif kind == "radio":
                if not isinstance(op.value, str):
                    raise FieldValueError(op, f"field {op.fieldName!r} is a radio group: value must be an on-state name")
                w.field_value = w.on_state() == op.value
            elif kind in ("text", "combo", "list"):
                if not isinstance(op.value, str):
                    raise FieldValueError(op, f"field {op.fieldName!r} needs a text value")
                w.field_value = op.value
            else:
                continue  # buttons and signature fields have no value to set
            w.update()


def _adopt(doc: pymupdf.Document, xref: int, page_xref: int) -> None:
    """Lists widget `xref` in its parent's /Kids: Document.fullcopy_page() copies a page's widgets with
    their /Parent, but the parent does not know the copy (and PyMuPDF refuses to update it). Every widget's
    /P is pointed at the page it is on."""
    doc.xref_set_key(xref, "P", f"{page_xref} 0 R")
    kind, value = doc.xref_get_key(xref, "Parent")
    if kind != "xref":
        return
    parent = int(value.split()[0])
    kind, kids = doc.xref_get_key(parent, "Kids")
    refs = kids.strip("[]").split() if kind == "array" else []
    listed = {int(refs[i]) for i in range(0, len(refs) - 2, 3)}
    if xref not in listed:
        doc.xref_set_key(parent, "Kids", "[" + " ".join(refs + [str(xref), "0", "R"]) + "]")


def _root_field(doc: pymupdf.Document, xref: int) -> int:
    for _ in range(64):  # a /Parent cycle must not hang or recurse
        kind, value = doc.xref_get_key(xref, "Parent")
        if kind != "xref":
            return xref
        xref = int(value.split()[0])
    raise ValueError("field /Parent chain too deep (cycle?)")


# Field-level keys: they belong on the parent when several widgets share one field.
FIELD_KEYS = ("T", "TU", "TM", "FT", "Ff", "V", "DV", "Opt", "DA", "Q", "MaxLen", "I", "TI", "RV", "DS")


def widget_xrefs(page: pymupdf.Page) -> list[int]:
    return [x for x, kind, *_ in page.annot_xrefs() if kind == pymupdf.PDF_ANNOT_WIDGET]


def _merge_copies(doc: pymupdf.Document, roots: list[int], copies: dict[int, int]) -> list[int]:
    """`copies` maps a widget made by fullcopy_page in this bake to the widget it was copied from. When that
    original is a merged field/widget dictionary (no /Parent), original and copies become the /Kids of one
    new parent field that takes the field-level keys. Fields that merely share a name are left alone."""
    by_orig: dict[int, list[int]] = {}
    for copy, orig in copies.items():
        by_orig.setdefault(orig, []).append(copy)
    replaced: dict[int, int | None] = {}
    for orig, dups in by_orig.items():
        if doc.xref_get_key(orig, "Parent")[0] == "xref" or doc.xref_get_key(orig, "T")[0] != "string":
            continue
        group = [orig, *dups]
        parent = doc.get_new_xref()
        doc.update_object(parent, "<<>>")
        for key in FIELD_KEYS:
            kind, value = doc.xref_get_key(orig, key)
            if kind != "null":
                doc.xref_set_key(parent, key, pymupdf.get_pdf_str(value) if kind == "string" else value)
        for x in group:
            for key in FIELD_KEYS:
                doc.xref_set_key(x, key, "null")
            doc.xref_set_key(x, "Parent", f"{parent} 0 R")
        doc.xref_set_key(parent, "Kids", "[" + " ".join(f"{x} 0 R" for x in group) + "]")
        replaced[orig] = parent
        replaced.update({x: None for x in dups})
    return [replaced.get(x, x) for x in roots if replaced.get(x, x) is not None]


def break_parent_cycles(doc: pymupdf.Document) -> None:
    """MuPDF's page rebuild fails on a /Parent cycle: cut the loop at the widget (it becomes standalone)."""
    for page in doc:
        for xref, *_ in page.annot_xrefs():
            seen, x = {xref}, xref
            while True:
                kind, value = doc.xref_get_key(x, "Parent")
                if kind != "xref":
                    break
                x = int(value.split()[0])
                if x in seen:
                    log.warning("cutting a /Parent cycle at widget %s", xref)
                    doc.xref_set_key(xref, "Parent", "null")
                    break
                seen.add(x)


def detach_acroform(doc: pymupdf.Document) -> int | None:
    """The xref of the document's AcroForm dictionary (made indirect when inline), before
    Document.select() — which drops /AcroForm from the catalog (PyMuPDF 2.1)."""
    break_parent_cycles(doc)
    kind, value = doc.xref_get_key(doc.pdf_catalog(), "AcroForm")
    if kind == "xref":
        return int(value.split()[0])
    if kind == "dict":
        xref = doc.get_new_xref()
        doc.update_object(xref, value)
        return xref
    return None


def reattach_acroform(doc: pymupdf.Document, xref: int | None, copies: dict[int, int] | None = None) -> None:
    """Puts the AcroForm back with /Fields = the root fields of the widgets still on the pages. Widgets
    that cannot be traced to a root are skipped; a form that cannot be rebuilt at all is dropped."""
    if xref is None:
        return
    try:
        roots: list[int] = []
        for page in doc:
            for w in _safe_widgets(page):
                try:
                    _adopt(doc, w.xref, page.xref)
                    root = _root_field(doc, w.xref)
                except Exception as exc:  # noqa: BLE001
                    log.warning("skipping malformed widget on page %s: %s", page.number, exc)
                    continue
                if root not in roots:
                    roots.append(root)
        roots = _merge_copies(doc, roots, copies or {})
        doc.xref_set_key(xref, "Fields", "[" + " ".join(f"{r} 0 R" for r in roots) + "]")
        doc.xref_set_key(doc.pdf_catalog(), "AcroForm", f"{xref} 0 R")
    except Exception as exc:  # noqa: BLE001
        log.warning("dropping the AcroForm, it could not be rebuilt: %s", exc)
