# 2026-09-06 — Publish every public workspace dependency

- **Status:** Resolved
- **Task/context:** Independently review the publication path after local runtime and CI checks passed.
- **Unexpected observation or failure:** The publisher listed four packages but omitted `@dst0/p-code-index`, a direct runtime dependency of the CLI. The local packer already included all five public runtime workspaces.
- **Evidence:** The CLI manifest declares the code-index dependency; lockstep versioning rewrites it to the release target. A regression expecting the discovered public workspace set failed because no code-index registry query or pack validation occurred. Its manifest also lacked the repository metadata required by the GitHub trusted-publishing setup; a separate metadata regression failed on that package.
- **Approaches tried:**
  - **Attempt:** Use green build, unit tests, and version-bump coverage as evidence of complete publication.
    - **Outcome:** Did not work
    - **Why:** Those checks did not execute or validate the publisher's package list.
  - **Attempt:** Derive a regression oracle from the real public workspace manifests and internal dependency graph.
    - **Outcome:** Worked
    - **Why:** It independently detects omissions and requires dependencies to precede consumers rather than duplicating the publisher's list.
- **Root cause:** Local packaging, version mutation, and registry publication used different package scopes without a cross-check.
- **Resolution:** Publish code-index before the CLI and add its canonical GitHub repository/workspace metadata. Add full-closure, dependency-order, and public-package metadata regressions to the script suite.
- **Verification:** The original omission and metadata failures were reproduced before their fixes. Corrected dry-run publication passed with both npm JSON representations using an isolated fake CLI; no package was published.
- **Prevention/follow-up:** Verify npm account/trusted-publisher readiness separately before the first publication of a newly included package. Registry availability is not established by a manifest edit.
- **Reusable learning:** A successful release of a consumer is not usable unless every newly required internal dependency is also deliverable.
- **References:** `scripts/publish.js`; `scripts/publish-package-closure.test.js`; `packages/code-index/package.json`; `2026-09-06-new-npm-packages-need-publication-readiness.md`.
