import assert from "node:assert/strict";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  readReleaseAuditState,
  writeReleaseAuditState,
} from "./release-audit-certificate.js";
import { verifyReleaseReceipt } from "./release-certificate-receipt.js";
import {
  cloneReleaseFlowFixtureRepository,
  createReleaseFlowFixture,
  git,
  runFixtureRelease,
  write,
} from "./release-flow-test-fixture.js";
import { reconcileReleaseState } from "./release-transaction.js";

test("release automatically audits, consumes the certificate, and atomically pushes", () => {
  const fixture = createReleaseFlowFixture();
  try {
    assert.throws(() => verifyReleaseReceipt(fixture.repoRoot, "v0.4.0"));
    const result = runFixtureRelease(fixture);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Auditing changelogs/);
    assert.equal(readReleaseAuditState(fixture.repoRoot).state, "released");
    assert.equal(JSON.parse(readFileSync(join(fixture.repoRoot, "package.json"))).version, "0.5.0");
    assert.match(
      git(fixture.repoRoot, "show", "v0.5.0:packages/agent/CHANGELOG.md"),
      /Add the fixture value export/,
    );
    assert.throws(() => git(fixture.repoRoot, "show", "v0.5.0:.changes/add-value.json"));
    const remoteMain = git(fixture.remoteRoot, "rev-parse", "refs/heads/main");
    const remoteTag = git(fixture.remoteRoot, "rev-parse", "refs/tags/v0.5.0");
    assert.equal(git(fixture.repoRoot, "rev-parse", "HEAD"), remoteMain);
    assert.equal(git(fixture.repoRoot, "rev-parse", "HEAD^"), remoteTag);
    assert.equal(verifyReleaseReceipt(fixture.repoRoot, "v0.5.0").receipt.targetVersion, "0.5.0");
    const released = readReleaseAuditState(fixture.repoRoot);
    writeReleaseAuditState(fixture.repoRoot, { ...released, state: "next_cycle_committed" });
    assert.equal(reconcileReleaseState(fixture.repoRoot).state, "released");
    const advancedClone = cloneReleaseFlowFixtureRepository(fixture, "advanced-main");
    git(advancedClone, "config", "user.email", "release-test@example.invalid");
    git(advancedClone, "config", "user.name", "Release Test");
    write(advancedClone, "README.md", "main advanced after the release\n");
    git(advancedClone, "add", "README.md");
    git(advancedClone, "commit", "-m", "advance main after release");
    git(advancedClone, "push", "origin", "main");
    git(fixture.repoRoot, "fetch", "origin", "main");
    writeReleaseAuditState(fixture.repoRoot, { ...released, state: "next_cycle_committed" });
    assert.equal(reconcileReleaseState(fixture.repoRoot).state, "released");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("explicit major authorization survives the full certified release flow", () => {
  const fixture = createReleaseFlowFixture();
  try {
    const unauthorized = runFixtureRelease(fixture, "5.0.1");
    assert.notEqual(unauthorized.status, 0);
    assert.match(`${unauthorized.stdout}\n${unauthorized.stderr}`, /explicit authorization/);

    const result = runFixtureRelease(fixture, "5.0.1", { allowMajor: true });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(readFileSync(join(fixture.repoRoot, "package.json"))).version, "5.0.1");
    const verified = verifyReleaseReceipt(fixture.repoRoot, "v5.0.1");
    assert.equal(verified.receipt.allowMajor, true);
    assert.equal(readReleaseAuditState(fixture.repoRoot).state, "released");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a pre-commit hook that stages an unexpected release file", () => {
  const fixture = createReleaseFlowFixture();
  try {
    const hookPath = join(fixture.repoRoot, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\nprintf 'unexpected\\n' > unexpected-release.txt\ngit add unexpected-release.txt\n");
    chmodSync(hookPath, 0o755);
    const originalRemoteMain = git(fixture.remoteRoot, "rev-parse", "refs/heads/main");
    const result = runFixtureRelease(fixture);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /unexpected-release\.txt/);
    assert.equal(readReleaseAuditState(fixture.repoRoot).state, "failed");
    assert.equal(git(fixture.remoteRoot, "rev-parse", "refs/heads/main"), originalRemoteMain);
    assert.throws(() => git(fixture.remoteRoot, "rev-parse", "refs/tags/v0.5.0"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects an allowed-file mutation staged by the next-cycle commit hook", () => {
  const fixture = createReleaseFlowFixture();
  try {
    const hookPath = join(fixture.repoRoot, ".git", "hooks", "pre-commit");
    writeFileSync(
      hookPath,
      '#!/bin/sh\ncount_file="$(git rev-parse --git-path hooks)/release-test-count"\ncount=0\n[ -f "$count_file" ] && count="$(cat "$count_file")"\ncount=$((count + 1))\nprintf "%s" "$count" > "$count_file"\nif [ "$count" -eq 2 ]; then\n  printf \'{"name":"fixture","version":"9.9.9","type":"module","workspaces":["packages/*"]}\\n\' > package.json\n  git add package.json\nfi\n',
    );
    chmodSync(hookPath, 0o755);
    const originalRemoteMain = git(fixture.remoteRoot, "rev-parse", "refs/heads/main");
    const result = runFixtureRelease(fixture);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /commit tree changed after the validated index/);
    assert.equal(readReleaseAuditState(fixture.repoRoot).state, "failed");
    assert.equal(git(fixture.remoteRoot, "rev-parse", "refs/heads/main"), originalRemoteMain);
    assert.throws(() => git(fixture.remoteRoot, "rev-parse", "refs/tags/v0.5.0"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("release fixtures disable detached Git maintenance", () => {
  const fixture = createReleaseFlowFixture();
  try {
    const cloneRoot = cloneReleaseFlowFixtureRepository(fixture, "maintenance-policy-clone");
    for (const repository of [fixture.repoRoot, fixture.remoteRoot, cloneRoot]) {
      assert.equal(git(repository, "config", "--local", "--get", "--bool", "maintenance.auto"), "false");
      assert.equal(
        git(repository, "config", "--local", "--get", "--bool", "maintenance.autoDetach"),
        "false",
      );
      assert.equal(git(repository, "config", "--local", "--get", "--int", "gc.auto"), "0");
      assert.equal(git(repository, "config", "--local", "--get", "--bool", "gc.autoDetach"), "false");
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
