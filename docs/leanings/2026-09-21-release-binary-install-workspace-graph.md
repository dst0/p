# 2026-09-21 — Release binary install must avoid the workspace graph

- **Status:** Resolved
- **Task/context:** Publish the certified `5.0.1` release and build its cross-platform Bun archives.
- **Unexpected observation or failure:** The release validation job passed its certificate, build, checks, and tests, but `scripts/build-binaries.sh` failed while installing cross-platform clipboard bindings with `Cannot read properties of null (reading 'edgesOut')`.
- **Evidence:** The failing command was the single `npm install --include=optional --no-save --package-lock=false --force --ignore-scripts` invocation from the binary builder. A dry-run reproduced the problematic workspace dependency resolution locally; adding `--workspaces=false` completed the same package resolution without the Arborist failure.
- **Approaches tried:**
  - **Attempt:** Re-run the release workflow unchanged.
    - **Outcome:** Did not work.
    - **Why:** The same native-binding install step failed before binary compilation.
  - **Attempt:** Add `--workspaces=false` to the targeted native-binding install.
    - **Outcome:** Worked.
    - **Why:** The command only needs to hydrate packages copied into the archives and does not need the monorepo workspace graph.
- **Root cause:** npm Arborist attempted to resolve the full workspace graph during a no-save, forced install of platform-specific optional packages; the release runner's npm hit an internal null graph edge.
- **Resolution:** The binary builder now explicitly disables workspace resolution for the targeted native-binding install while retaining the lockfile-free, no-save, forced optional-package behavior.
- **Verification:** The regression assertion in `scripts/release-workflow.test.js` fails against the old command and passes with the new flag. The equivalent `npm install --workspaces=false ...` dry-run completed locally for the full native-package set.
- **Prevention/follow-up:** Keep this flag in the binary packaging command and rerun the immutable `v5.0.1` workflow only after the fix is merged into `main`; do not recreate or move the release tag.
- **Reusable learning:** Packaging-only dependency hydration in a workspace monorepo should opt out of workspace graph resolution when it is intentionally copying a bounded set of platform artifacts.
- **References:** `scripts/build-binaries.sh`, `scripts/release-workflow.test.js`, release workflow run `35559589195`.
