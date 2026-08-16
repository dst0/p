# EOF Truncation & Framing Boundary Verification

Stream parsing and event-sourcing engines frequently suffer from partial chunk read errors, missing newline framing, and abrupt socket terminations.

---

## 1. Truncation Boundary Test Cases

Every line-oriented parser (e.g., JSONL, SSE, chunked wire protocols) must be tested against 4 critical boundary conditions:

```
Case A: Normal stream with terminating newline
{"id":1,"type":"init"}\n{"id":2,"type":"delta"}\n

Case B: Abrupt EOF midway through payload
{"id":1,"type":"init"}\n{"id":2,"typ

Case C: Valid payload missing trailing newline
{"id":1,"type":"init"}\n{"id":2,"type":"delta"}

Case D: Chunk boundary slicing multibyte UTF-8 characters
Buffer 1: ...{"data":"\xF0\x9F
Buffer 2: \x98\x80"}...
```

---

## 2. Invariant Assertion Pattern

```typescript
it("rejects incomplete JSONL records without corrupting state", () => {
  const log = new EventLogStream();
  
  // Feed valid chunk
  log.feed(Buffer.from('{"id": 1, "action": "A"}\n'));
  expect(log.getCommittedEvents()).toHaveLength(1);

  // Feed truncated chunk (missing closing brace and newline)
  log.feed(Buffer.from('{"id": 2, "action": "B'));
  expect(log.getCommittedEvents()).toHaveLength(1); // Must not commit incomplete record

  // Stream closes unexpectedly
  expect(() => log.finalizeStream()).toThrow(/Unexpected EOF/);
});
```
