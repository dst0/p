# 2026-09-06 — npm 12 does not preserve shipped shrinkwraps

- **Status:** Partial
- **Task/context:** Make local package smoke tests represent the certified CI release artifacts.
- **Unexpected observation or failure:** npm 12 omitted `npm-shrinkwrap.json` from the CLI pack result despite its explicit inclusion in the package manifest. The README's unqualified claim that shipped shrinkwrap pins dependencies for all npm users was incorrect.
- **Evidence:** An actual offline dry-run of the CLI package with npm 12.0.2 omitted the file and was rejected by the new guard. npm 11.16.0 included it in a 3,173-file result. Installed npm 12 packlist and Arborist behavior agree with its documented removal of shrinkwrap support.
- **Approaches tried:**
  - **Attempt:** Treat support for npm 12's keyed JSON output as complete release compatibility.
    - **Outcome:** Did not work
    - **Why:** JSON representation and archive contents are independent contracts; npm 12 also changes dependency-lock behavior.
  - **Attempt:** Use the same npm 11.16.0 toolchain as the CI publisher, installed in a task-private directory, and reject missing required shrinkwrap metadata.
    - **Outcome:** Worked
    - **Why:** This preserves the intended published artifact without changing the global npm installation or removing safety checks.
- **Root cause:** Assuming that an explicitly listed file is always packed and that all package clients honor dependency-shipped shrinkwraps.
- **Resolution:** Local packaging and publisher validation require the explicitly shipped shrinkwrap. README now distinguishes npm versions that honor it from npm 12 and Bun package installs. Standalone compiled binaries do not depend on this install-time mechanism.
- **Verification:** Actual npm 12 rejection and npm 11 acceptance were verified against the same CLI source; parser regressions include exact inclusion and misleading nested/backup filenames.
- **Prevention/follow-up:** Deterministic transitive pinning for npm 12 consumers remains unresolved; it requires a deliberate alternate mechanism. Do not silently bundle platform-native dependencies or claim exact direct versions pin the entire graph.
- **Reusable learning:** Certifying a lockfile's bytes does not certify every consumer's treatment of that file.
- **References:** `scripts/npm-pack-result.js`; `README.md`; `.github/workflows/build-binaries.yml`; [npm lockfile documentation](https://github.com/npm/cli/blob/latest/docs/lib/content/configuring-npm/package-lock-json.md).
