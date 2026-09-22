import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { disableDetachedGitMaintenance } from "./git-test-fixture.js";

const policyScript = fileURLToPath(new URL("./release-pr-fragment-policy.js", import.meta.url));

function git(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(repoRoot, path, content) {
  const target = join(repoRoot, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commit(repoRoot, message) {
  git(repoRoot, "add", "--all");
  git(repoRoot, "commit", "-m", message);
  return git(repoRoot, "rev-parse", "HEAD");
}

function fragment(packages, type = "Fixed", text = "Describe the reviewed release change precisely.") {
  const body = type === "None" ? { reason: text } : { summary: text };
  return `${JSON.stringify({ schemaVersion: 1, packages, type, ...body })}\n`;
}

function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "p-pr-fragment-policy-"));
  git(repoRoot, "init", "-q", "-b", "main");
  disableDetachedGitMaintenance(repoRoot);
  git(repoRoot, "config", "user.email", "fragment-policy@example.invalid");
  git(repoRoot, "config", "user.name", "Fragment Policy Test");
  for (const name of ["agent", "ai", "code-index", "coding-agent", "tui"]) {
    write(repoRoot, `packages/${name}/src/index.ts`, "export const value = 1;\n");
  }
  write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
  write(repoRoot, ".changes/existing.json", fragment(["agent"]));
  write(repoRoot, "AGENTS.md", "rules\n");
  write(repoRoot, ".github/workflows/ci.yml", "name: CI\n");
  write(repoRoot, ".github/workflows/deploy-pages.yml", "name: Pages\n");
  const baseSha = commit(repoRoot, "base");
  git(repoRoot, "switch", "-q", "-c", "pr");
  return { repoRoot, baseSha };
}

function runPolicy(repoRoot, baseSha, headSha = git(repoRoot, "rev-parse", "HEAD")) {
  return spawnSync(process.execPath, [policyScript, baseSha, headSha], { cwd: repoRoot, encoding: "utf8" });
}

function assertPolicy(changes, expected) {
  const { repoRoot, baseSha } = fixture();
  try {
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) {
        rmSync(join(repoRoot, path));
      } else {
        write(repoRoot, path, content);
      }
    }
    commit(repoRoot, "pull request change");
    const result = runPolicy(repoRoot, baseSha);
    if (expected instanceof RegExp) {
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, expected);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, expected.stdout);
    }
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("rejects package source changes merged without a release-note fragment", () => {
  // Shape of the automated perf PRs #119/#121/#122: package source plus a non-material bot journal.
  assertPolicy(
    {
      ".jules/bolt.md": "journal\n",
      "packages/coding-agent/src/index.ts": "export const value = 2;\n",
    },
    /Release-note fragments do not cover coding-agent\. Add a \.changes\/<id>\.json fragment/,
  );
  assertPolicy({ "packages/code-index/src/index.ts": "export const value = 2;\n" }, /do not cover coding-agent/);
  // Git quotes non-ASCII names unless -z is used; quoting must not hide material paths.
  assertPolicy({ "packages/tui/src/ünicode.ts": "export const value = 2;\n" }, /do not cover tui\./);
});

test("requires every affected package, including release-tool paths owned by coding-agent", () => {
  assertPolicy(
    {
      "packages/coding-agent/src/index.ts": "export const value = 2;\n",
      "packages/tui/src/index.ts": "export const value = 2;\n",
      ".changes/perf.json": fragment(["coding-agent"], "None", "Keep regex checks equivalent to the replaced loops."),
    },
    /do not cover tui\./,
  );
  for (const path of ["AGENTS.md", ".github/workflows/ci.yml", "scripts/release-audit.js", "package.json"]) {
    assertPolicy({ [path]: "changed\n" }, /do not cover coding-agent\./);
  }
});

test("accepts covering Added and None fragments and reports the evidence", () => {
  assertPolicy(
    {
      "packages/coding-agent/src/index.ts": "export const value = 2;\n",
      "packages/tui/src/index.ts": "export const value = 2;\n",
      ".changes/perf.json": fragment(["coding-agent", "tui"], "None", "Keep regex checks equivalent to the loops."),
    },
    { stdout: /Release-note fragments perf cover coding-agent, tui\./ },
  );
  assertPolicy(
    {
      "packages/ai/src/index.ts": "export const value = 2;\n",
      ".changes/ai-added.json": fragment(["ai"], "Added"),
      ".changes/ai-docs.json": fragment(["agent"], "None", "Document the agent package without runtime changes."),
    },
    { stdout: /fragments ai-added, ai-docs cover ai\./ },
  );
});

