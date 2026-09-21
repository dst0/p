# 2026-09-22 — Vitest audit remediation must preserve the existing Vite major

- **Status:** Resolved
- **Task/context:** Remediate the repository's npm audit findings in an isolated worktree from `origin/main`.
- **Unexpected observation or failure:** The audit reported three moderate entries for `vitest`, `@vitest/mocker`, and `@vitest/coverage-v8`, all on the same redirect-mock path-traversal/arbitrary-file-read advisory. A plain lockfile refresh to Vitest 4.1.11 also selected Vite 8.3.0 through a broad peer range, creating an unrelated tooling-major change.
- **Evidence:** `npm audit --omit=dev --audit-level=moderate --json` reported three moderate vulnerabilities and a fix at Vitest 4.1.11. The first lockfile refresh changed Vite 7.3.5 to 8.3.0; pinning the existing Vite 7.3.5 resolution during lockfile regeneration kept the final diff limited to the Vitest dependency closure and compatible transitive updates.
- **Approaches tried:**
  - **Attempt:** Run `npm install --package-lock-only --ignore-scripts` after updating Vitest pins.
    - **Outcome:** Partial.
    - **Why:** It removed the advisory but opportunistically upgraded Vite to 8.3.0.
  - **Attempt:** Regenerate the lockfile while explicitly retaining Vite 7.3.5, then remove the temporary root Vite pin from the manifest and lockfile root metadata.
    - **Outcome:** Worked.
    - **Why:** Vitest 4.1.11 accepts Vite 7, and the lockfile remains minimal without a new direct dependency.
- **Root cause:** The audit findings came from all workspace test-tool pins remaining at Vitest 4.1.8; npm's resolver selected the newest Vite peer when the lockfile was regenerated without preserving the existing Vite resolution.
- **Resolution:** Updated the five direct workspace Vitest/coverage pins to 4.1.11 and refreshed `package-lock.json` while retaining Vite 7.3.5.
- **Verification:** Re-run the audit, clean install, targeted workspace tests, `npm run check`, `./reinstall.sh`, CLI smoke checks, and CI before merge.
- **Prevention/follow-up:** When refreshing a security-only lockfile, inspect peer-resolution churn and preserve unrelated major versions unless the upgrade is separately reviewed.
- **Reusable learning:** A security patch should remove the advisory while keeping unrelated toolchain majors stable; inspect the full lockfile diff rather than trusting the audit command alone.
- **References:** `.changes/fix-vitest-audit.json`, `package-lock.json`, and the Vitest audit regression command above.
