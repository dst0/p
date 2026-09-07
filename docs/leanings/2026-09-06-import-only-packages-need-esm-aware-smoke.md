# 2026-09-06 — Import-only packages need ESM-aware smoke checks

- **Status:** Resolved
- **Task/context:** Validate the fresh isolated npm and Bun package installs outside the source checkout.
- **Unexpected observation or failure:** The artifact checker rejected `@dst0/p-ai` with `ERR_PACKAGE_PATH_NOT_EXPORTED` before starting any CLI command.
- **Evidence:** The package's export map declares an `import` entrypoint and no `require` condition. The failed stack originated in the checker's `require.resolve` call, not in the shipped CLI. Corrected checks found the declared files, and all three actual CLI variants subsequently passed version, help, model-listing, and interactive startup checks.
- **Approaches tried:**
  - **Attempt:** Resolve every installed package through `createRequire().resolve`.
    - **Outcome:** Did not work
    - **Why:** CommonJS resolution requests a condition that an intentionally import-only package does not expose.
  - **Attempt:** Check the declared ESM entrypoint and execute the actual installed CLI.
    - **Outcome:** Worked
    - **Why:** The checker now matches the package's supported loading contract; actual execution verifies that its module graph loads.
- **Root cause:** The validation harness imposed a CommonJS contract on ESM packages.
- **Resolution:** Corrected only the temporary checker and documented the ESM-aware artifact-validation path. No package export or compatibility surface was changed to satisfy the checker.
- **Verification:** All five packages were found inside each isolated install tree; the three CLI variants passed nine metadata commands and three interactive startup/exit checks without network or credentials.
- **Prevention/follow-up:** Classify failures by their originating process and use the supported module-loading mode before treating a checker error as an artifact defect.
- **Reusable learning:** A validation tool must exercise the product's real contract rather than invent an additional compatibility requirement.
- **References:** `packages/ai/package.json`; `README.md` (Dependency and install security).
