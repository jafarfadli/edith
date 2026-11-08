"""Shape geometry shared with apps/web/src/lib/geometry.ts — change both together (both test suites pin
the same numbers).

- Dash patterns, in multiples of the stroke width w' = max(width, 0.5): dashed = [3w', 2w'] with butt caps,
  dotted = [0, 2w'] with round caps (round dots).
- Cloud border: each edge of the closed polygon is split into n = floor(len / arc + 0.5) (at least 1)
  equal chords, arc = CLOUD_ARC + CLOUD_ARC_PER_WIDTH · width; every chord gets a half circle bulging
  out of the polygon, drawn as two cubic Béziers (KAPPA)."""
import math

Pt = tuple[float, float]
Bezier = tuple[Pt, Pt, Pt, Pt]

KAPPA = 0.5522847498  # 4/3·tan(π/8): a quarter circle as one cubic Bézier
CLOUD_ARC = 8.0
CLOUD_ARC_PER_WIDTH = 2.0
BUTT, ROUND = 0, 1


def dash_pattern(dash: str, width: float) -> tuple[list[float], int] | None:
    """(PDF dash array, line cap) of a non-solid stroke, None for solid."""
    w = max(width, 0.5)
    if dash == "dashed":
        return [3 * w, 2 * w], BUTT
    if dash == "dotted":
        return [0, 2 * w], ROUND
    return None


def dashes_arg(pattern: list[float]) -> str:
    """The `dashes` argument of PyMuPDF's drawing methods."""
    return "[" + " ".join(f"{v:g}" for v in pattern) + "] 0"


def signed_area2(points: list[Pt]) -> float:
    """Twice the signed area (shoelace); > 0 means clockwise on screen (y grows down)."""
    n = len(points)
    return sum(points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1] for i in range(n))


def cloud_beziers(points: list[Pt], width: float) -> list[Bezier]:
    """The scalloped border of the closed polygon `points`, as consecutive cubic Béziers."""
    arc = CLOUD_ARC + CLOUD_ARC_PER_WIDTH * width
    clockwise = signed_area2(points) > 0
    out: list[Bezier] = []
    n = len(points)
    for i in range(n):
        (px, py), (qx, qy) = points[i], points[(i + 1) % n]
        length = math.hypot(qx - px, qy - py)
        if length == 0:
            continue
        ux, uy = (qx - px) / length, (qy - py) / length
        nx, ny = (uy, -ux) if clockwise else (-uy, ux)  # outward normal
        count = max(1, math.floor(length / arc + 0.5))
        for k in range(count):
            ax, ay = px + (qx - px) * k / count, py + (qy - py) * k / count
            bx, by = px + (qx - px) * (k + 1) / count, py + (qy - py) * (k + 1) / count
            r = length / count / 2
            mx, my = (ax + bx) / 2, (ay + by) / 2
            top = (mx + r * nx, my + r * ny)
            k_r = KAPPA * r
            out.append(((ax, ay), (ax + k_r * nx, ay + k_r * ny), (top[0] - k_r * ux, top[1] - k_r * uy), top))
            out.append((top, (top[0] + k_r * ux, top[1] + k_r * uy), (bx + k_r * nx, by + k_r * ny), (bx, by)))
    return out
