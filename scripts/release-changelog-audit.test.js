import assert from "node:assert/strict";
import test from "node:test";

import {
  affectedChangelogPackages,
  compareVersions,
  validateChangelogContent,
} from "./release-changelog-audit.js";

const validChangelog = `# Changelog

## [Unreleased]

### Added

- Added a release gate.

## [0.4.0] - 2026-08-16

### Fixed

- Fixed an older issue.

## [0.3.0] - 2026-07-01
`;

test("validates the topmost Unreleased section and extracts its entries", () => {
  const result = validateChangelogContent("packages/agent/CHANGELOG.md", validChangelog);

  assert.deepEqual(result.unreleasedEntries, ["- Added a release gate."]);
  assert.deepEqual(result.releaseVersions, ["0.4.0", "0.3.0"]);
});

test("rejects duplicate, misplaced, stale, and invalid-date release sections", () => {
  assert.throws(
    () => validateChangelogContent("duplicate.md", `${validChangelog}\n## [Unreleased]\n`),
    /must appear exactly once/,
  );
  assert.throws(
    () =>
      validateChangelogContent(
        "misplaced.md",
        validChangelog.replace("# Changelog\n\n", "# Changelog\n\n## [0.4.1] - 2026-08-17\n\n"),
      ),
    /first section/,
  );
  assert.throws(
    () => validateChangelogContent("order.md", validChangelog.replace("0.3.0", "0.5.0")),
    /must be greater/,
  );
  assert.throws(
    () => validateChangelogContent("date.md", validChangelog.replace("2026-08-16", "2026-02-31")),
    /valid UTC date/,
  );
  assert.throws(
    () => validateChangelogContent("heading.md", validChangelog.replace("## [0.4.0] - 2026-08-16", "## [next]")),
    /malformed release heading/,
  );
});

test("maps code and release-tool changes to the changelog owners", () => {
  const affected = affectedChangelogPackages([
    "packages/agent/src/agent.ts",
    "packages/code-index/src/index.ts",
    "packages/site/src/app.tsx",
    "scripts/release.js",
    ".github/workflows/ci.yml",
    "docs/guide.md",
  ]);

  assert.deepEqual(affected, ["agent", "coding-agent"]);
});

test("compares semantic versions without lexical ordering errors", () => {
  assert.equal(compareVersions("0.5.0", "0.4.224"), 1);
  assert.equal(compareVersions("0.4.10", "0.4.9"), 1);
  assert.equal(compareVersions("0.4.9", "0.4.9"), 0);
});
