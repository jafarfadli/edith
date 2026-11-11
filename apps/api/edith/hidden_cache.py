"""What GET .../hidden-text measured, kept per page: measuring renders the pictures under a page's hidden lines (up to
hiddentext.MAX_PIXELS) and its result never changes for a stored document and segmentation version, so it is done once
per (document, page, PARAGRAPHS_VERSION), at most `slots` at a time on the server. A request while every slot is busy
is answered "busy" (429), not queued: the client asks again later. Entries of documents that expired go with the
storage cleanup (prune); the cache is small (an LRU of `size` pages) whatever happens."""
import threading
from collections import OrderedDict
from collections.abc import Callable

from edith.errors import HiddenTextBusy
from edith.paragraphs import PARAGRAPHS_VERSION


class HiddenTextCache:
    def __init__(self, slots: int = 2, size: int = 256):
        self._slots = threading.BoundedSemaphore(max(slots, 1))
        self._lock = threading.Lock()
        self._size = max(size, 1)
        self._pages: OrderedDict[tuple[str, int, int], list[dict]] = OrderedDict()

    def cached(self, doc_id: str, index: int) -> list[dict] | None:
        key = (doc_id, index, PARAGRAPHS_VERSION)
        with self._lock:
            if key in self._pages:
                self._pages.move_to_end(key)
                return self._pages[key]
        return None

    def get(self, doc_id: str, index: int, measure: Callable[[], list[dict]]) -> list[dict]:
        """The page's hidden paragraphs, measured by `measure` unless known. The caller has checked that the document
        still exists (a cached page of an expired document is never served). Raises HiddenTextBusy when every slot
        is taken."""
        found = self.cached(doc_id, index)
        if found is not None:
            return found
        if not self._slots.acquire(blocking=False):
            raise HiddenTextBusy("every slot measuring hidden text is taken")
        try:
            result = measure()
        finally:
            self._slots.release()
        with self._lock:
            self._pages[(doc_id, index, PARAGRAPHS_VERSION)] = result
            self._pages.move_to_end((doc_id, index, PARAGRAPHS_VERSION))
            while len(self._pages) > self._size:
                self._pages.popitem(last=False)
        return result

    def prune(self, exists: Callable[[str], bool]) -> None:
        """Drops the pages of documents that no longer exist (expired, deleted)."""
        with self._lock:
            for key in [k for k in self._pages if not exists(k[0])]:
                del self._pages[key]
