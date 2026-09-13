# 2026-09-13 — Stream evidence must retain every observation

- **Status:** Resolved
- **Task/context:** Hardening certified P, Pi, and Kilo recording evidence.
- **Unexpected observation or failure:** A later valid cost or model event could hide an earlier malformed cost, conflicting model field, wrong model, or malformed JSONL line.
- **Evidence:** Mixed streams with invalid evidence followed by valid values could reach a valid-looking final metric; JSON serialization also converts non-finite numbers to `null`, making string-only regressions vacuous for `NaN` and infinities.
- **Approaches tried:**
  - **Attempt:** Validate only the final accumulated value and last model.
    - **Outcome:** Did not work
    - **Why:** Terminal snapshots erase transient violations in incremental streams.
  - **Attempt:** Retain unique observed models and ingestion errors for the complete stream.
    - **Outcome:** Worked
    - **Why:** Certification can reject any invalid observation without corrupting later valid accumulation.
- **Root cause:** Evidence reduction treated streamed telemetry as a replaceable snapshot.
- **Resolution:** P, Pi, and Kilo metrics retain every model field in every event; malformed JSONL and invalid monetary events remain errors even when later evidence is valid, and preflight plus row gates validate the complete sets.
- **Verification:** `recording-stream-integrity.test.ts` covers same-event model conflicts, malformed capture, mixed streams, and direct non-finite accumulator inputs; `certification-adversarial-regressions.test.ts` covers certification rejection.
- **Prevention/follow-up:** New streamed evidence fields must define whether reduction is cumulative and preserve all certification-invalidating observations.
- **Reusable learning:** Never let a later valid event erase an earlier protocol, identity, or telemetry violation.
- **References:** `benchmarks/src/workloads/recording-metrics.ts`, `benchmarks/src/workloads/certification-preflight-evaluation.ts`
