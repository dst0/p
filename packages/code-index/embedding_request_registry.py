"""Track cancellable embedding requests across threaded HTTP handlers."""

import threading
import time


class EmbeddingRequestRegistry:
    def __init__(self, tombstone_seconds: float = 300.0):
        self._lock = threading.Lock()
        self._active: dict[str, tuple[threading.Event, threading.Event]] = {}
        self._cancelled_before_start: dict[str, float] = {}
        self._tombstone_seconds = tombstone_seconds

    def register(self, request_id: str) -> threading.Event:
        with self._lock:
            self._discard_expired_tombstones()
            if request_id in self._active:
                raise ValueError(f"duplicate embedding request id: {request_id}")
            cancelled = threading.Event()
            if self._cancelled_before_start.pop(request_id, None) is not None:
                cancelled.set()
            self._active[request_id] = (cancelled, threading.Event())
            return cancelled

    def complete(self, request_id: str) -> None:
        with self._lock:
            request = self._active.pop(request_id, None)
        if request is not None:
            request[1].set()

    def cancel_and_wait(self, request_id: str, timeout_seconds: float) -> bool:
        with self._lock:
            self._discard_expired_tombstones()
            request = self._active.get(request_id)
            if request is None:
                self._cancelled_before_start[request_id] = (
                    time.monotonic() + self._tombstone_seconds
                )
                return True
            cancelled, completed = request
            cancelled.set()
        return completed.wait(timeout_seconds)

    def active_count(self) -> int:
        with self._lock:
            return len(self._active)

    def _discard_expired_tombstones(self) -> None:
        now = time.monotonic()
        self._cancelled_before_start = {
            request_id: expires_at
            for request_id, expires_at in self._cancelled_before_start.items()
            if expires_at > now
        }
