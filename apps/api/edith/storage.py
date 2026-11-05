import hashlib
import json
import os
import re
import secrets
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from edith.errors import DocExpired, DocNotFound

_ID = re.compile(r"^[A-Za-z0-9_-]{22}$")


@dataclass
class DocMeta:
    doc_id: str
    sha256: str
    page_count: int


class Storage:
    def __init__(self, root: Path, ttl: int, tombstone_ttl: int, clock: Callable[[], float] = time.time):
        self.root = Path(root)
        self.ttl = ttl
        self.tombstone_ttl = tombstone_ttl
        self.clock = clock
        self._docs = self.root / "docs"
        self._tombs = self.root / "expired"
        self._docs.mkdir(parents=True, exist_ok=True)
        self._tombs.mkdir(parents=True, exist_ok=True)

    # internal helpers
    def _touch(self, path: Path) -> None:
        now = self.clock()
        os.utime(path, (now, now))

    def _last_access(self, d: Path) -> float:
        try:
            return (d / ".access").stat().st_mtime
        except FileNotFoundError:
            return d.stat().st_mtime  # damaged dir: fall back to dir mtime so it still expires

    def _expire(self, doc_id: str) -> None:
        shutil.rmtree(self._docs / doc_id, ignore_errors=True)
        tomb = self._tombs / doc_id
        tomb.touch()
        self._touch(tomb)

    def _alive_dir(self, doc_id: str) -> Path:
        if not _ID.fullmatch(doc_id):
            raise DocNotFound()
        d = self._docs / doc_id
        if not d.is_dir():
            if (self._tombs / doc_id).exists():
                raise DocExpired()
            raise DocNotFound()
        try:
            if self.clock() - self._last_access(d) > self.ttl:
                self._expire(doc_id)
                raise DocExpired()
            access = d / ".access"
            access.touch()
            self._touch(access)
        except FileNotFoundError:  # directory removed concurrently (e.g. by cleanup)
            raise DocExpired() from None
        return d

    # public API
    def create(self, data: bytes, page_count: int) -> DocMeta:
        doc_id = secrets.token_urlsafe(16)
        d = self._docs / doc_id
        (d / "assets").mkdir(parents=True)
        (d / "source.pdf").write_bytes(data)
        meta = DocMeta(doc_id, hashlib.sha256(data).hexdigest(), page_count)
        (d / "meta.json").write_text(json.dumps(asdict(meta)))
        (d / ".access").touch()
        self._touch(d / ".access")
        return meta

    def doc_dir(self, doc_id: str) -> Path:
        return self._alive_dir(doc_id)

    def source_path(self, doc_id: str) -> Path:
        path = self._alive_dir(doc_id) / "source.pdf"
        if not path.is_file():  # removed between the TTL check and now
            raise DocExpired()
        return path

    def meta(self, doc_id: str) -> DocMeta:
        try:
            return DocMeta(**json.loads((self._alive_dir(doc_id) / "meta.json").read_text()))
        except FileNotFoundError:
            raise DocExpired() from None

    def cleanup(self) -> int:
        now = self.clock()
        removed = 0
        for d in list(self._docs.iterdir()):
            try:
                if d.is_dir() and now - self._last_access(d) > self.ttl:
                    self._expire(d.name)
                    removed += 1
            except FileNotFoundError:  # removed concurrently
                continue
        for t in list(self._tombs.iterdir()):
            try:
                if now - t.stat().st_mtime > self.tombstone_ttl:
                    t.unlink(missing_ok=True)
            except FileNotFoundError:
                continue
        return removed
