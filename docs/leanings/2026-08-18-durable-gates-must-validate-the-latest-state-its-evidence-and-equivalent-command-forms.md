# 2026-08-18 — Durable gates must validate the latest state, its evidence, and equivalent command forms

- **Status:** Resolved
- **Task/context:** Auditing the requirement certificate, Git publication gate, and certified release path policy.
- **Unexpected observation or failure:** `git -C ... commit/push` and valid global Git options bypassed publication gating; a malformed latest persisted state fell back to an older valid completion certificate; a well-shaped state could claim passed final/readiness status without evidence; and the local release allowlist permitted generated model drift that CI rejected later.
- **Evidence:** Dedicated regressions failed against quoted worktree paths, `-P`, `--no-optional-locks`, `--namespace`, incomplete nested state, type-correct evidence-free readiness, stale certificates, and generated model paths before the fixes.
- **Approaches tried:**
  - **Attempt:** Match only literal `git commit` and `git push` and shallowly validate persisted object shape.
    - **Outcome:** Did not work
    - **Why:** Equivalent Git invocation grammar escaped the regex, while status strings alone did not prove current evidence or semantic state consistency.
  - **Attempt:** Make the latest state entry authoritative, validate status-dependent invariants, parse supported Git global options, and re-resolve final and acceptance evidence at the gate.
    - **Outcome:** Worked
    - **Why:** Corruption now fails closed and publication depends on current non-error evidence rather than persisted assertions alone.
- **Root cause:** Trust-boundary checks validated convenient serialized labels and one command spelling instead of the complete state/evidence relationship and equivalent invocation forms.
- **Resolution:** Add deep state/evidence validators, refuse stale-state fallback, expose a recoverable restore error until a new task is declared, verify evidence again before publication, parse Git global options before identifying the subcommand, and remove generated model sources from local release mutations.
- **Verification:** The focused system-prompt and completion regressions pass 37/37, the requirement-audit cluster passes 29/29, the release suite passes 51/51, `npm run check` passes, and the full sanitized unit harness passes.
- **Prevention/follow-up:** Add adversarial command variants and semantically impossible but type-correct persisted states whenever a durable gate changes.
- **Reusable learning:** At a durable gate, the newest record is authoritative, status must be derivable from current evidence, and alternate command grammar must not change authorization.
- **References:** `packages/coding-agent/src/core/task-verification/state-validation.ts`, `packages/coding-agent/src/core/task-verification/git-command-classification.ts`, `packages/coding-agent/test/task-requirement-audit-corrupted-restoration.test.ts`, `scripts/release-receipt-verification.test.js`
