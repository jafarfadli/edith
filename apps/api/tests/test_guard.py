"""edith/guard.py: per-address limits, the heavy-job gate and the disk floor."""
import asyncio

from fastapi.testclient import TestClient

from edith.guard import Guard, Windows
from edith.main import create_app
from edith.settings import Settings


def test_windows_allow_up_to_the_limit_then_say_how_long_to_wait():
    w = Windows({"r": [(3, 60.0)]})
    assert [w.hit("a", "r", now=t) for t in (0, 1, 2)] == [0, 0, 0]
    assert w.hit("a", "r", now=3) == 57  # the first call leaves the window at 60
    assert w.hit("b", "r", now=3) == 0  # another address has its own window
    assert w.hit("a", "r", now=60.5) == 0


def test_windows_check_every_span_of_a_rule():
    w = Windows({"r": [(2, 10.0), (3, 100.0)]})
    assert [w.hit("a", "r", now=t) for t in (0, 20, 40)] == [0, 0, 0]
    assert w.hit("a", "r", now=60) == 40  # three in 100 s: wait for the call at 0 to fall out


def test_windows_forget_quiet_addresses():
    w = Windows({"r": [(5, 60.0)]})
    w.hit("a", "r", now=0)
    w.hit("b", "r", now=100)  # the sweep after a minute drops "a"
    assert ("a", "r") not in w._seen


def _client(tmp_path, **kw) -> TestClient:
    return TestClient(create_app(Settings(data_dir=tmp_path / "data", **kw)))


def _guard(app) -> Guard:
    stack = app.middleware_stack or app.build_middleware_stack()
    while not isinstance(stack, Guard):
        stack = stack.app
    return stack


def test_rate_limit_answers_429_with_retry_after_and_cors(tmp_path):
    with _client(tmp_path, rate_limit=True, cors_origins=["https://edith.example"]) as c:
        _guard(c.app).windows.rules["any"] = [(2, 60.0)]
        assert c.get("/health").status_code == 200
        assert c.get("/health").status_code == 200
        r = c.get("/health", headers={"Origin": "https://edith.example"})
        assert r.status_code == 429
        assert r.json()["error"]["code"] == "rate_limited"
        assert int(r.headers["retry-after"]) >= 1
        assert r.headers["access-control-allow-origin"] == "https://edith.example"


def test_uploads_have_their_own_tighter_limit(tmp_path):
    with _client(tmp_path, rate_limit=True) as c:
        _guard(c.app).windows.rules["upload"] = [(1, 60.0)]
        c.post("/documents", files={"file": ("a.pdf", b"not a pdf", "application/pdf")})
        r = c.post("/documents", files={"file": ("a.pdf", b"not a pdf", "application/pdf")})
        assert r.json()["error"]["code"] == "rate_limited"
        assert c.get("/health").status_code == 200  # other calls still go


def test_no_rate_limit_unless_switched_on(tmp_path):
    with _client(tmp_path) as c:
        _guard(c.app).windows.rules["any"] = [(1, 60.0)]
        assert all(c.get("/health").status_code == 200 for _ in range(3))


def test_uploads_refused_when_disk_is_short(tmp_path):
    with _client(tmp_path, min_free_disk_bytes=1 << 62) as c:
        r = c.post("/documents", files={"file": ("a.pdf", b"x", "application/pdf")})
        assert r.status_code == 507
        assert r.json()["error"]["code"] == "storage_full"
        assert c.get("/health").status_code == 200


def test_heavy_jobs_wait_for_a_slot_then_give_up(tmp_path):
    with _client(tmp_path, heavy_slots=1, heavy_wait_seconds=0.05) as c:
        guard = _guard(c.app)
        asyncio.run(guard.heavy.acquire())  # the one slot is taken
        r = c.post("/tools/compress", files={"file": ("a.pdf", b"x", "application/pdf")})
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "server_busy"
        guard.heavy.release()
        r = c.post("/tools/compress", files={"file": ("a.pdf", b"x", "application/pdf")})
        assert r.status_code != 503
