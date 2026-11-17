"""Pas foto: a portrait photo with its background replaced by a plain colour (the red or blue that forms ask for), cut to
a photo size (3×4, 2×3, 4×6 cm) with the head placed as on an ID photo, at 300 dpi.

The person is told from the background by MODNet (portrait matting, Apache-2.0, 25 MB ONNX), run on the CPU with
onnxruntime: it gives a soft matte, so hair keeps its edge. The model is not in the repository: `python -m
edith.portrait fetch` downloads it into the models folder (settings.models_dir); without it the tool answers
model_unavailable."""
import hashlib
import sys
import threading
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import pymupdf

from edith.errors import BadOptions, ModelUnavailable, NoPerson
from edith.scan import decode

MODEL_URL = "https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx"
MODEL_SHA256 = "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9"
MODEL_FILE = "modnet.onnx"
# The matte is worked out with the photo's shorter side at this many pixels (sides a multiple of 32).
MATTE_SIDE = 512

COLOURS = {"red": (215, 25, 32), "blue": (30, 100, 200), "white": (255, 255, 255)}  # RGB
# Photo sizes, cm (width, height); "original" keeps the photo's own frame.
SIZES = {"3x4": (3.0, 4.0), "2x3": (2.0, 3.0), "4x6": (4.0, 6.0)}
DPI = 300
# Room above the head, as a share of the photo's height.
HEADROOM = 0.10

_sessions: dict[Path, object] = {}
_lock = threading.Lock()


def _session(path: Path):
    if not path.is_file():
        raise ModelUnavailable("the portrait model is not installed (python -m edith.portrait fetch)")
    with _lock:
        if path not in _sessions:
            import onnxruntime as ort
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2  # one person's photo; leave the cores to the rest of the server
            _sessions[path] = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
        return _sessions[path]


def matte(img: np.ndarray, model: Path, session=None) -> np.ndarray:
    """How much of each pixel is the person (0 to 1, float32, the photo's size). `session`: a stand-in for tests."""
    s = session or _session(model)
    h, w = img.shape[:2]
    k = MATTE_SIDE / min(h, w)
    nh, nw = (max(32, int(round(v * k / 32)) * 32) for v in (h, w))
    x = cv2.cvtColor(cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB).astype(np.float32)
    x = ((x / 255 - 0.5) / 0.5).transpose(2, 0, 1)[None]
    out = s.run(None, {s.get_inputs()[0].name: x})[0][0, 0]
    return np.clip(cv2.resize(out.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR), 0, 1)


def tidy(alpha: np.ndarray) -> np.ndarray:
    """The matte kept to one person: specks of background taken for the person dropped (only the biggest region
    stays, with its soft edge), and holes inside the person filled (a dark jacket read as background)."""
    solid = (alpha > 0.5).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
    if n <= 1:
        return alpha
    keep = (labels == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    near = cv2.dilate(keep, np.ones((15, 15), np.uint8)) > 0  # the soft edge around the person
    out = np.where(near, alpha, 0).astype(np.float32)
    # Holes: the regions of not-person that are not the real background. The real background reaches the top edge, or
    # is a big region at a side edge (beside the shoulders). Not the bottom edge: in a chest-up photo the body runs off
    # it, so a gap in the clothes open to the bottom, or a small one at a side, is inside the person.
    h, w = alpha.shape
    rows = np.flatnonzero(keep.any(axis=1))
    body_from = rows[0] + 0.5 * (h - rows[0])  # below the head: shoulders and chest
    m, hole_labels, hole_stats, centres = cv2.connectedComponentsWithStats((1 - keep).astype(np.uint8), connectivity=8)
    fill = np.zeros(alpha.shape, np.uint8)
    for i in range(1, m):
        x, y, cw, ch, area = hole_stats[i]
        at_side = x == 0 or x + cw == w
        if y == 0 or (at_side and area >= 0.01 * alpha.size):
            continue  # the background
        part = hole_labels == i
        # Only regions the model half saw as the person (real background between an arm and the body stays clear).
        # Small gaps between strands of hair are real background: around the head only holes of some size count.
        big = area >= 0.002 * alpha.size
        if float(alpha[part].mean()) > 0.15 and (big or centres[i][1] > body_from):
            fill[part] = 1
    if fill.any():  # with their rims: the matte's soft edge around such a hole is the same mistake
        grown = cv2.dilate(fill, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))).astype(np.float32)
        out = np.maximum(out, cv2.GaussianBlur(grown, (0, 0), 2))
    return out


