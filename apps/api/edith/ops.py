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


class OriginalFont(Model):
    """A font embedded in the uploaded PDF (`ref` from GET /documents/{id}/text), reused as is."""
    kind: Literal["original"]
    ref: str = Field(pattern=r"^f\d+$")


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


class TextAdd(_Content):
    type: Literal["text.add"]
    box: TextBox


class TextEdit(_Content):
    """Replaces original paragraph `paragraphId` of the page's source page with `box`."""
    type: Literal["text.edit"]
    paragraphId: str = Field(pattern=r"^g\d+$")
    box: TextBox


class ImageAdd(_Content):
    type: Literal["image.add"]
    rect: Rect
    assetId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")


class ShapeAdd(_Content):
    type: Literal["shape.add"]
    kind: Literal["rect", "ellipse", "line", "arrow"]
    rect: Rect | None = None
    points: list[Point] | None = None
    stroke: HexColor
    fill: HexColor | None = None
    width: float = Field(ge=0, le=100)

    @model_validator(mode="after")
    def _geometry(self):
        if self.kind in ("rect", "ellipse") and self.rect is None:
            raise ValueError(f"{self.kind} needs rect")
        if self.kind in ("line", "arrow") and (self.points is None or len(self.points) != 2):
            raise ValueError(f"{self.kind} needs exactly 2 points")
        return self


class InkAdd(_Content):
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


class DocSrc(Model):
    doc: str
    index: int = Field(ge=0)


class BlankSize(Model):
    width: float = Field(gt=0, le=14400)
    height: float = Field(gt=0, le=14400)


class BlankSrc(Model):
    blank: BlankSize


class LayoutPage(Model):
    pageKey: PageKey
    src: DocSrc | BlankSrc
    rotate: Literal[0, 90, 180, 270] = 0


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


ContentOp = Union[TextAdd, TextEdit, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd]
Op = Annotated[
    Union[TextAdd, TextEdit, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd, PagesLayout],
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
