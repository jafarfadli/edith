from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_OPS = 5000
MAX_LAYOUT_PAGES = 2 * 500  # twice Settings.max_pages: room for duplicates and blanks

HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
PageKey = Annotated[str, Field(pattern=r"^(o\d+|u[0-9A-Za-z-]+)$")]
OpId = Annotated[str, Field(min_length=1, max_length=64)]
Point = Annotated[list[float], Field(min_length=2, max_length=2)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Rect(Model):
    x: float
    y: float
    w: float = Field(ge=0)
    h: float = Field(ge=0)


class BundledFont(Model):
    kind: Literal["bundled"] = "bundled"
    family: str
    bold: bool = False
    italic: bool = False


DocId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]


class OriginalFont(Model):
    """A font embedded in an uploaded PDF (`ref` from GET /documents/{id}/text), reused as is. `doc`: the
    imported PDF it comes from (xref-based refs are only unique per document); none = the edited PDF."""
    kind: Literal["original"]
    ref: str = Field(pattern=r"^f\d+$")
    doc: DocId | None = None


FontRef = Union[BundledFont, OriginalFont]


class Run(Model):
    text: str
    font: FontRef
    size: float = Field(gt=0, le=500)
    color: HexColor
    bgColor: HexColor | None = None
    underline: bool = False
    strike: bool = False


class Segment(Model):
    x: float
    text: str
    runIndex: int = Field(ge=0)


class LayoutLine(Model):
    baseline: float
    segments: list[Segment]


class TextBox(Model):
    rect: Rect
    align: Literal["left", "center", "right", "justify"] = "left"
    lineHeight: float = Field(gt=0)
    paragraphs: list[list[Run]]
    layout: list[LayoutLine]

    @model_validator(mode="after")
    def _run_indexes_in_range(self):
        n = sum(len(p) for p in self.paragraphs)
        for line in self.layout:
            for seg in line.segments:
                if seg.runIndex >= n:
                    raise ValueError(f"runIndex {seg.runIndex} out of range ({n} runs)")
        return self


class _Content(Model):
    id: OpId
    pageKey: PageKey


Opacity = Annotated[float, Field(ge=0, le=1)]
Rotation = Annotated[float, Field(ge=-360, le=360)]


class _Drawn(_Content):
    """Drawn objects can be translucent (`opacity`, 0–1)."""
    opacity: Opacity = 1


class _Rotatable(_Drawn):
    """Drawn objects placed by a rect also turn by `rotation` degrees (clockwise on screen) around the
    centre of that rect. Objects made of points (ink, lines, polygons) are rotated by moving their points."""
    rotation: Rotation = 0


class TextAdd(_Rotatable):
    type: Literal["text.add"]
    box: TextBox


class TextEdit(_Content):
    """Replaces original paragraph `paragraphId` of the page's source page with `box`."""
    type: Literal["text.edit"]
    paragraphId: str = Field(pattern=r"^g\d+$")
    box: TextBox


class ImageAdd(_Rotatable):
    type: Literal["image.add"]
    rect: Rect
    assetId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")


RECT_SHAPES = ("rect", "ellipse")
# Fewest points per point-based kind; line/arrow take exactly 2.
MIN_POINTS = {"line": 2, "arrow": 2, "polyline": 2, "polygon": 3, "cloud": 3}
MAX_SHAPE_POINTS = 1000


class ShapeAdd(_Rotatable):
    """rect/ellipse use `rect` (and may be rotated); the other kinds use `points` (closed for polygon and
    cloud; a cloud's border is scalloped, see bake/geometry.py) and keep `rotation` 0."""
    type: Literal["shape.add"]
    kind: Literal["rect", "ellipse", "line", "arrow", "polygon", "polyline", "cloud"]
    rect: Rect | None = None
    points: list[Point] | None = Field(default=None, max_length=MAX_SHAPE_POINTS)
    stroke: HexColor
    fill: HexColor | None = None
    width: float = Field(ge=0, le=100)
    dash: Literal["solid", "dashed", "dotted"] = "solid"

    @model_validator(mode="after")
    def _geometry(self):
        if self.kind in RECT_SHAPES:
            if self.rect is None or self.points is not None:
                raise ValueError(f"{self.kind} needs rect (and no points)")
            return self
        if self.points is None or self.rect is not None:
            raise ValueError(f"{self.kind} needs points (and no rect)")
        n = MIN_POINTS[self.kind]
        if len(self.points) < n or (self.kind in ("line", "arrow") and len(self.points) != n):
            raise ValueError(f"{self.kind} needs {'exactly' if self.kind in ('line', 'arrow') else 'at least'} {n} points")
        if self.rotation:
            raise ValueError(f"{self.kind} is rotated by its points (rotation must be 0)")
        return self


class InkAdd(_Drawn):
    type: Literal["ink.add"]
    paths: list[Annotated[list[Point], Field(min_length=1)]] = Field(min_length=1)
    color: HexColor
    width: float = Field(gt=0, le=100)


class WhiteoutAdd(_Content):
    type: Literal["whiteout.add"]
    rect: Rect


class RedactAdd(_Content):
    type: Literal["redact.add"]
    rect: Rect
    fill: Literal["black", "white"] = "black"


class SignatureAdd(_Rotatable):
    """A signature image (drawn, typed or uploaded; always a PNG/JPEG asset)."""
    type: Literal["signature.add"]
    rect: Rect
    assetId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")


