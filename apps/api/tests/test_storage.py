import hashlib
import re

import pytest

from edith.errors import DocExpired, DocNotFound


def test_create_and_read(storage):
    meta = storage.create(b"%PDF-data", page_count=3)
    assert re.fullmatch(r"[A-Za-z0-9_-]{22}", meta.doc_id)
    assert meta.sha256 == hashlib.sha256(b"%PDF-data").hexdigest()
    assert storage.source_path(meta.doc_id).read_bytes() == b"%PDF-data"
    assert storage.meta(meta.doc_id).page_count == 3


def test_unknown_and_malformed_ids(storage):
    with pytest.raises(DocNotFound):
        storage.source_path("A" * 22)
    with pytest.raises(DocNotFound):
        storage.source_path("../../etc/passwd")


def test_expiry_after_ttl_without_access(storage, clock):
    meta = storage.create(b"x", page_count=1)
    clock.t += 3000
    storage.source_path(meta.doc_id)          # access refreshes TTL
    clock.t += 3000
    storage.source_path(meta.doc_id)          # still alive (6000s total, 3000 since access)
    clock.t += 3601
    with pytest.raises(DocExpired):
        storage.source_path(meta.doc_id)
    with pytest.raises(DocExpired):           # tombstone remembers it
        storage.source_path(meta.doc_id)


def test_cleanup_removes_expired_and_old_tombstones(storage, clock):
    a = storage.create(b"a", page_count=1)
    clock.t += 1800
    b = storage.create(b"b", page_count=1)
    clock.t += 1801
    assert storage.cleanup() == 1
    with pytest.raises(DocExpired):
        storage.source_path(a.doc_id)
    assert storage.source_path(b.doc_id).exists()
    clock.t += 86400 + 3601
    storage.cleanup()
    with pytest.raises(DocNotFound):          # tombstone purged
        storage.source_path(a.doc_id)


def test_cleanup_tolerates_missing_access_file(storage, clock):
    meta = storage.create(b"x", page_count=1)
    d = storage.root / "docs" / meta.doc_id
    (d / ".access").unlink()
    import os
    os.utime(d, (clock.t, clock.t))
    assert storage.cleanup() == 0            # fresh dir mtime: kept, no raise
    clock.t += 3601
    assert storage.cleanup() == 1            # expired via dir mtime fallback
    with pytest.raises(DocExpired):
        storage.source_path(meta.doc_id)


def test_source_removed_after_ttl_check_is_expired(storage):
    meta = storage.create(b"x", page_count=1)
    (storage.root / "docs" / meta.doc_id / "source.pdf").unlink()
    with pytest.raises(DocExpired):
        storage.source_path(meta.doc_id)


def test_dir_removed_between_check_and_use_is_expired(storage, monkeypatch):
    import shutil
    meta = storage.create(b"x", page_count=1)
    d = storage.root / "docs" / meta.doc_id
    orig = storage._last_access

    def racing(path):
        value = orig(path)
        shutil.rmtree(path)
        return value

    monkeypatch.setattr(storage, "_last_access", racing)
    with pytest.raises(DocExpired):
        storage.meta(meta.doc_id)


def test_id_with_trailing_newline_rejected(storage):
    with pytest.raises(DocNotFound):
        storage.source_path("A" * 22 + "\n")
