"""edith/scan.py: a phone photo of a sheet as a clean scanned page, and POST /tools/scan."""
import cv2
import numpy as np
import pymupdf
from fastapi.testclient import TestClient

from edith import scan
from edith.main import create_app
from edith.settings import Settings

CORNERS = np.array([[470, 110], [1150, 170], [1230, 1190], [390, 1140]], dtype=np.float32)  # tl, tr, br, bl


def photo(table: int = 70, corners: np.ndarray = CORNERS) -> np.ndarray:
    """A sheet with lines of "writing", photographed at an angle on a table, a shadow falling across it."""
    sheet = np.full((1100, 780, 3), 245, np.uint8)
    for y in range(120, 1000, 55):
        cv2.line(sheet, (80, y), (700 - (y % 3) * 90, y), (30, 30, 30), 6)
    cv2.rectangle(sheet, (80, 60), (300, 95), (40, 40, 200), -1)  # a red heading: colour kept
    img = np.full((1300, 1600, 3), table, np.uint8)
    src = np.array([[0, 0], [779, 0], [779, 1099], [0, 1099]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(src, corners)
    warped = cv2.warpPerspective(sheet, m, (1600, 1300))
    mask = cv2.warpPerspective(np.full(sheet.shape[:2], 255, np.uint8), m, (1600, 1300))
    img[mask > 0] = warped[mask > 0]
    shade = np.tile(np.linspace(1.0, 0.6, 1600, dtype=np.float32), (1300, 1))[..., None]  # darker to the right
    return (img * shade).astype(np.uint8)


def jpeg(img: np.ndarray) -> bytes:
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tobytes()


def test_order_puts_corners_clockwise_from_top_left():
    shuffled = CORNERS[[2, 0, 3, 1]]
    assert np.allclose(scan.order(shuffled), CORNERS)


def test_finds_the_sheet_on_a_dark_table_and_on_a_light_one():
    for table in (60, 200):
        found = scan.find_sheet(photo(table))
        assert found is not None, table
        assert np.abs(found - CORNERS).max() < 25, (table, found)


def test_no_sheet_in_a_plain_photo():
    noise = np.random.default_rng(1).integers(90, 140, (900, 1200, 3), dtype=np.uint8)
    assert scan.find_sheet(noise) is None


def test_scanned_page_is_straight_white_and_keeps_the_ink():
    img = scan.decode(jpeg(photo()), "a.jpg")
    flat = scan.enhance(scan.straighten(img, scan.find_sheet(img)), "color")
    h, w = flat.shape[:2]
    assert 1.15 < h / w < 1.55  # about the sheet's own proportion (1100 × 780), not the photo's
    paper = flat[int(h * 0.97):, :]  # the bottom margin, under the shadow too
    assert paper.mean() > 225 and paper[:, int(w * 0.8):].mean() > 220
    gray = cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY)
    assert (gray < 90).mean() > 0.02  # the lines stay dark
    b, g, r = flat[int(h * 0.07), int(w * 0.25)].astype(int)
    assert r > b + 60  # the heading is still red


def test_bw_is_black_and_white_only():
    p = scan.scan_page(jpeg(photo()), "a.jpg", "bw", True)
    assert p.extension == "png" and p.found
    page = cv2.imdecode(np.frombuffer(p.data, np.uint8), cv2.IMREAD_GRAYSCALE)
    assert set(np.unique(page)) <= {0, 255}
    assert (page == 255).mean() > 0.8


def test_without_crop_the_whole_photo_is_kept():
    p = scan.scan_page(jpeg(photo()), "a.jpg", "original", False)
    page = cv2.imdecode(np.frombuffer(p.data, np.uint8), cv2.IMREAD_COLOR)
    assert not p.found and page.shape[:2] == (1300, 1600)


def test_route_makes_one_a4_page_per_photo(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path / "data"))) as c:
        files = [("files", (f"foto{i}.jpg", jpeg(photo()), "image/jpeg")) for i in range(2)]
        r = c.post("/tools/scan", files=files, data={"scan_mode": "gray", "size": "a4"})
        assert r.status_code == 200, r.text
        assert "foto0-scan.pdf" in r.headers["content-disposition"]
        doc = pymupdf.open("pdf", r.content)
        assert doc.page_count == 2
        assert (round(doc[0].rect.width), round(doc[0].rect.height)) == (595, 842)  # the sheet stands: A4 upright

        bad = c.post("/tools/scan", files=[("files", ("x.jpg", b"not a picture", "image/jpeg"))])
        assert bad.status_code == 400
        wrong = c.post("/tools/scan", files=[("files", ("a.jpg", jpeg(photo()), "image/jpeg"))], data={"scan_mode": "sepia"})
        assert wrong.status_code == 400
