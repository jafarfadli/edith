from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from edith.fonts import FontRegistry


@dataclass
class BakeContext:
    doc_id: str
    asset_path: Callable[[str], Path]
    fonts: FontRegistry
