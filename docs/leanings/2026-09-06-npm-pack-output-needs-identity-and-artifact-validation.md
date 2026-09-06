# 2026-09-06 — npm pack output needs identity and artifact validation

- **Status:** Resolved
- **Task/context:** Verify the unpublished release outside the source checkout before the v5 release transaction.
- **Unexpected observation or failure:** Local release packaging exited after a successful `npm pack` because the script tried to read `JSON.parse(stdout)[0].filename`. The same assumption existed in the publisher's dry-run path. Separate workflow regressions also showed that missing archives, directories, and symlinks were accepted as successful pack results.
- **Evidence:** Installed npm 12.0.2 returned an object keyed by the exact package name, with valid name, version, and filename. npm 11.16.0 returned an array. A controlled CLI regression passed the array case and failed the keyed case before the fix; three artifact-kind regressions also failed before the regular-file check.
- **Approaches tried:**
  - **Attempt:** Investigate inherited npm configuration and workspace selection.
    - **Outcome:** Did not work
    - **Why:** The selected package and command output were correct; the consumer assumed the wrong JSON shape.
  - **Attempt:** Parse the two active npm output contracts by exact package identity, then verify the emitted archive.
    - **Outcome:** Worked
    - **Why:** Exactly one result, matching name/version, canonical filename, and a regular file bind metadata to the intended local artifact.
- **Root cause:** Treating one npm JSON representation and subprocess success as sufficient artifact authority.
- **Resolution:** Both consumers use `scripts/npm-pack-result.js`; local packaging additionally checks the exact archive with `lstat`. Invalid diagnostics do not reproduce subprocess payloads. Existing scripts' indentation was normalized without changing unrelated behavior.
- **Verification:** Focused parser and controlled CLI tests passed after the corrections. A real offline tiny-package pack dry-run verifies the installed npm contract without hooks, registry writes, or archive creation. The pinned npm 11.16.0 local release created all five tarballs, Node/Bun installs, and the macOS ARM64 binary archive.
- **Prevention/follow-up:** Keep both npm representations and negative archive kinds in the enumerated script suite. Canonicalize fixture paths before comparing child-process working directories; native Windows symlink fixtures need explicit privilege-aware handling.
- **Reusable learning:** A successful command and parseable metadata are not proof that the intended deployable artifact exists.
- **References:** `scripts/npm-pack-result.test.js`; `scripts/local-release-pack-output.test.js`; `scripts/publish-package-closure.test.js`; [npm changelog](https://github.com/npm/cli/blob/latest/CHANGELOG.md).
