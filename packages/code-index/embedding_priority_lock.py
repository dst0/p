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
    ) -> list[Output]:
        if interactive:
            with self.hold(interactive=True):
                return operation(items)
        output: list[Output] = []
        for item in items:
            with self.hold(interactive=False):
                output.extend(operation([item]))
        return output

    @contextmanager
    def hold(self, *, interactive: bool) -> Iterator[None]:
        with self._condition:
            if interactive:
                self._interactive_waiters += 1
            try:
                while self._active or (not interactive and self._interactive_waiters > 0):
                    self._condition.wait()
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