test("allows non-material changes without a fragment", () => {
  assertPolicy(
    {
      "README.md": "docs\n",
      "docs/leanings/2026-09-23-example.md": "learning\n",
      ".github/workflows/deploy-pages.yml": "name: Pages v2\n",
      "packages/agent/CHANGELOG.md": "# Changelog\n",
      ".changes/config.json": '{"schemaVersion":1,"note":"edited"}\n',
    },
    { stdout: /No material release changes require a release-note fragment\./ },
  );
});

test("rejects fragments and fragment-policy edits the release audit would reject", () => {
  const change = { "packages/coding-agent/src/index.ts": "export const value = 2;\n" };
  // PR #134 named the code-index workspace, which owns no changelog.
  assertPolicy(
    { ...change, ".changes/vitest.json": fragment(["coding-agent", "code-index"], "None", "Update test tooling only.") },
    /vitest\.json: release-note fragment names an unknown changelog package/,
  );
  assertPolicy(
    {
      ...change,
      ".changes/legacy.json": `${JSON.stringify({ schemaVersion: 1, packages: ["coding-agent"], type: "None", summary: "Only a legacy summary." })}\n`,
    },
    /legacy\.json: None fragments require a specific reason/,
  );
  // The release parses raw working-tree bytes, where a UTF-8 BOM is invalid JSON.
  assertPolicy({ ...change, ".changes/bom.json": `﻿${fragment(["coding-agent"])}` }, /bom\.json: .*valid JSON/);
  assertPolicy({ ...change, ".changes/.json": fragment(["coding-agent"]) }, /\.changes\/\.json: .*non-empty file name/);
  assertPolicy(
    { ...change, ".changes/nested/x.json": fragment(["coding-agent"]) },
    /nested\/x\.json: release-note fragments must be top-level/,
  );
  assertPolicy(
    { ...change, ".changes/existing.json": fragment(["agent", "coding-agent"]) },
    /existing\.json: release-note fragments introduced before this PR cannot be modified or deleted/,
  );
  assertPolicy({ ".changes/existing.json": null }, /existing\.json: .*cannot be modified or deleted/);
  assertPolicy({ ".changes/config.json": null }, /\.changes\/config\.json is a required release audit input/);
});

test("evaluates exactly the squash diff for PR-head and merge-ref checkouts", () => {
  const { repoRoot, baseSha } = fixture();
  try {
    write(repoRoot, "packages/tui/src/index.ts", "export const value = 2;\n");
    const prHead = commit(repoRoot, "uncovered tui pull request");
    git(repoRoot, "switch", "-q", "main");
    write(repoRoot, "packages/tui/src/other.ts", "export const other = 1;\n");
    write(repoRoot, ".changes/main-tui.json", fragment(["tui"]));
    const advancedMain = commit(repoRoot, "covered tui change on main");

    git(repoRoot, "switch", "-q", "pr");
    for (const base of [baseSha, advancedMain]) {
      const result = runPolicy(repoRoot, base, prHead);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /do not cover tui\./);
    }

    // GitHub's merge ref: HEAD^1 is current main, HEAD^2 is the PR head. A stale
    // pull_request.base.sha must not pull main's own fragment into the PR's diff.
    git(repoRoot, "switch", "-q", "--detach", advancedMain);
    git(repoRoot, "merge", "-q", "--no-ff", "pr", "-m", "synthetic pull request merge ref");
    for (const base of [baseSha, advancedMain]) {
      const result = runPolicy(repoRoot, base, prHead);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /do not cover tui\./);
    }
    const unrelated = runPolicy(repoRoot, baseSha, advancedMain);
    assert.equal(unrelated.status, 1);
    assert.match(unrelated.stderr, /is neither PR head .* nor its merge commit/);

    git(repoRoot, "switch", "-q", "pr");
    write(repoRoot, ".changes/pr-tui.json", fragment(["tui"]));
    const coveredHead = commit(repoRoot, "cover the tui change");
    git(repoRoot, "switch", "-q", "--detach", advancedMain);
    git(repoRoot, "merge", "-q", "--no-ff", "pr", "-m", "updated merge ref");
    const covered = runPolicy(repoRoot, baseSha, coveredHead);
    assert.equal(covered.status, 0, covered.stderr);
    assert.match(covered.stdout, /Release-note fragments pr-tui cover tui\./);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("requires full base and head commit SHAs", () => {
  const { repoRoot, baseSha } = fixture();
  try {
    for (const args of [[], [baseSha], [baseSha.slice(0, 12), baseSha], [baseSha, "HEAD"]]) {
      const result = spawnSync(process.execPath, [policyScript, ...args], { cwd: repoRoot, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Usage: node scripts\/release-pr-fragment-policy\.js <base-sha> <head-sha>/);
    }
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
