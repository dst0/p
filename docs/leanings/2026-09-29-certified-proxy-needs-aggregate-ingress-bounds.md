# 2026-09-29 — Certified proxy needs aggregate ingress bounds

- **Status:** Resolved
- **Task/context:** Adversarial review of the parent-owned egress proxy used by the P/Pi/Kilo benchmark.
- **Unexpected observation or failure:** The proxy limited each request body to 16 MiB but had no shared request, buffered-byte, connection, or whole-forward deadline. A candidate could hold many loopback requests and exhaust parent resources before a cell failed.
- **Evidence:** A raw-socket regression sent only an oversized `Content-Length` header and timed out without an immediate rejection before the fix. The review also traced unrestricted concurrent body buffering and held sockets.
- **Approaches tried:**
  - **Attempt:** Rely on the existing per-request body limit.
    - **Outcome:** Did not work.
    - **Why:** It multiplied with unbounded concurrency and did not reject oversized declared bodies before streaming.
  - **Attempt:** Enforce shared admission and deadline limits while preserving per-cell evidence.
    - **Outcome:** Worked in focused tests.
    - **Why:** Global active-request and buffered-body counters cover both IPv4 and IPv6 listeners, while each listener caps TCP connections.
- **Root cause:** A per-request size check was mistaken for an aggregate resource bound.
- **Resolution:** Reject oversized declared bodies early; cap active forwards, shared buffered bytes, and listener connections; impose an absolute request/forward deadline; release accounting on rejection and close. Keep rejected requests from certifying a cell.
- **Verification:** Focused proxy tests pass for early rejection/no upstream hit, four-active admission, aggregate overflow across loopbacks with credit release, pending-body deadline and close, and existing model/egress evidence. The 36-cell live benchmark remains unverified.
- **Prevention/follow-up:** Add explicit shared resource budgets to every parent service that accepts candidate-controlled traffic. Connection caps are eight per listener, or sixteen across the two loopback listeners; active-forward and byte caps are shared.
- **Reusable learning:** A per-message limit is not a service limit; certification infrastructure needs bounded aggregate ingress and deterministic teardown.
- **References:** `benchmarks/src/harness/certified-egress-proxy.ts`, `benchmarks/test/harness/certified-egress-proxy-limits.test.ts`.
