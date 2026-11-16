"""What keeps a public Edith usable for everyone on one small server: how often one address may call the API, how many
heavy jobs (tools, exports) run at once, and a floor of free disk below which uploads are refused.

The client's address is `request.client.host`: behind the local reverse proxy (Tailscale serve/funnel) uvicorn takes it
from X-Forwarded-For, which it trusts from 127.0.0.1 only. Answers carry the API's usual error body, so the web shows
its own message for each code: rate_limited (429, with Retry-After), server_busy (503), storage_full (507)."""
import asyncio
import re
import shutil
import threading
import time
from collections import deque
from pathlib import Path

from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

# Uploads: a new document, or a run of a PDF tool (each takes files in and makes a new one).
UPLOAD = re.compile(r"^/(documents|tools/[a-z-]+)/?$")
# Heavy jobs: the PDF tools and building a document's PDF.
HEAVY = re.compile(r"^/(tools/[a-z-]+|documents/[^/]+/export)/?$")


class Windows:
    """Sliding windows of request times per (address, rule); `hit` says how long to wait, or 0 when the call may go."""

    def __init__(self, rules: dict[str, list[tuple[int, float]]]):
        self.rules = rules
        self._seen: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()
        self._sweep_at = 0.0

    def hit(self, who: str, rule: str, now: float | None = None) -> float:
        now = time.monotonic() if now is None else now
        limits = self.rules[rule]
        longest = max(span for _, span in limits)
        with self._lock:
            if now >= self._sweep_at:
                self._sweep(now)
            seen = self._seen.setdefault((who, rule), deque())
            while seen and seen[0] <= now - longest:
                seen.popleft()
            wait = 0.0
            for count, span in limits:
                recent = [t for t in seen if t > now - span] if span < longest else list(seen)
                if len(recent) >= count:
                    wait = max(wait, recent[-count] + span - now)
            if wait <= 0:
                seen.append(now)
            return wait

    def _sweep(self, now: float) -> None:
        """Forget addresses that have been quiet longer than every window (the map would otherwise only grow)."""
        for key in [k for k, q in self._seen.items() if not q or q[-1] <= now - max(s for _, s in self.rules[k[1]])]:
            del self._seen[key]
        self._sweep_at = now + 60


def _error(code: str, message: str, status: int, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


class Guard:
    """ASGI middleware applying the limits above. `rate_limit` off (tests, local use) keeps only the heavy-job gate and
    the disk floor."""

    def __init__(self, app: ASGIApp, *, rate_limit: bool, heavy_slots: int, heavy_wait_seconds: float,
                 data_dir: Path, min_free_bytes: int):
        self.app = app
        self.rate_limit = rate_limit
        self.windows = Windows({
            "any": [(900, 60.0)],
            "post": [(120, 60.0)],
            "upload": [(20, 60.0), (150, 3600.0)],
        })
        self.heavy = asyncio.Semaphore(max(heavy_slots, 1))
        self.heavy_wait = heavy_wait_seconds
        self.data_dir = data_dir
        self.min_free = min_free_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            await self.app(scope, receive, send)
            return
        path, post = scope["path"], scope["method"] == "POST"
        upload, heavy = post and bool(UPLOAD.match(path)), post and bool(HEAVY.match(path))

        if self.rate_limit:
            who = (scope.get("client") or ("unknown", 0))[0]
            for rule in ("any", "post", "upload") if upload else ("any", "post") if post else ("any",):
                wait = self.windows.hit(who, rule)
                if wait > 0:
                    retry = str(max(1, round(wait)))
                    await _error("rate_limited", "too many requests from this address", 429, {"Retry-After": retry})(scope, receive, send)
                    return

        if upload and self._disk_low():
            await _error("storage_full", "the server is short of disk space", 507)(scope, receive, send)
            return

        if not heavy:
            await self.app(scope, receive, send)
            return
        try:
            await asyncio.wait_for(self.heavy.acquire(), timeout=self.heavy_wait)
        except TimeoutError:
            await _error("server_busy", "every heavy job slot stayed taken", 503, {"Retry-After": "15"})(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        finally:
            self.heavy.release()

    def _disk_low(self) -> bool:
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            return shutil.disk_usage(self.data_dir).free < self.min_free
        except OSError:
            return False
