"""Default locations of the harness scripts, derived from the repo (this file sits in
docs/superpowers/plans/<plan>/harness/) or the environment: EDITH_REPO, OUT (results), REFS (reference PDFs)."""
import os
import tempfile
from pathlib import Path

REPO = Path(os.environ.get("EDITH_REPO") or Path(__file__).resolve().parents[5])
OUT = Path(os.environ.get("OUT") or Path(tempfile.gettempdir()) / "edith-harness" / "out")
REFS = Path(os.environ.get("REFS") or REPO / "references")
