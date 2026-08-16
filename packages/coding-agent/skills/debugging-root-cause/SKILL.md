---
name: debugging-root-cause
description: Systematic root cause analysis, differential trace debugging, deterministic bug reproduction, and regression isolation. Use when diagnosing complex defects, non-deterministic race conditions, silent data corruption, unhandled edge cases, or regressions across services.
---

# Systematic Root Cause Analysis & Differential Tracing

This skill establishes a rigorous scientific methodology for isolating defects, diagnosing non-deterministic timing bugs, and enforcing regression tests before implementing code fixes.

---

## 1. The Scientific Debugging Protocol

Never guess or apply superficial speculative patches. Follow this six-phase diagnosis loop:

```
[ Phase 1: OBSERVE ]
Collect exact runtime errors, stack traces, input payloads, and environmental state.
         |
         v
[ Phase 2: HYPOTHESIZE ]
Formulate a testable hypothesis regarding the precise invariant violation or race condition.
         |
         v
[ Phase 3: ISOLATE & REPRODUCE ]
Write a minimal failing regression test that reliably reproduces the failure.
         |
         v
[ Phase 4: DIAGNOSE via DIFFERENTIAL TRACING ]
Compare execution logs and state transitions between failing and passing baselines.
         |
         v
[ Phase 5: FIX ROOT CAUSE ]
Apply the minimal structural fix addressing the underlying invariant violation.
         |
         v
[ Phase 6: VERIFY & CATALOG ]
Confirm regression test passes; run full test suite; catalog regression under `test/suite/regressions/`.
```

---

## 2. Fast Navigation & Specialized References

| Domain | Reference Document | Key Focus Areas |
| :--- | :--- | :--- |
| **Differential Tracing & Repros** | [references/differential-tracing.md](references/differential-tracing.md) | Trace diffing, deterministic event scheduling, isolating async race conditions, regression catalogs. |

---

## 3. Core Debugging Rules

1. **Mandatory Failing Regression Test First**:
   - Never write a single line of production fix code before committing or writing a test that fails against the existing bug.
   - If you cannot reproduce the bug in a test, you do not yet understand the root cause.

2. **No Symptomatic Masking**:
   - Do not wrap failing calls in generic `try/catch` or add `if (!x) return` guards without understanding why `x` was undefined.
   - Fix the broken upstream invariant, not just the downstream symptom.

3. **Log & Trace Differential Comparison**:
   - When debugging non-deterministic issues, compare step-by-step trace logs of a successful run against a failed run to locate the exact divergent step.

---

## 4. Pre-Flight Debugging Checklist

- [ ] Has the bug been reproduced with a deterministic standalone test?
- [ ] Does the regression test fail against the current codebase?
- [ ] Has the root cause been identified rather than merely catching an unhandled exception?
- [ ] Does the fix maintain all existing public contracts and interfaces?
- [ ] Is the regression test cataloged under `test/suite/regressions/<issue>-<slug>.test.ts`?
- [ ] Do all non-e2e unit tests (`npm run test:unit`) and compiler checks (`npm run check`) pass?
