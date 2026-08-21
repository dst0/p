import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { disableDetachedGitMaintenance } from "./git-test-fixture.js";
import {
  certifyReleaseAudit,
  inspectReleaseCertificate,
  readReleaseAuditState,
  writeReleaseAuditState,
} from "./release-audit-certificate.js";
import { beginRelease, reconcileReleaseState } from "./release-transaction.js";

const releaseAuditScript = resolve("scripts/release-audit.js");
function git(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}
function write(repoRoot, relativePath, content) {
  const target = join(repoRoot, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}
function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "p-release-audit-"));
  git(repoRoot, "init", "-b", "main");
  disableDetachedGitMaintenance(repoRoot);
  git(repoRoot, "config", "user.email", "release-test@example.invalid");
  git(repoRoot, "config", "user.name", "Release Test");
  git(repoRoot, "remote", "add", "origin", repoRoot);
  write(repoRoot, "AGENTS.md", "release rules\n");
  write(
    repoRoot,
    "package.json",
    '{"name":"fixture","version":"0.4.0","type":"module","workspaces":["packages/*"]}\n',
  );
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
    "scripts/release-certificate-receipt.js",
    "scripts/release-change-fragments.js",
    "scripts/release-changelog-audit.js",
    "scripts/release-path-policy.js",
    "scripts/release-transaction.js",
    "scripts/release-workspaces.js",
    "scripts/verify-release-certificate.js",
    "scripts/version-bump.js",
    "scripts/generate-coding-agent-shrinkwrap.js",
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
    ".changes/add-value.json",
    '{"schemaVersion":1,"packages":["agent"],"type":"Added","summary":"Add the fixture value export."}\n',
  );
  write(repoRoot, "packages/agent/src/index.js", "export const value = 1;\n");
  write(
    repoRoot,
    "packages/agent/CHANGELOG.md",
    "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Added value.\n\n## [0.4.0] - 2026-08-01\n",
  );
  git(repoRoot, "add", "--all");
  git(repoRoot, "commit", "-m", "add value");
  git(repoRoot, "update-ref", "refs/remotes/origin/main", "HEAD");
  return repoRoot;
}

