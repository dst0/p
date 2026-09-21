# 2026-09-21 — Shell aliases can bypass successful CLI relinks

- **Status:** Resolved
- **Task/context:** Restoring a locally installed `p` CLI that failed before the TUI started even though the reinstall flow had previously reported a valid global link and version.
- **Unexpected observation or failure:** An interactive shell resolved `p` to a checkout-local compiled entrypoint while non-interactive executable lookup resolved the managed global link. The local checkout no longer had a complete dependency tree, so Node failed during module resolution.
- **Evidence:** `type -a p` identified an interactive-shell alias before the global executable; direct execution of the managed binary started the TUI; removing the alias made a fresh interactive shell resolve the same managed executable and report the expected version.
- **Approaches tried:**
  - **Attempt:** Recheck the npm-backed symlink and package dependency declaration.
    - **Outcome:** Partial
    - **Why:** Both were valid, but neither controlled interactive alias precedence.
  - **Attempt:** Remove the stale checkout-local alias and validate the managed binary from a fresh shell context.
    - **Outcome:** Worked
    - **Why:** It restored one authoritative command path whose dependencies are hydrated by the reinstall transaction.
- **Root cause:** The reinstall verifier used executable lookup from its Bash process, which cannot observe a Zsh alias defined in the parent user's startup configuration. The alias bypassed every npm link the verifier checked.
- **Resolution:** Remove the stale local alias and make `reinstall.sh` fail early when common shell startup files contain the checkout-local `p` alias pattern. Diagnostics report only file and line number, never shell-file contents.
- **Verification:** The focused shell-discovery suite covers canonical and Zsh-specific alias forms, continuations, unreadable startup files, comment/lookalike exclusions, diagnostic redaction, and fail-before-mutation reinstall ordering; a controlled TUI launch from the home directory reached the prompt without a module-resolution error.
- **Prevention/follow-up:** Keep `p` resolution PATH-based. If a wrapper is required, give it a different command name instead of shadowing the managed executable. The static scan is deliberately fail-closed: alias-like text inside a heredoc must be removed or renamed rather than interpreted by executing shell startup code.
- **Reusable learning:** A successful global relink does not prove the user will execute that link; installation verification must account for higher-precedence shell aliases without sourcing untrusted startup files.
- **References:** `reinstall.sh`, `scripts/npm-link-discovery.sh`, `scripts/npm-link-discovery.test.js`
