# 2026-09-09 — Typecheck evidence needs compiler authority

- **Status:** Resolved
- **Task/context:** Harden coding-agent completion evidence after path-qualified TypeScript compiler commands were added to the shared verification parser.
- **Unexpected observation or failure:** Descriptor matching accepted commands that mentioned `tsc` without proving a project-wide compiler run. Download-capable launchers, metadata-only modes, partial source-file checks, foreign paths, runner filters, resolution-changing wrappers, and shell masking could therefore satisfy an explicit typecheck request.
- **Evidence:** Before implementation, 11 focused regressions failed: nine unsafe typecheck descriptors were accepted, an unquoted line continuation hid `git push`, and query-only `git --exec-path` was mistaken for publication. A fresh independent critic then reproduced seven more failures covering a quoted POSIX backslash, loader injection variables, duplicate runner cwd options, package lifecycle hooks, and an unrelated package config that passed without covering the changed source scope. Post-fix review found two more false acceptances: a sibling `tsconfig` whose effective `include` excluded the changed file, and `minimatch` brace syntax that TypeScript treats literally.
- **Approaches tried:**
  - **Attempt:** Expand the typecheck regular expression with more path and option cases.
    - **Outcome:** Did not work.
    - **Why:** A regular expression cannot bind compiler, project, package, wrapper, and working-directory identities or distinguish compiler execution from no-op modes.
  - **Attempt:** Parse one focused shell invocation, unwrap only safe environment wrappers, bind literal paths to the session workspace, inspect package scripts, and validate TypeScript arguments structurally.
    - **Outcome:** Worked.
    - **Why:** Every accepted command now has a deterministic route to a project-wide local compiler invocation.
- **Root cause:** Typecheck readiness used a broad descriptor regular expression while other verification gates had moved to structured command parsing.
- **Resolution:** Added a shared authority classifier for direct compilers, Node compiler entrypoints, and package scripts; rejected dynamic, partial, query-only, filtered, foreign-root, source-scope-incomplete, lifecycle-hooked, loader-injected, or resolution-changing invocations; bound compiler and cwd symlinks by real path; normalized literal working directories; corrected shell continuation and Git exec-path parsing; and proved changed-source membership against statically parsed effective JSONC `files`/`include`/`exclude` configuration and local `extends` chains.
- **Verification:** Focused authority, forgery, indirection, Node readiness, and Git publication regressions pass 117/117, including real zero-exit metadata, partial-file, unrelated-package, and effective-config source membership cases. Compatibility tests for audit and evidence modes pass 31/31; TypeScript diagnostics and the 2,494-file structure gate pass.
- **Prevention/follow-up:** Keep readiness gates on the shared structural classifier. Add every newly discovered launcher or compiler mode as a failing regression before changing its authority rules.
- **Reusable learning:** A successful-looking command name is not typecheck evidence; bind the actual compiler, project scope, working directory, arguments, and package script body.
- **References:** `packages/coding-agent/src/core/task-verification/check-command-classification.ts`, `packages/coding-agent/test/task-verification-typecheck-command-authority.test.ts`
