# 2026-10-10 — Unbounded benchmark CI run

- **Status:** Partial
- **Task/context:** PR #159 validates certified benchmark network containment on the self-hosted Linux runner.
- **Unexpected observation or failure:** The required coverage job stopped producing benchmark test output and remained active for more than five hours before cancellation.
- **Evidence:** CI run `38014968801` passed build, check, and release-policy steps. `npm run test:benchmarks` last printed passing TAP test 77 at `2026-10-10T02:00:22Z`; the run was cancelled at `07:30:49Z` without a test summary. Passing test 77 does not identify the stalled test file.
- **Approaches tried:**
  - **Attempt:** Inspect the completed CI log and process cleanup.
    - **Outcome:** Partial
    - **Why:** It confirmed that the Node test process remained alive, but four-file concurrency and no timeout obscured the exact pending test or referenced handle.
  - **Attempt:** Run the benchmark suite serially with a per-test timeout and add a finite CI job timeout.
    - **Outcome:** Partial
    - **Why:** The local macOS suite completed all 540 tests; exact-head Linux CI still must verify the instrumentation without skipping tests.
- **Root cause:** The subsequent exact-head Linux run (`38038796629`) showed `EADDRNOTAVAIL` when every certified proxy test attempted to bind `::1`: that runner has no IPv6 loopback. The older unbounded hang is not independently proven to have the same sole cause.
- **Resolution:** Keep the benchmark suite's test selection unchanged while making its execution sequential and bounding test bodies and the CI job. Bind the certified proxy to IPv4 loopback and, only when IPv6 loopback is unavailable, proceed without the optional IPv6 listener. Advertise an explicit IPv4 URL to avoid client DNS fallback; accept that URL only in private benchmark config rewrites. IPv6-specific tests skip only on hosts unable to bind `::1`.
- **Verification:** `npm run check` and the full `./test.sh` passed after the diagnostic change, including 540/540 benchmark tests. The next Linux CI run failed in the new certified proxy tests with `EADDRNOTAVAIL`; verification of the IPv4 fallback change is pending.
- **Prevention/follow-up:** Preserve the failing file, process tree, and full output from the next bounded run. Check that the complete healthy serial job fits the 30-minute cap with margin; otherwise isolate the benchmark gate or calibrate the bound from measured runtime. Rerun the full exact-head Linux gate after the fallback fix.
- **Reusable learning:** A last passing TAP line is not attribution; test concurrency and unlimited waits can hide a later file or live handle indefinitely.
- **References:** `.github/workflows/ci.yml`, `package.json`, and CI run `38014968801`.
