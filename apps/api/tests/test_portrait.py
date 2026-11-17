"""edith/portrait.py: pas foto, a portrait on a plain background at an ID-photo size. The model is stood in for by a
fake session (an ellipse for a person), so these tests run without downloading it; one test uses the real model when
it is there."""
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from edith import portrait
from edith.main import create_app
from edith.settings import Settings


def portrait_photo() -> np.ndarray:
    """A "person" (a head on shoulders, touching: one region) on a light green wall, 900 × 1200."""
    img = np.full((1200, 900, 3), (170, 220, 190), np.uint8)
    cv2.ellipse(img, (450, 440), (170, 260), 0, 0, 360, (90, 110, 150), -1)
    cv2.ellipse(img, (450, 1000), (380, 330), 0, 0, 360, (60, 60, 60), -1)
    return img


class FakeSession:
    """Takes the person to be whatever is not the wall's green."""

    class _In:
        name = "input"

    def get_inputs(self):
        return [self._In()]

    def run(self, _outputs, feed):
        x = feed["input"][0].transpose(1, 2, 0)  # RGB, -1 to 1
        wall = (np.abs(x[..., 1] - (220 / 255 - 0.5) / 0.5) < 0.1)
        return [(~wall).astype(np.float32)[None, None]]


def jpeg(img: np.ndarray) -> bytes:
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()


def decode(data: bytes) -> np.ndarray:
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def test_red_background_at_3x4_with_the_head_near_the_top(tmp_path):
    out = decode(portrait.pas_foto(jpeg(portrait_photo()), "a.jpg", "red", "3x4", tmp_path, FakeSession()))
    assert out.shape[:2] == (472, 354)  # 3 × 4 cm at 300 dpi
    b, g, r = out[5, 5].astype(int)
    assert r > 190 and g < 60 and b < 60  # the wall is red now
    rows = np.flatnonzero((np.abs(out.astype(int) - out[5, 5].astype(int)).sum(axis=2) > 80).any(axis=1))
    assert 0.05 * 472 < rows[0] < 0.16 * 472  # the head's top below a little headroom
    assert abs(int(out[150, 177][2]) - 150) < 25  # the face (its middle, by the crop) keeps its colour


def test_custom_colour_and_original_frame(tmp_path):
    out = decode(portrait.pas_foto(jpeg(portrait_photo()), "a.jpg", "#1e64c8", "original", tmp_path, FakeSession()))
    assert out.shape[:2] == (1200, 900)
    assert np.abs(out[5, 5].astype(int) - (200, 100, 30)).max() < 12
    with pytest.raises(Exception):
        portrait.pas_foto(jpeg(portrait_photo()), "a.jpg", "#12", "3x4", tmp_path, FakeSession())
    with pytest.raises(Exception):
        portrait.pas_foto(jpeg(portrait_photo()), "a.jpg", "red", "9x9", tmp_path, FakeSession())


def test_tidy_keeps_one_person_and_fills_a_hole_the_model_half_saw():
    a = np.zeros((400, 300), np.float32)
    cv2.ellipse(a, (150, 250), (100, 160), 0, 0, 360, 1.0, -1)
    a[300:340, 130:170] = 0.3  # a dark jacket read as half background
    a[20:30, 20:30] = 1.0  # a speck of the wall
    t = portrait.tidy(a)
    assert t[25, 25] == 0
    assert t[320, 150] > 0.95
    assert t[5, 150] == 0  # the real background stays


def test_no_person_is_refused(tmp_path):
    class Nobody(FakeSession):
        def run(self, _o, feed):
            return [np.zeros((1, 1, *feed["input"].shape[2:]), np.float32)]
    with pytest.raises(Exception, match="no person"):
        portrait.pas_foto(jpeg(portrait_photo()), "a.jpg", "red", "3x4", tmp_path, Nobody())


def test_route_without_the_model_says_so(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path / "data", models_dir=tmp_path / "none"))) as c:
        r = c.post("/tools/pas-foto", files=[("files", ("a.jpg", jpeg(portrait_photo()), "image/jpeg"))], data={"colour": "red"})
        assert r.status_code == 503 and r.json()["error"]["code"] == "model_unavailable"


@pytest.mark.skipif(not (Settings().models_dir / portrait.MODEL_FILE).is_file(), reason="the portrait model is not downloaded")
def test_route_with_the_real_model(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path / "data"))) as c:
        r = c.post("/tools/pas-foto", files=[("files", ("foto.jpg", jpeg(portrait_photo()), "image/jpeg"))],
                   data={"colour": "blue", "size": "2x3"})
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "image/jpeg"
        assert "foto-pasfoto.jpg" in r.headers["content-disposition"]
        assert decode(r.content).shape[:2] == (354, 236)


def test_tidy_fills_dark_clothes_open_to_the_bottom_but_not_gaps_in_the_hair():
    a = np.zeros((600, 400), np.float32)
    cv2.ellipse(a, (200, 200), (90, 120), 0, 0, 360, 1.0, -1)  # head
    a[300:, 40:360] = 1.0  # shoulders and chest, running off the bottom
    a[520:, 150:180] = 0.3  # a dark jacket's fold read as half background, open to the bottom edge
    a[110:118, 150:158] = 0.3  # a small gap between strands of hair
    t = portrait.tidy(a)
    assert t[580, 165] > 0.95
    assert t[114, 154] < 0.5
    assert t[20, 20] == 0 and t[400, 10] == 0  # the real background beside the shoulders stays
