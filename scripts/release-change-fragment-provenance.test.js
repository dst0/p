import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { disableDetachedGitMaintenance } from "./git-test-fixture.js";
import { createChangeFragmentEvidence } from "./release-change-fragments.js";
import {
  getHistoricalReleaseFragmentException,
  getHistoricalReleaseFragmentExceptionCommits,
  matchesHistoricalLegacyFragment,
} from "./release-historical-fragment-exceptions.js";

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

function noneFragment(packages, field, value) {
  return `${JSON.stringify({ schemaVersion: 1, packages, type: "None", [field]: value })}\n`;
}

test("allows only the seven exact historical release exceptions", () => {
  const expectedCommits = [
    "56eeb58cf67bd906677e9ba335ff97fef6352374",
    "4c6bc0af26ddb2da25bf246bb8748c239833b543",
    "bbecf92062a08f9aeb50fe127fba93bc92d9ef2b",
    "ec4aa24e67aaf610b198753331dffc907ca76577",
    "4f99a97c755281e0e85ad06ddc611631501e9888",
    "5cf86d4d9441ceff1f15e6129d7110bca2d3f462",
    "2db67221fabc077df03b1412b93375f177dc42f4",
  ];
  assert.deepEqual(getHistoricalReleaseFragmentExceptionCommits(), expectedCommits);
  assert.equal(
    getHistoricalReleaseFragmentException(expectedCommits[0], ["AGENTS.md"])?.pathCount,
    1,
  );
  assert.equal(
    getHistoricalReleaseFragmentException(expectedCommits[0], ["AGENTS.md", "README.md"]),
    undefined,
  );
  assert.equal(getHistoricalReleaseFragmentException("deadbeef", ["AGENTS.md"]), undefined);
  assert.equal(
    matchesHistoricalLegacyFragment(
      { legacyFragment: { path: ".changes/legacy.json", contentHash: "abc123" } },
      ".changes/legacy.json",
      "abc123",
    ),
    true,
  );
  assert.equal(
    matchesHistoricalLegacyFragment(
      { legacyFragment: { path: ".changes/legacy.json", contentHash: "abc123" } },
      ".changes/legacy.json",
      "different",
    ),
    false,
  );
});

function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "p-change-fragment-provenance-"));
  git(repoRoot, "init", "-b", "main");
  disableDetachedGitMaintenance(repoRoot);
  git(repoRoot, "config", "user.email", "fragment-test@example.invalid");
  git(repoRoot, "config", "user.name", "Fragment Test");
  write(repoRoot, "packages/agent/src/index.js", "export const first = 1;\n");
  commit(repoRoot, "initial release");
  git(repoRoot, "tag", "v0.4.0");
  write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
  write(
    repoRoot,
    ".changes/legacy-internal.json",
    noneFragment(["agent"], "summary", "Record the historical internal-only release evidence."),
  );
  write(repoRoot, "packages/agent/src/index.js", "export const first = 2;\n");
  commit(repoRoot, "historical summary-style exemption");
  return repoRoot;
}

function writeReasonPolicy(repoRoot) {
  write(
    repoRoot,
    "scripts/release-change-fragments.js",
    'export const policy = "release-none-reason-enforcement-v2";\n',
  );
  write(
    repoRoot,
    ".changes/reason-policy.json",
    noneFragment(["coding-agent"], "reason", "Enforce reasons for newly introduced None fragments."),
  );
  write(
    repoRoot,
    ".changes/new-internal.json",
    noneFragment(["coding-agent"], "summary", "Attempt a new summary-style exemption after enforcement."),
  );
}

test("keeps no-ff and squash-style policy introductions strict after their first-parent cutoff", () => {
  for (const strategy of ["no-ff", "squash"]) {
    const repoRoot = fixture();
    try {
      git(repoRoot, "switch", "-c", "policy");
      writeReasonPolicy(repoRoot);
      commit(repoRoot, "introduce None reason enforcement");
      git(repoRoot, "switch", "main");
      if (strategy === "no-ff") {
        git(repoRoot, "merge", "--no-ff", "policy", "-m", "merge reason policy");
      } else {
        git(repoRoot, "merge", "--squash", "policy");
        commit(repoRoot, "squash reason policy");
      }
      assert.throws(
        () => createChangeFragmentEvidence(repoRoot),
        /new-internal\.json: None fragments require a specific reason/,
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

test("rejects current fragment content that no longer matches its committed evidence", () => {
  const repoRoot = fixture();
  try {
    write(repoRoot, "scripts/release-change-fragments.js", 'export const policy = "release-none-reason-enforcement-v2";\n');
    const path = ".changes/reason-policy.json";
    const content = noneFragment(["coding-agent"], "reason", "Enforce reasons for newly introduced internal fragments.");
    write(repoRoot, path, content);
    commit(repoRoot, "enforce reasons for internal fragments");
    assert.equal(createChangeFragmentEvidence(repoRoot).commits.length, 2);
    for (const replacement of [
      noneFragment(["ai"], "reason", "Enforce reasons for newly introduced internal fragments."),
      noneFragment(["coding-agent"], "reason", "Substitute a different release justification after committing."),
    ]) {
      write(repoRoot, path, replacement);
      assert.throws(() => createChangeFragmentEvidence(repoRoot), /fragment content.*committed evidence/);
    }
    write(repoRoot, path, content);
    assert.equal(createChangeFragmentEvidence(repoRoot).commits.length, 2);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
