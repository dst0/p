# 2026-10-10 — Real compiler regression exceeded the default test deadline

- **Status:** Resolved locally; full-suite and Linux CI confirmation pending.
- **Symptom:** A coding-agent test verifying typecheck-command authority timed out after 30 seconds in both a high-concurrency full run and a one-worker focused rerun.
- **Evidence:** The test invokes the real `tsc --project packages/ai/tsconfig.build.json --noEmit` as a passing negative control. The exact compiler command completed successfully in 27.56 seconds outside Vitest, leaving under three seconds for test setup and assertions.
- **Cause:** The default 30-second Vitest deadline was too close to a legitimate compiler invocation under local load. The synchronous child had no separate timeout, so the test deadline alone could not bound a hung compiler.
- **Fix:** Keep the negative and positive authority assertions unchanged, allow 120 seconds for this test, and bound the compiler child to 90 seconds.
- **Verification:** The focused file passed 44/44 both after increasing the test deadline and after adding the child bound; the second run completed in 28.63 seconds. Full-suite and Linux CI confirmation remain pending.
- **Prevention:** Give real child-process tests a measured full-suite load margin and an independent child timeout below the outer test deadline; do not weaken the behavioral assertion to satisfy the clock.