def unmix(img: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """The person's own colours where the matte is partly see-through (hair, edges): the old background's colour,
    estimated around each pixel from where the matte is background, taken out of the mix. Without it the old
    background shows as a light (or dark) fringe on the new one."""
    a = alpha[..., None]
    f = img.astype(np.float32)
    weight = cv2.GaussianBlur(1 - alpha, (0, 0), 15)[..., None]
    bg = cv2.GaussianBlur(f * (1 - a), (0, 0), 15) / np.maximum(weight, 1e-3)
    fg = (f - (1 - a) * bg) / np.maximum(a, 0.05)
    mixed = np.where(a > 0.98, f, np.clip(fg, 0, 255))
    return mixed.astype(np.float32)


def frame(alpha: np.ndarray, ratio: float) -> tuple[int, int, int, int]:
    """Where to cut a photo of `ratio` (width / height): the top of the head HEADROOM below the top edge, the person
    centred, as tall as the photo allows. (x, y, w, h) in the photo's pixels."""
    h, w = alpha.shape
    rows = np.flatnonzero((alpha > 0.5).sum(axis=1) > max(3, w * 0.01))
    if not rows.size:
        raise NoPerson("no person found in the photo")
    top = int(rows[0])
    cols = np.flatnonzero(alpha[top: top + max(1, (h - top) // 3)].max(axis=0) > 0.5)  # the head and shoulders
    cx = (cols[0] + cols[-1]) / 2 if cols.size else w / 2
    ch = (h - top) / (1 - HEADROOM)
    y = top - HEADROOM * ch
    if y < 0:
        y, ch = 0.0, float(h)
    cw = ch * ratio
    if cw > w:
        cw, ch = float(w), w / ratio
    x = min(max(0.0, cx - cw / 2), w - cw)
    return int(round(x)), int(round(y)), int(round(cw)), int(round(ch))


def _hex(value: str) -> tuple[int, int, int]:
    v = value.strip().lstrip("#")
    if len(v) != 6 or any(c not in "0123456789abcdefABCDEF" for c in v):
        raise BadOptions(f"colour {value!r}", field="colour")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def pas_foto(data: bytes, name: str, colour: str, size: str, models_dir: Path, session=None) -> bytes:
    """The photo on `colour` (a name of COLOURS or #rrggbb), cut to `size` (SIZES or "original"), as a 300 dpi JPEG."""
    if size not in SIZES and size != "original":
        raise BadOptions(f"size {size!r}", field="size")
    rgb = COLOURS[colour] if colour in COLOURS else _hex(colour)
    img = decode(data, name)
    a = tidy(matte(img, models_dir / MODEL_FILE, session))
    a = np.clip((a - 0.04) / 0.92, 0, 1)  # the faintest haze of the matte is background
    bg = np.empty(img.shape, np.float32)
    bg[:] = rgb[::-1]
    out = (unmix(img, a) * a[..., None] + bg * (1 - a[..., None])).round().astype(np.uint8)
    if size != "original":
        cm_w, cm_h = SIZES[size]
        x, y, w, h = frame(a, cm_w / cm_h)
        px = (round(cm_w / 2.54 * DPI), round(cm_h / 2.54 * DPI))
        out = cv2.resize(out[y:y + h, x:x + w], px, interpolation=cv2.INTER_AREA if w > px[0] else cv2.INTER_CUBIC)
    pix = pymupdf.Pixmap(pymupdf.csRGB, out.shape[1], out.shape[0], cv2.cvtColor(out, cv2.COLOR_BGR2RGB).tobytes(), False)
    pix.set_dpi(DPI, DPI)
    return pix.tobytes("jpeg", jpg_quality=92)


def fetch(models_dir: Path) -> Path:
    """Downloads the model into `models_dir` (checked against its SHA-256) unless it is there already."""
    path = models_dir / MODEL_FILE
    if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == MODEL_SHA256:
        return path
    models_dir.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")
    urllib.request.urlretrieve(MODEL_URL, part)  # noqa: S310 - a fixed https URL
    if hashlib.sha256(part.read_bytes()).hexdigest() != MODEL_SHA256:
        part.unlink()
        raise RuntimeError("the downloaded model does not match its checksum")
    part.replace(path)
    return path


if __name__ == "__main__" and sys.argv[1:] == ["fetch"]:
    from edith.settings import Settings
    print(fetch(Settings().models_dir))
