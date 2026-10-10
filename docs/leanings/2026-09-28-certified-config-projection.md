# 2026-09-28 — Project minimal candidate configuration before writing

- **Status:** Resolved
- **Task/context:** Route real P, Pi, and Kilo model traffic through the certified parent proxy without exposing source credentials.
- **Unexpected observation or failure:** AST-splicing copied `models.json` and `kilo.jsonc` could retain unrelated providers, comments, custom headers, unknown fields, and secrets. Later, an invalid selected Kilo limit caused P/Pi private copies to be rewritten before the operation failed.
- **Evidence:** Synthetic sentinel fixtures exposed retained fields under the first approach; a failing regression showed partial P/Pi writes for an invalid Kilo limit.
- **Approaches tried:**
  - **Attempt:** Scrub and splice copied source syntax in place.
    - **Outcome:** Did not work.
    - **Why:** Arbitrary source structure could carry fields outside the scrub list.
  - **Attempt:** Project each config immediately before writing it.
    - **Outcome:** Partial.
    - **Why:** Validation of later Kilo metadata could fail after earlier P/Pi writes.
- **Root cause:** Denylisting source fields and interleaving validation with writes made credential exclusion and all-or-nothing validation hard to prove.
- **Resolution:** Build fresh allowlisted JSON for only the selected provider/model with proxy URL and sentinel key, keeping the canonical URL/key in the parent. Validate all three projected objects before writing any private copy. Source files remain unchanged.
- **Verification:** Synthetic fields, headers, comments, unused providers, malformed metadata, unsafe proxy endpoints, and partial-write regression pass. Actual-config local `kilo models` and P/Pi model-resolution checks passed without provider calls; the full live 36-cell benchmark remains unverified.
- **Prevention/follow-up:** Keep the selected metadata allowlist explicit and extend regressions when supported model schemas change.
- **Reusable learning:** For contained agents, generate minimal runtime config from validated fields; never mutate arbitrary user config trees in place or write before all projections validate.
- **References:** `benchmarks/src/harness/certified-proxy-config.ts`, `benchmarks/test/harness/certified-proxy-config-write-boundaries.test.ts`.
