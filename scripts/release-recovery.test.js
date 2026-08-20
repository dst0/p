import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { disableDetachedGitMaintenance } from "./git-test-fixture.js";
import { certifyReleaseAudit, writeReleaseAuditState } from "./release-audit-certificate.js";
import { reconcileReleaseState } from "./release-transaction.js";

function git(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function write(repoRoot, path, content) {
  const target = join(repoRoot, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "p-release-recovery-"));
  const repoRoot = join(root, "repo");
  const remoteRoot = join(root, "origin.git");
  mkdirSync(repoRoot);
  git(root, "init", "--bare", remoteRoot);
  git(repoRoot, "init", "-b", "main");
  disableDetachedGitMaintenance(remoteRoot);
  disableDetachedGitMaintenance(repoRoot);
  git(repoRoot, "config", "user.email", "recovery-test@example.invalid");
  git(repoRoot, "config", "user.name", "Recovery Test");
  git(repoRoot, "remote", "add", "origin", remoteRoot);
  write(repoRoot, "AGENTS.md", "release rules\n");
  write(repoRoot, "package.json", '{"name":"fixture","version":"0.4.0","workspaces":["packages/*"]}\n');
  write(repoRoot, "package-lock.json", '{"name":"fixture","version":"0.4.0","packages":{"":{"version":"0.4.0"}}}\n');
  write(repoRoot, "packages/agent/package.json", '{"name":"@dst0/p-agent","version":"0.4.0"}\n');
  write(
    repoRoot,
    "packages/agent/CHANGELOG.md",
    "# Changelog\n\n## [Unreleased]\n\n## [0.4.0] - 2026-08-01\n",
  );
  for (const path of [
    "scripts/release.js",
    "scripts/release-audit.js",
    "scripts/release-audit-certificate.js",
    "scripts/release-audit-evidence.js",
    "scripts/release-certificate-receipt.js",
    "scripts/release-change-fragments.js",
    "scripts/release-changelog-audit.js",
    "scripts/release-inputs.js",
    "scripts/release-path-policy.js",
    "scripts/release-transaction.js",
    "scripts/release-workspaces.js",
    "scripts/verify-release-certificate.js",
    "scripts/version-bump.js",
    ".github/workflows/build-binaries.yml",
    ".github/workflows/ci.yml",
  ]) {
    write(repoRoot, path, `${path}\n`);
  }
  git(repoRoot, "add", "--all");
  git(repoRoot, "commit", "-m", "release 0.4.0");
  git(repoRoot, "tag", "v0.4.0");
  write(repoRoot, ".changes/config.json", '{"schemaVersion":1}\n');
  write(
    repoRoot,
    ".changes/agent.json",
    '{"schemaVersion":1,"packages":["agent"],"type":"Added","summary":"Add the recovery fixture change."}\n',
  );
  write(repoRoot, "packages/agent/src/index.js", "export const value = 1;\n");
  git(repoRoot, "add", "--all");
  git(repoRoot, "commit", "-m", "add recovery fixture");
  git(repoRoot, "push", "-u", "origin", "main", "--tags");
  return { root, repoRoot };
}

test("recovery removes only its matching local-only release tag before a clean retry", () => {
  const fixture = createFixture();
  const retryRoot = join(fixture.root, "retry");
  try {
    const certificate = certifyReleaseAudit(fixture.repoRoot, "0.5.0");
    git(fixture.repoRoot, "commit", "--allow-empty", "-m", "Release v0.5.0");
    const releaseCommitSha = git(fixture.repoRoot, "rev-parse", "HEAD");
    git(fixture.repoRoot, "tag", "v0.5.0");
    writeReleaseAuditState(fixture.repoRoot, {
      ...certificate,
      state: "tagged",
      releaseCommitSha,
      expectedHeadSha: releaseCommitSha,
    });

    assert.equal(reconcileReleaseState(fixture.repoRoot).state, "aborted");
    assert.throws(() => git(fixture.repoRoot, "rev-parse", "--verify", "refs/tags/v0.5.0"));
    git(fixture.repoRoot, "worktree", "add", "--detach", retryRoot, "refs/remotes/origin/main");
    assert.equal(certifyReleaseAudit(retryRoot, "0.5.0").state, "certified");
    git(fixture.repoRoot, "worktree", "remove", "--force", retryRoot);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
