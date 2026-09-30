# 2026-09-28 — Proxy evidence must bind each request to its cell

- **Status:** Resolved
- **Task/context:** Bind real P, Pi, and Kilo requests to each certified benchmark cell.
- **Unexpected observation or failure:** A cell could pass after one model-bearing response even when a second completion had no model evidence; a partially uploaded request could resume after `endCell()`.
- **Evidence:** Focused two-completion and held-body regressions reproduced both failures before the fix.
- **Approaches tried:**
  - **Attempt:** Restrict sandbox egress to a loopback proxy and require one expected model event per cell.
    - **Outcome:** Did not work.
    - **Why:** One response could cover another request, and a request waiting for its body was not yet counted.
- **Root cause:** In-flight accounting began after reading the full request body, and response models were accumulated across the cell without requiring a successful model-bearing response for each completion.
- **Resolution:** Count an inbound request before awaiting its body, reject forwarding if its cell has ended, and require every forwarded completion to finish with a successful response carrying the expected model. Closing the proxy aborts and settles outstanding upstream requests. Strip candidate-supplied authorization unless the parent injects the canonical key.
- **Verification:** Focused regressions hold one body open across the cell boundary, send two completions with one missing model response, stall an upstream request during close, and verify authorization stripping. Each failed before its corresponding fix and passed afterward.
- **Prevention/follow-up:** Retain per-request evidence and abort pending upstream work before certifying a cell.
- **Reusable learning:** Treat asynchronous request lifetime, response attribution, and shutdown as one evidence boundary.
- **References:** `benchmarks/src/harness/certified-egress-proxy.ts`, `benchmarks/test/harness/certified-egress-proxy.test.ts`.
