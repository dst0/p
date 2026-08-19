import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { disableDetachedGitMaintenance } from "./git-test-fixture.js";
import {
  applyReleaseFragments,
  createChangeFragmentEvidence,
} from "./release-change-fragments.js";

function git(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function write(repoRoot, path, content) {
  const target = join(repoRoot, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commit(repoRoot, message) {
  git(repoRoot, "add", "--all");
  git(repoRoot, "commit", "-m", message);
}

function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "p-change-fragments-"));
  git(repoRoot, "init", "-b", "main");
  disableDetachedGitMaintenance(repoRoot);
  git(repoRoot, "config", "user.email", "fragment-test@example.invalid");
  git(repoRoot, "config", "user.name", "Fragment Test");
  write(
    repoRoot,
    "packages/agent/CHANGELOG.md",
    "# Changelog\n\n## [Unreleased]\n\n## [0.4.0] - 2026-08-01\n",
  );
  write(repoRoot, "packages/agent/src/index.js", "export const first = 1;\n");
  commit(repoRoot, "initial release");
  git(repoRoot, "tag", "v0.4.0");
  return repoRoot;
}

function fragment(packages, summary) {
  return `${JSON.stringify({ schemaVersion: 1, packages, type: "Added", summary })}\n`;
}

test("requires every material policy-era commit to carry matching package evidence", () => {
  const repoRoot = fixture();
  try {
    write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
    write(repoRoot, ".changes/agent.json", fragment(["ai"], "Describe an unrelated AI change."));
    write(repoRoot, "packages/agent/src/index.js", "export const first = 2;\n");
    commit(repoRoot, "mismatched fragment");
    assert.throws(() => createChangeFragmentEvidence(repoRoot), /do not cover agent/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("rejects a second independent change that reuses an older fragment", () => {
  const repoRoot = fixture();
  try {
    write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
    write(repoRoot, ".changes/agent.json", fragment(["agent"], "Describe the first agent change."));
    write(repoRoot, "packages/agent/src/index.js", "export const first = 2;\n");
    commit(repoRoot, "first covered change");
    write(repoRoot, "packages/agent/src/second.js", "export const second = 2;\n");
    commit(repoRoot, "second uncovered change");
    assert.throws(() => createChangeFragmentEvidence(repoRoot), /require a release-note fragment in the same commit/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("rejects a fragment-only deletion after it covered a material commit", () => {
  const repoRoot = fixture();
  try {
    write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
    write(repoRoot, ".changes/agent.json", fragment(["agent"], "Describe the covered agent change."));
    write(repoRoot, "packages/agent/src/index.js", "export const first = 2;\n");
    commit(repoRoot, "covered change");
    rmSync(join(repoRoot, ".changes/agent.json"));
    commit(repoRoot, "silently delete release note");

    assert.throws(() => createChangeFragmentEvidence(repoRoot), /current release-note fragment/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("rejects a later material commit that rewrites an existing fragment id", () => {
  const repoRoot = fixture();
  try {
    write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
    write(repoRoot, ".changes/x.json", fragment(["agent"], "Describe the first agent change."));
    write(repoRoot, "packages/agent/src/index.js", "export const first = 2;\n");
    commit(repoRoot, "first covered change");

    write(repoRoot, ".changes/x.json", fragment(["ai"], "Remap to AI with the same fragment id."));
    write(repoRoot, "packages/agent/src/index.js", "export const first = 3;\n");
    commit(repoRoot, "second covered change with remapped fragment id");

    assert.throws(() => createChangeFragmentEvidence(repoRoot), /cannot be modified/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("activates fragment policy on the first-parent merge commit", () => {
  const repoRoot = fixture();
  try {
    git(repoRoot, "switch", "-c", "feature");
    write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
    write(repoRoot, ".changes/agent.json", fragment(["agent"], "Describe the merged agent change."));
    write(repoRoot, "packages/agent/src/index.js", "export const first = 2;\n");
    commit(repoRoot, "feature with release policy");
    git(repoRoot, "switch", "main");
    write(repoRoot, "README.md", "unrelated first-parent work\n");
    commit(repoRoot, "unrelated main work");
    git(repoRoot, "merge", "--no-ff", "feature", "-m", "merge feature");

    const evidence = createChangeFragmentEvidence(repoRoot);
    assert.equal(evidence.commits.length, 1);
    assert.equal(evidence.commits[0].commit, git(repoRoot, "rev-parse", "HEAD"));
    assert.deepEqual(evidence.commits[0].affectedPackages, ["agent"]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("reports pre-policy packages as legacy changelog obligations", () => {
  const repoRoot = fixture();
  try {
    write(repoRoot, "packages/agent/src/legacy.js", "export const legacy = 1;\n");
    commit(repoRoot, "legacy change");
    write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
    write(repoRoot, ".changes/agent.json", fragment(["agent"], "Describe the policy-era agent change."));
    write(repoRoot, "packages/agent/src/index.js", "export const first = 2;\n");
    commit(repoRoot, "policy-era change");
    assert.deepEqual(createChangeFragmentEvidence(repoRoot).legacyAffectedPackages, ["agent"]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("binds fragment hashes and aggregates current fragments into changelogs", () => {
  const repoRoot = fixture();
  try {
    write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
    write(repoRoot, ".changes/agent.json", fragment(["agent"], "Describe the covered agent change."));
    write(repoRoot, "packages/agent/src/index.js", "export const first = 2;\n");
    commit(repoRoot, "covered change");
    const evidence = createChangeFragmentEvidence(repoRoot);
    assert.equal(evidence.commits.length, 1);
    assert.match(evidence.commits[0].fragments[0].contentHash, /^[a-f0-9]{64}$/);
    const applied = applyReleaseFragments(repoRoot);
    assert.equal(applied.length, 1);
    assert.equal(existsSync(join(repoRoot, ".changes/agent.json")), false);
    assert.match(readFileSync(join(repoRoot, "packages/agent/CHANGELOG.md"), "utf8"), /Describe the covered agent change/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("aggregates into an empty Unreleased section without rewriting released history", () => {
  const repoRoot = fixture();
  try {
    const changelogPath = join(repoRoot, "packages/agent/CHANGELOG.md");
    const historicalContent =
      "## [0.4.0] - 2026-08-01\n\n### Added\n\n- Historical release entry.\n";
    write(
      repoRoot,
      "packages/agent/CHANGELOG.md",
      `# Changelog\n\n## [Unreleased]\n\n${historicalContent}`,
    );
    write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
    write(repoRoot, ".changes/agent.json", fragment(["agent"], "Describe the new agent change."));

    applyReleaseFragments(repoRoot);

    const content = readFileSync(changelogPath, "utf8");
    assert.match(content, /^# Changelog\n\n## \[Unreleased\]\n\n### Added\n\n- Describe the new agent change\./);
    assert.equal(content.slice(content.indexOf("## [0.4.0]")), historicalContent);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("rejects release-note summaries that can inject changelog structure", () => {
  const repoRoot = fixture();
  try {
    write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
    write(
      repoRoot,
      ".changes/agent.json",
      fragment(["agent"], "Describe the agent change.\n\n## [9.9.9] - 2026-08-01"),
    );
    assert.throws(() => applyReleaseFragments(repoRoot), /single-line summary/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("starts the next audit after the latest release tag and ignores consumed fragments", () => {
  const repoRoot = fixture();
  try {
    write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
    write(repoRoot, ".changes/agent.json", fragment(["agent"], "Describe the first release change."));
    write(repoRoot, "packages/agent/src/index.js", "export const first = 2;\n");
    commit(repoRoot, "first covered change");
    applyReleaseFragments(repoRoot);
    commit(repoRoot, "release 0.5.0");
    git(repoRoot, "tag", "v0.5.0");
    write(repoRoot, ".changes/agent-next.json", fragment(["agent"], "Describe the next release change."));
    write(repoRoot, "packages/agent/src/next.js", "export const next = 1;\n");
    commit(repoRoot, "next covered change");
    const evidence = createChangeFragmentEvidence(repoRoot);
    assert.equal(evidence.baseTag, "v0.5.0");
    assert.equal(evidence.commits.length, 1);
    assert.equal(evidence.commits[0].fragments[0].id, "agent-next");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