# 17 English presets (spec) followed by their 17 Indonesian equivalents, in the same order.
STAMP_PRESETS = (
    "approved", "not-approved", "draft", "final", "completed", "confidential", "for-public-release",
    "not-for-public-release", "for-comment", "void", "preliminary-results", "information-only", "witness",
    "initial-here", "sign-here", "accepted", "rejected",
    "disetujui", "tidak-disetujui", "draf", "final-id", "selesai", "rahasia", "untuk-publik",
    "tidak-untuk-publik", "untuk-dikomentari", "batal", "hasil-sementara", "hanya-informasi", "saksi",
    "paraf-di-sini", "tanda-tangan-di-sini", "diterima", "ditolak",
)
StampPreset = Literal[STAMP_PRESETS]  # type: ignore[valid-type]


class StampCustom(Model):
    text: str = Field(min_length=1, max_length=60)
    date: str | None = Field(default=None, max_length=40)  # formatted by the client, drawn as is
    time: str | None = Field(default=None, max_length=20)


class StampAdd(_Rotatable):
    type: Literal["stamp.add"]
    rect: Rect
    preset: StampPreset | None = None
    custom: StampCustom | None = None
    color: HexColor

    @model_validator(mode="after")
    def _one_kind(self):
        if (self.preset is None) == (self.custom is None):
            raise ValueError("stamp needs exactly one of preset, custom")
        return self


class SymbolAdd(_Rotatable):
    type: Literal["symbol.add"]
    kind: Literal["check", "cross"]
    rect: Rect
    color: HexColor


class UrlTarget(Model):
    url: str = Field(max_length=2048, pattern=r"^(https?://|mailto:)\S+$")


class PageTarget(Model):
    pageKey: PageKey


class LinkAdd(_Content):
    type: Literal["link.add"]
    rect: Rect
    target: UrlTarget | PageTarget


class AnnotAdd(_Content):
    """A native PDF annotation: text markup over `quads` (one rect per line, horizontal text) or a
    sticky note whose icon's top-left corner is `point`."""
    type: Literal["annot.add"]
    kind: Literal["highlight", "underline", "strike", "note"]
    quads: list[Rect] | None = Field(default=None, min_length=1, max_length=2000)
    point: Point | None = None
    color: HexColor
    content: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def _geometry(self):
        if self.kind == "note":
            if self.point is None or self.quads is not None:
                raise ValueError("note needs point (and no quads)")
        elif self.quads is None or self.point is not None:
            raise ValueError(f"{self.kind} needs quads (and no point)")
        return self


class FormSet(Model):
    """Value of AcroForm field `fieldName` (every widget of that name): text/combo/list -> the string,
    checkbox -> bool, radio -> the on-state name of the chosen button (or "Off"). `doc`: a field of that
    imported PDF, named as in its own structure (the export may rename it when the name is taken); none =
    the edited PDF."""
    id: OpId
    type: Literal["form.set"]
    fieldName: str = Field(min_length=1, max_length=500)
    value: str | bool
    doc: DocId | None = None


class DocSrc(Model):
    doc: DocId
    index: int = Field(ge=0)


class BlankSize(Model):
    width: float = Field(gt=0, le=14400)
    height: float = Field(gt=0, le=14400)


class BlankSrc(Model):
    blank: BlankSize


class CropRect(Model):
    """Visible part of a page, in the page's own coordinates (unrotated, relative to its source CropBox)."""
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    w: float = Field(ge=1)
    h: float = Field(ge=1)


class LayoutPage(Model):
    """`src.doc` is the edited document or another uploaded one (an imported PDF)."""
    pageKey: PageKey
    src: DocSrc | BlankSrc
    rotate: Literal[0, 90, 180, 270] = 0
    crop: CropRect | None = None


class PagesLayout(Model):
    id: OpId
    type: Literal["pages.layout"]
    pages: list[LayoutPage] = Field(min_length=1, max_length=MAX_LAYOUT_PAGES)

    @model_validator(mode="after")
    def _unique_keys(self):
        keys = [p.pageKey for p in self.pages]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate pageKey in layout")
        return self


ContentOp = Union[TextAdd, TextEdit, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd,
                  SignatureAdd, StampAdd, SymbolAdd, LinkAdd, AnnotAdd]
Op = Annotated[
    Union[TextAdd, TextEdit, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd,
          SignatureAdd, StampAdd, SymbolAdd, LinkAdd, AnnotAdd, FormSet, PagesLayout],
    Field(discriminator="type"),
]


def _check_ops(ops: list) -> None:
    ids = [op.id for op in ops]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate op id")
    if sum(1 for op in ops if op.type == "pages.layout") > 1:
        raise ValueError("at most one pages.layout")
    edited = [(op.pageKey, op.paragraphId) for op in ops if op.type == "text.edit"]
    if len(edited) != len(set(edited)):
        raise ValueError("at most one text.edit per (pageKey, paragraphId)")
    fields = [(op.doc, op.fieldName) for op in ops if op.type == "form.set"]
    if len(fields) != len(set(fields)):
        raise ValueError("at most one form.set per (doc, fieldName)")


class ExportRequest(Model):
    ops: list[Op] = Field(max_length=MAX_OPS)
    flatten_forms: bool = False
    filename: str = Field(default="document.pdf", max_length=200)

    @model_validator(mode="after")
    def _ops(self):
        _check_ops(self.ops)
        return self


class RenderPageRequest(Model):
    pageKey: PageKey
    ops: list[Op] = Field(max_length=MAX_OPS)

    @model_validator(mode="after")
    def _ops(self):
        _check_ops(self.ops)
        return self
