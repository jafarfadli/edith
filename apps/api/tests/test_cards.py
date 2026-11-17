"""edith/cards.py: ID cards from photos onto one sheet at their real size. The photos are drawn here: a made-up card
(light blue, black writing) lying slanted on a darker table."""
import shutil

import cv2
import numpy as np
import pymupdf
import pytest
from fastapi.testclient import TestClient

from edith import cards
from edith.cards import CARD, MM
from edith.main import create_app
from edith.settings import Settings

CARD_PX = (856, 540)


def card_face(label: str) -> np.ndarray:
    """A made-up card, landscape, with lines of writing (enough for orientation detection)."""
    img = np.full((CARD_PX[1], CARD_PX[0], 3), (235, 215, 185), np.uint8)
    cv2.rectangle(img, (0, 0), (CARD_PX[0], 70), (200, 150, 90), -1)
    lines = [label, "PROVINSI CONTOH JAYA", "KABUPATEN CONTOH", "NAMA : BUDI CONTOH", "TEMPAT LAHIR : KOTA CONTOH",
             "ALAMAT : JALAN CONTOH NOMOR 12", "PEKERJAAN : PELAJAR", "BERLAKU HINGGA : SEUMUR HIDUP"]
    for i, text in enumerate(lines):
        cv2.putText(img, text, (30, 50 + i * 60), cv2.FONT_HERSHEY_SIMPLEX, 1.0 if i else 1.2, (20, 20, 20), 2, cv2.LINE_AA)
    return img


def photo(face: np.ndarray, turn: int = 0) -> bytes:
    """`face` (turned `turn` degrees clockwise) lying slanted on a brown table, 1600 × 1200, as a JPEG."""
    if turn:
        face = cv2.rotate(face, {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[turn])
    h, w = face.shape[:2]
    table = np.full((1200, 1600, 3), (60, 90, 130), np.uint8)
    table = cv2.add(table, np.random.default_rng(1).integers(0, 18, table.shape, dtype=np.uint8))
    cx, cy = 800, 600
    k = 900 / max(w, h)
    dst = np.float32([[cx - w * k / 2 + 30, cy - h * k / 2], [cx + w * k / 2, cy - h * k / 2 + 25],
                      [cx + w * k / 2 - 20, cy + h * k / 2], [cx - w * k / 2, cy + h * k / 2 - 15]])
    m = cv2.getPerspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]), dst)
    warped = cv2.warpPerspective(face, m, (1600, 1200))
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), m, (1600, 1200))
    table[mask > 0] = warped[mask > 0]
    return cv2.imencode(".jpg", table, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tobytes()


def test_the_card_is_found_by_its_shape():
    img = cv2.imdecode(np.frombuffer(photo(card_face("DEPAN")), np.uint8), cv2.IMREAD_COLOR)
    corners = cards.find_card(img)
    assert corners is not None
    w = np.linalg.norm(corners[1] - corners[0])
    assert 780 < w < 920


def test_two_cards_one_above_the_other_at_real_size():
    out = cards.cards_to_pdf([(photo(card_face("DEPAN")), "depan.jpg"), (photo(card_face("BELAKANG")), "belakang.jpg")],
                             "a4", "color", "real", None)
    doc = pymupdf.open("pdf", out.data)
    assert doc.page_count == 1
    page = doc[0]
    assert abs(page.rect.width - 210 * MM) < 1 and abs(page.rect.height - 297 * MM) < 1
    boxes = sorted({tuple(r) for x in page.get_images() for r in page.get_image_rects(x[0])})
    boxes = [pymupdf.Rect(b) for b in boxes]
    assert len(boxes) == 2
    for r in boxes:
        assert abs(r.width - CARD[0] * MM) < 0.5 and abs(r.height - CARD[1] * MM) < 0.5  # 85.6 × 54 mm
        assert abs((r.x0 + r.x1) / 2 - page.rect.width / 2) < 0.5  # centred
    assert boxes[1].y0 > boxes[0].y1  # front above back


def test_many_cards_go_in_pairs_and_onto_more_sheets():
    sheets = cards.layout([CARD] * 10, (210, 297))
    assert [len(s) for s in sheets] == [8, 2]
    (x0, y0), (x1, y1) = sheets[0][:2]
    assert y0 == y1 and x1 > x0  # a pair side by side
    large = cards.layout([(CARD[0] * 1.5, CARD[1] * 1.5)] * 3, (215, 330))
    assert all(len({x for x, _ in s}) == 1 for s in large)  # too wide for two across: one column


def test_a_photo_without_a_card_is_taken_whole():
    plain = cv2.imencode(".png", card_face("SCAN"))[1].tobytes()  # already cut out: no table around it
    img, size = cards.card_image(plain, "kartu.png", "gray", None)
    assert abs(size[0] - CARD[0]) < 0.01 and abs(size[1] - CARD[0] * CARD_PX[1] / CARD_PX[0]) < 0.1
    assert np.array_equal(img[..., 0], img[..., 1])  # grey


def test_options_are_checked():
    one = [(photo(card_face("DEPAN")), "a.jpg")]
    for paper, mode, scale in (("letter", "color", "real"), ("a4", "bw", "real"), ("a4", "color", "huge")):
        with pytest.raises(Exception):
            cards.cards_to_pdf(one, paper, mode, scale, None)


@pytest.mark.skipif(not (shutil.which("tesseract")), reason="tesseract is not installed")
@pytest.mark.parametrize("turn", [90, 180, 270])
def test_a_turned_card_is_set_upright(turn):
    from edith import ocr
    cmd = ocr.osd_cmd()
    if cmd is None:
        pytest.skip("tesseract has no osd data")
    img, size = cards.card_image(photo(card_face("DEPAN"), turn), "a.jpg", "color", cmd)
    assert size == CARD
    # Upright: the dark band is the card's top.
    top, bottom = img[: img.shape[0] // 8].mean(), img[-img.shape[0] // 8:].mean()
    assert top < bottom - 20


def test_route(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path / "data"))) as c:
        r = c.post("/tools/cards", files=[("files", ("ktp.jpg", photo(card_face("DEPAN")), "image/jpeg")),
                                          ("files", ("ktp2.jpg", photo(card_face("BELAKANG")), "image/jpeg"))],
                   data={"paper": "f4", "scan_mode": "gray", "scale": "large"})
        assert r.status_code == 200, r.text
        assert "ktp-kartu.pdf" in r.headers["content-disposition"]
        page = pymupdf.open("pdf", r.content)[0]
        assert abs(page.rect.height - 330 * MM) < 1
        r = c.post("/tools/cards", files=[("files", ("a.jpg", b"not a picture", "image/jpeg"))])
        assert r.status_code == 400
