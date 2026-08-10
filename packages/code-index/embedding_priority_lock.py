"""Priority-aware serialization for shared embedding hardware."""

from collections.abc import Callable
from contextlib import contextmanager
from threading import Condition
from typing import Iterator, TypeVar


Input = TypeVar("Input")
Output = TypeVar("Output")


class EmbeddingPriorityLock:
    """Run one embedding request at a time while preventing query starvation."""

    def __init__(self) -> None:
        self._condition = Condition()
        self._active = False
        self._interactive_waiters = 0

    @property
    def interactive_waiters(self) -> int:
        with self._condition:
            return self._interactive_waiters

    def run(
        self,
        items: list[Input],
        operation: Callable[[list[Input]], list[Output]],
        *,
        interactive: bool,
        cancellation_check: Callable[[], bool] | None = None,
    ) -> list[Output]:
        if interactive:
            with self.hold(interactive=True, cancellation_check=cancellation_check):
                output = operation(items)
                self._raise_if_cancelled(cancellation_check)
                return output
        output: list[Output] = []
        for item in items:
            with self.hold(interactive=False, cancellation_check=cancellation_check):
                output.extend(operation([item]))
                self._raise_if_cancelled(cancellation_check)
        return output

    @contextmanager
    def hold(
        self,
        *,
        interactive: bool,
        cancellation_check: Callable[[], bool] | None = None,
    ) -> Iterator[None]:
        with self._condition:
            if interactive:
                self._interactive_waiters += 1
            try:
                while self._active or (not interactive and self._interactive_waiters > 0):
                    self._raise_if_cancelled(cancellation_check)
                    self._condition.wait(timeout=0.05 if cancellation_check else None)
                self._raise_if_cancelled(cancellation_check)
                self._active = True
            finally:
                if interactive:
                    self._interactive_waiters -= 1
        try:
            yield
        finally:
            with self._condition:
                self._active = False
                self._condition.notify_all()

    @staticmethod
    def _raise_if_cancelled(cancellation_check: Callable[[], bool] | None) -> None:
        if cancellation_check is not None and cancellation_check():
            raise InterruptedError("embedding request cancelled")
