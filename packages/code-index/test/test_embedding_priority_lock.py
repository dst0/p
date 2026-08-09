import threading
import time
import unittest

from embedding_priority_lock import EmbeddingPriorityLock


class EmbeddingPriorityLockTest(unittest.TestCase):
    def test_interactive_query_preempts_remaining_background_items(self):
        lock = EmbeddingPriorityLock()
        order: list[str] = []
        first_background_started = threading.Event()
        release_first_background = threading.Event()

        def embed_background(items: list[str]) -> list[str]:
            order.append(items[0])
            if items[0] == "background-1":
                first_background_started.set()
                release_first_background.wait(timeout=1)
            return items

        background = threading.Thread(
            target=lambda: lock.run(
                ["background-1", "background-2"], embed_background, interactive=False
            )
        )
        background.start()
        self.assertTrue(first_background_started.wait(timeout=1))
        interactive = threading.Thread(
            target=lambda: lock.run(
                ["interactive"], lambda items: order.extend(items) or items, interactive=True
            )
        )
        interactive.start()
        deadline = time.monotonic() + 1
        while lock.interactive_waiters != 1 and time.monotonic() < deadline:
            time.sleep(0.001)
        release_first_background.set()
        interactive.join(timeout=1)
        background.join(timeout=1)

        self.assertEqual(order, ["background-1", "interactive", "background-2"])

    def test_interactive_query_runs_before_next_background_batch(self):
        lock = EmbeddingPriorityLock()
        order: list[str] = []
        interactive_acquired = threading.Event()
        release_interactive = threading.Event()
        background_acquired = threading.Event()

        def run_interactive() -> None:
            with lock.hold(interactive=True):
                order.append("interactive")
                interactive_acquired.set()
                release_interactive.wait(timeout=1)

        def run_background() -> None:
            with lock.hold(interactive=False):
                order.append("background")
                background_acquired.set()

        with lock.hold(interactive=False):
            interactive = threading.Thread(target=run_interactive)
            interactive.start()
            deadline = time.monotonic() + 1
            while lock.interactive_waiters != 1 and time.monotonic() < deadline:
                time.sleep(0.001)
            self.assertEqual(lock.interactive_waiters, 1)
            background = threading.Thread(target=run_background)
            background.start()

        self.assertTrue(interactive_acquired.wait(timeout=1))
        self.assertFalse(background_acquired.is_set())
        release_interactive.set()
        interactive.join(timeout=1)
        background.join(timeout=1)

        self.assertEqual(order, ["interactive", "background"])

    def test_cancelled_request_stops_waiting_for_the_device(self):
        lock = EmbeddingPriorityLock()
        cancelled = threading.Event()
        waiting = threading.Event()
        errors: list[Exception] = []

        def run_waiter() -> None:
            waiting.set()
            try:
                lock.run(
                    ["background"],
                    lambda items: items,
                    interactive=False,
                    cancellation_check=cancelled.is_set,
                )
            except Exception as error:
                errors.append(error)

        with lock.hold(interactive=False):
            waiter = threading.Thread(target=run_waiter)
            waiter.start()
            self.assertTrue(waiting.wait(timeout=1))
            cancelled.set()
            waiter.join(timeout=1)

        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], InterruptedError)


if __name__ == "__main__":
    unittest.main()
