# 2026-09-23 — Self-update trusts the upstream pi version endpoint

- **Status:** Open
- **Task/context:** Tracing every consumer of release asset names and the `p update` self-update path while renaming the standalone release binaries.
- **Unexpected observation or failure:** `packages/coding-agent/src/utils/version-check.ts` still queries upstream pi's `https://pi.dev/api/latest-version`, both for interactive startup update notices and for `getSelfUpdatePlan()` in `packages/coding-agent/src/package-manager-cli/list-command.ts`.
- **Evidence:** On 2026-09-23 the endpoint returned `{"ok":true,"version":"0.87.1","packageName":"@earendil-works/pi-coding-agent"}`. `getSelfUpdatePlan(false)` returns `shouldRun: true` with that package name whenever it differs from `PACKAGE_NAME` (`@dst0/p`). For npm, pnpm, yarn and bun installs, `getSelfUpdateCommandForMethod()` in `packages/coding-agent/src/config/package-roots.ts` then builds an uninstall of `@dst0/p` plus a global install of the remote package name.
- **Approaches tried:**
  - **Attempt:** None yet. The fix needs a product decision on a fork-owned version source and on the upstream rename-following and update-note features, so it was left out of the release-pipeline change and filed for a separate session.
    - **Outcome:** Partial.
    - **Why:** The issue is documented and reproducible from the code path and the live endpoint response, but no code changed.
- **Root cause:** The fork inherited upstream's version-check endpoint and its package-rename-following behavior. A third-party server can therefore choose which npm package `p update` installs.
- **Resolution:** Pending. The likely direction is a fork-controlled source (npm registry `@dst0/p` or GitHub releases for `dst0/p`) that never accepts a different package name.
- **Verification:** Pending. A regression must prove that a mismatched remote `packageName` cannot trigger an uninstall or install of another package, and that no request goes to `pi.dev`.
- **Prevention/follow-up:** When a fork renames its package, audit every remote endpoint and identity the upstream code trusts (version checks, telemetry user agents, update notes), not only strings and asset names.
- **Reusable learning:** Self-update must take its version and package identity only from infrastructure the distribution controls.
- **References:** `packages/coding-agent/src/utils/version-check.ts`, `packages/coding-agent/src/package-manager-cli/list-command.ts`, `packages/coding-agent/src/config/package-roots.ts`, `packages/coding-agent/src/modes/interactive/interactive-mode/interactivemode-methods/run-loop.ts`.
