from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from edith.fonts import FontRegistry

if TYPE_CHECKING:
    from edith.bake.source import SourcePages


@dataclass
class BakeContext:
    doc_id: str
    asset_path: Callable[[str], Path]
    fonts: FontRegistry
    source: "SourcePages | None" = None  # set by bake() for the duration of one bake
    page_index: dict[str, int] | None = None  # pageKey → output page index, set by bake() (links)
    # Bytes of another uploaded document (an imported PDF) by doc id; raises DocExpired / DocNotFound.
    load_source: Callable[[str], bytes] | None = None