function withFixture(run) {
  const repoRoot = createFixture();
  try {
    run(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("persists a restart-safe Brotli Q6 certificate bound to main and inputs", () => {
  withFixture((repoRoot) => {
    const certificate = certifyReleaseAudit(repoRoot, "0.5.0");
    const inspection = inspectReleaseCertificate(repoRoot, "0.5.0");
    const statePath = git(repoRoot, "rev-parse", "--git-path", "p-release-audit-state.json.br");
    const absoluteStatePath = join(repoRoot, statePath);

    assert.equal(certificate.state, "certified");
    assert.equal(inspection.valid, true);
    assert.equal(readReleaseAuditState(repoRoot).certificateId, certificate.certificateId);
    assert.equal(existsSync(absoluteStatePath), true);
    assert.equal(JSON.parse(brotliDecompressSync(readFileSync(absoluteStatePath))).state, "certified");
    const restartedStatus = spawnSync(process.execPath, [releaseAuditScript, "status", "0.5.0"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(restartedStatus.status, 0, restartedStatus.stderr);
    const wrongTarget = spawnSync(process.execPath, [releaseAuditScript, "status", "0.5.1"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.notEqual(wrongTarget.status, 0);
    assert.equal(readReleaseAuditState(repoRoot).state, "certified");
  });
});
test("standalone audit CLI accepts the documented command shape", () => {
  withFixture((repoRoot) => {
    const audit = spawnSync(process.execPath, [releaseAuditScript, "audit", "0.5.0"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(audit.status, 0, `${audit.stdout}\n${audit.stderr}`);
    assert.equal(readReleaseAuditState(repoRoot).state, "certified");
  });
});
test("rejects tampered evidence and unsupported persisted schemas without mutating status", () => {
  withFixture((repoRoot) => {
    certifyReleaseAudit(repoRoot, "0.5.0");
    const tampered = readReleaseAuditState(repoRoot);
    tampered.evidence.changeFragments.commits = [];
    writeReleaseAuditState(repoRoot, tampered);
    assert.match(inspectReleaseCertificate(repoRoot, "0.5.0").reason, /evidence was modified/);
    assert.equal(readReleaseAuditState(repoRoot).state, "certified");
  });
  withFixture((repoRoot) => {
    certifyReleaseAudit(repoRoot, "0.5.0");
    const unsupported = readReleaseAuditState(repoRoot);
    unsupported.schemaVersion = 3;
    writeReleaseAuditState(repoRoot, unsupported);
    assert.match(inspectReleaseCertificate(repoRoot, "0.5.0").reason, /Unsupported release audit schema/);
    assert.equal(readReleaseAuditState(repoRoot).state, "certified");
  });
});
test("uses the highest reachable release tag and rejects a target below a changelog release", () => {
  withFixture((repoRoot) => {
    git(repoRoot, "tag", "v0.4.1", "HEAD^");
    const state = certifyReleaseAudit(repoRoot, "0.5.0");
    assert.equal(state.evidence.changelogs.baseTag, "v0.4.1");
  });
  withFixture((repoRoot) => {
    const path = "packages/agent/CHANGELOG.md";
    write(
      repoRoot,
      path,
      "# Changelog\n\n## [Unreleased]\n\n## [0.6.0] - 2026-08-02\n\n### Added\n\n- Added value.\n\n## [0.4.0] - 2026-08-01\n",
    );
    rmSync(join(repoRoot, ".changes/add-value.json"));
    git(repoRoot, "add", "--all", path, ".changes/add-value.json");
    git(repoRoot, "commit", "-m", "record future release");
    git(repoRoot, "tag", "v0.6.0");
    git(repoRoot, "update-ref", "refs/remotes/origin/main", "HEAD");
    assert.throws(() => certifyReleaseAudit(repoRoot, "0.5.0"), /target 0.5.0 must be greater than 0.6.0/);
  });
});
test("invalidates a certificate after a new commit, changelog edit, or release-input edit", () => {
  for (const mutate of [
    (repoRoot) => {
      write(repoRoot, "README.md", "new commit\n");
      git(repoRoot, "add", "README.md");
      git(repoRoot, "commit", "-m", "new commit");
      git(repoRoot, "update-ref", "refs/remotes/origin/main", "HEAD");
    },
    (repoRoot) => write(repoRoot, "packages/agent/CHANGELOG.md", "changed\n"),
    (repoRoot) => write(repoRoot, "scripts/release.js", "changed release input\n"),
  ]) {
    withFixture((repoRoot) => {
      certifyReleaseAudit(repoRoot, "0.5.0");
      mutate(repoRoot);
      const inspection = inspectReleaseCertificate(repoRoot, "0.5.0");
      assert.equal(inspection.valid, false);
      assert.match(inspection.reason, /(HEAD|input hash)/);
      assert.equal(readReleaseAuditState(repoRoot).state, "certified");
    });
  }
});

test("accepts fragment-covered changes before changelog aggregation", () => {
  withFixture((repoRoot) => {
    write(
      repoRoot,
      "packages/agent/CHANGELOG.md",
      "# Changelog\n\n## [Unreleased]\n\n## [0.4.0] - 2026-08-01\n",
    );
    git(repoRoot, "add", "packages/agent/CHANGELOG.md");
    git(repoRoot, "commit", "-m", "remove release note");
    git(repoRoot, "update-ref", "refs/remotes/origin/main", "HEAD");

    assert.equal(certifyReleaseAudit(repoRoot, "0.5.0").state, "certified");
  });
});

test("rejects edits to released changelog history", () => {
  withFixture((repoRoot) => {
    const path = "packages/agent/CHANGELOG.md";
    const content = readFileSync(join(repoRoot, path), "utf8").replace(
      "## [0.4.0] - 2026-08-01",
      "## [0.4.0] - 2026-08-02",
    );
    write(repoRoot, path, content);
    git(repoRoot, "add", path);
    git(repoRoot, "commit", "-m", "rewrite released history");
    git(repoRoot, "update-ref", "refs/remotes/origin/main", "HEAD");

    assert.throws(() => certifyReleaseAudit(repoRoot, "0.5.0"), /released history is immutable/);
  });
});

test("requires a minor target for Breaking Changes fragments", () => {
  withFixture((repoRoot) => {
    write(
      repoRoot,
      ".changes/add-value.json",
      '{"schemaVersion":1,"packages":["agent"],"type":"Breaking Changes","summary":"Remove the legacy fixture value API."}\n',
    );
    write(repoRoot, "packages/agent/src/index.js", "export const replacement = 1;\n");
    git(repoRoot, "add", ".changes/add-value.json", "packages/agent/src/index.js");
    git(repoRoot, "commit", "--amend", "--no-edit");
    git(repoRoot, "update-ref", "refs/remotes/origin/main", "HEAD");

    assert.throws(() => certifyReleaseAudit(repoRoot, "0.4.1"), /require a minor release target/);
    assert.equal(certifyReleaseAudit(repoRoot, "0.5.0").state, "certified");
  });
});

test("accepts a justified None fragment without adding a changelog bullet", () => {
  withFixture((repoRoot) => {
    write(
      repoRoot,
      ".changes/add-value.json",
      '{"schemaVersion":1,"packages":["agent"],"type":"None","reason":"Internal test-only fixture maintenance."}\n',
    );
    write(repoRoot, "packages/agent/src/index.js", "export const value = 2;\n");
    write(
      repoRoot,
      "packages/agent/CHANGELOG.md",
      "# Changelog\n\n## [Unreleased]\n\n## [0.4.0] - 2026-08-01\n",
    );
    git(repoRoot, "add", ".changes/add-value.json", "packages/agent/src/index.js", "packages/agent/CHANGELOG.md");
    git(repoRoot, "commit", "--amend", "--no-edit");
    git(repoRoot, "update-ref", "refs/remotes/origin/main", "HEAD");

    assert.equal(certifyReleaseAudit(repoRoot, "0.4.1").state, "certified");
  });
});


test("does not reuse a certificate for another target or a second release", () => {
  withFixture((repoRoot) => {
    certifyReleaseAudit(repoRoot, "0.5.0");
    assert.equal(inspectReleaseCertificate(repoRoot, "0.5.1").valid, false);
    assert.equal(readReleaseAuditState(repoRoot).state, "certified");
  });
  withFixture((repoRoot) => {
    certifyReleaseAudit(repoRoot, "0.5.0");
    const authorization = beginRelease(repoRoot, "0.5.0");
    assert.equal(authorization.state, "release_in_progress");
    assert.throws(() => beginRelease(repoRoot, "0.5.0"), /not certified/);
    assert.throws(() => certifyReleaseAudit(repoRoot, "0.5.0"), /Cannot replace release audit/);
  });
});

test("reconciles every unpushed active state to an explicit aborted state", () => {
  for (const activeState of [
    "release_in_progress",
    "version_bump_in_progress",
    "version_bumped",
    "artifacts_ready",
    "checks_passed",
    "release_committed",
    "tagged",
    "next_cycle_committed",
    "failed",
  ]) {
    withFixture((repoRoot) => {
      const certified = certifyReleaseAudit(repoRoot, "0.5.0");
      writeReleaseAuditState(repoRoot, { ...certified, state: activeState });
      assert.equal(reconcileReleaseState(repoRoot).state, "aborted");
      assert.equal(certifyReleaseAudit(repoRoot, "0.5.0").state, "certified");
    });
  }
});
