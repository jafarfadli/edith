"""AcroForm fields: what the editor shows (structure), filling them (form.set) and keeping the form
intact through the page rebuild of the bake."""
import pymupdf

from edith.ops import FormSet

FIELD_TYPES = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "text", pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radio", pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "combo",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "list", pymupdf.PDF_WIDGET_TYPE_BUTTON: "button",
    pymupdf.PDF_WIDGET_TYPE_SIGNATURE: "signature",
}
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


def page_fields(page: pymupdf.Page) -> list[dict]:
    """One entry per widget, in unrotated-CropBox points. Radio buttons of one group share `name`;
    each has its own `onState` (the group's value when it is the chosen one)."""
    out = []
    for w in page.widgets():
        kind = FIELD_TYPES.get(w.field_type)
        if kind is None:
            continue
        r = w.rect
        out.append({
            "name": w.field_name, "type": kind, "value": _value(w),
            "onState": w.on_state() if kind in ("checkbox", "radio") else None,
            "options": list(w.choice_values or []) if kind in ("combo", "list") else None,
            "page": page.number,
            "rect": {"x": _num(r.x0), "y": _num(r.y0), "w": _num(r.width), "h": _num(r.height)},
            "readOnly": bool(w.field_flags & READ_ONLY),
            "multiline": kind == "text" and bool(w.field_flags & pymupdf.PDF_TX_FIELD_IS_MULTILINE),
            "fontSize": _num(w.text_fontsize or 0),  # 0 = auto
        })
    return out


def extract_fields(doc: pymupdf.Document) -> list[dict]:
    return [f for page in doc for f in page_fields(page)]


def fill_forms(doc: pymupdf.Document, ops: list[FormSet]) -> None:
    """Sets every widget named by a form.set op and regenerates its appearance. Names no page has any
    more (the page was deleted) are ignored. Raises FieldValueError on a value of the wrong kind."""
    wanted = {op.fieldName: op for op in ops}
    if not wanted:
        return
    for page in doc:
        widgets = [w for w in page.widgets() if w.field_name in wanted]
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


def _adopt(doc: pymupdf.Document, xref: int) -> None:
    """Lists widget `xref` in its parent's /Kids: Document.fullcopy_page() copies a page's widgets with
    their /Parent, but the parent does not know the copy (and PyMuPDF refuses to update it)."""
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
    while True:
        kind, value = doc.xref_get_key(xref, "Parent")
        if kind != "xref":
            return xref
        xref = int(value.split()[0])


def detach_acroform(doc: pymupdf.Document) -> int | None:
    """The xref of the document's AcroForm dictionary (made indirect when inline), before
    Document.select() — which drops /AcroForm from the catalog (PyMuPDF 2.1)."""
    kind, value = doc.xref_get_key(doc.pdf_catalog(), "AcroForm")
    if kind == "xref":
        return int(value.split()[0])
    if kind == "dict":
        xref = doc.get_new_xref()
        doc.update_object(xref, value)
        return xref
    return None


def reattach_acroform(doc: pymupdf.Document, xref: int | None) -> None:
    """Puts the AcroForm back with /Fields = the root fields of the widgets still on the pages."""
    if xref is None:
        return
    roots: list[int] = []
    for page in doc:
        for w in page.widgets():
            _adopt(doc, w.xref)
            root = _root_field(doc, w.xref)
            if root not in roots:
                roots.append(root)
    doc.xref_set_key(xref, "Fields", "[" + " ".join(f"{r} 0 R" for r in roots) + "]")
    doc.xref_set_key(doc.pdf_catalog(), "AcroForm", f"{xref} 0 R")
