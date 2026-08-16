# AbortSignal Cancellation & Resource Cleanup Testing

Proper asynchronous cancellation with `AbortSignal` requires verifying both prompt termination and deterministic cleanup of event listeners, sockets, and subprocesses.

---

## 1. Core Cancellation Requirements

1. **Immediate Propagation**: When `controller.abort()` is called, pending promises must reject immediately with an `AbortError` / `DOMException`.
2. **Listener Deregistration**: Cancellation event listeners on the `AbortSignal` must be removed once the operation concludes to prevent memory leaks.
3. **No Unhandled Rejections**: Catch and suppress expected cancellation rejections cleanly without leaking into global uncaught exceptions.

---

## 2. Invariant Assertion Test

```typescript
it("cleans up signal listeners upon normal completion and upon abort", async () => {
  const controller = new AbortController();
  const signal = controller.signal;

  const initialListeners = getSignalListenerCount(signal);

  const opPromise = asyncProcess({ signal });
  expect(getSignalListenerCount(signal)).toBe(initialListeners + 1);

  controller.abort();
  await expect(opPromise).rejects.toThrow(/AbortError/);

  // Assert listener was detached
  expect(getSignalListenerCount(signal)).toBe(initialListeners);
});
```
