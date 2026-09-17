# 2026-09-08 — Dangling PATH links need directory scanning

- **Status:** Resolved
- **Task/context:** Reinstalling the global `p` CLI across every npm prefix represented on `PATH`.
- **Unexpected observation or failure:** A stale global `p` link remained dangling while the reinstall relinked only the active Node installation prefix and then reported that `p` was unavailable on `PATH`.
- **Evidence:** The affected link pointed to the expected `@dst0/p` CLI location, but `type -a -p p` returned no entry because its target did not exist. The default `npm prefix -g` identified a different prefix.
- **Approaches tried:**
  - **Attempt:** Discover installed commands through shell command resolution.
    - **Outcome:** Did not work
    - **Why:** Command resolution intentionally excludes a dangling executable symlink.
  - **Attempt:** Inspect the literal `p` entry in every `PATH` directory and validate its link target before deriving the npm prefix.
    - **Outcome:** Worked
    - **Why:** Filesystem link inspection does not require the target to exist, while target validation excludes unrelated commands.
- **Root cause:** The reinstall treated executable command resolution as an inventory of filesystem links, even though those contracts differ for dangling symlinks.
- **Resolution:** Discover npm-backed `p` symlinks by scanning each `PATH` directory, deduplicate commands and prefixes, and relink every matching prefix.
- **Verification:** Isolated fixtures cover dangling relative and absolute npm links, duplicate and empty `PATH` entries, and rejection of non-`bin`, lookalike, and foreign targets without touching global installations.
- **Prevention/follow-up:** Keep link inventory separate from executable resolution and test broken-target recovery explicitly.
- **Reusable learning:** When repair logic must recover dangling links, inventory directory entries directly; `command -v` and `type` only describe currently executable commands.
- **References:** `reinstall.sh`; `scripts/npm-link-discovery.sh`; `scripts/npm-link-discovery.test.js`.
