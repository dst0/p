import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { requireCleanReleaseBenchmarkBase } from "../../src/workloads/release-benchmark-base.ts";

test("release benchmark base fails before execution unless HEAD is clean exact origin/main", () => {
  const root = mkdtempSync(join(tmpdir(), "release-benchmark-base-"));
  const remote = join(root, "origin.git");
  const repo = join(root, "repo");
  try {
    mkdirSync(repo);
    git(root, "init", "--bare", "-b", "main", remote);
    git(repo, "init", "-b", "main");
    disableMaintenance(remote);
    disableMaintenance(repo);
    git(repo, "config", "user.email", "benchmark-test@example.invalid");
    git(repo, "config", "user.name", "Benchmark Test");
    git(repo, "remote", "add", "origin", remote);
    writeFileSync(join(repo, "tracked.txt"), "base\n");
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "base");
    git(repo, "push", "-u", "origin", "main");

    const expected = git(repo, "rev-parse", "HEAD");
    assert.deepEqual(requireCleanReleaseBenchmarkBase(repo), { headSha: expected, originMainSha: expected });

    writeFileSync(join(repo, "untracked.txt"), "dirty\n");
    assert.throws(() => requireCleanReleaseBenchmarkBase(repo), /clean exact origin\/main/u);
    rmSync(join(repo, "untracked.txt"));

    writeFileSync(join(repo, "tracked.txt"), "advanced\n");
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "advance local head");
    assert.throws(() => requireCleanReleaseBenchmarkBase(repo), /clean exact origin\/main/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release benchmark base refreshes origin/main before accepting a long run", () => {
  const fixture = createCleanFixture();
  const peer = join(fixture.root, "peer");
  try {
    git(fixture.root, "clone", fixture.remote, peer);
    disableMaintenance(peer);
    git(peer, "config", "user.email", "benchmark-peer@example.invalid");
    git(peer, "config", "user.name", "Benchmark Peer");
    writeFileSync(join(peer, "remote.txt"), "advanced remotely\n");
    git(peer, "add", "remote.txt");
    git(peer, "commit", "-m", "advance remote head");
    git(peer, "push", "origin", "main");

    assert.throws(() => requireCleanReleaseBenchmarkBase(fixture.repo), /clean exact origin\/main/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function createCleanFixture(): { root: string; remote: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), "release-benchmark-base-"));
  const remote = join(root, "origin.git");
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(root, "init", "--bare", "-b", "main", remote);
  git(repo, "init", "-b", "main");
  disableMaintenance(remote);
  disableMaintenance(repo);
  git(repo, "config", "user.email", "benchmark-test@example.invalid");
  git(repo, "config", "user.name", "Benchmark Test");
  git(repo, "remote", "add", "origin", remote);
  writeFileSync(join(repo, "tracked.txt"), "base\n");
  git(repo, "add", "tracked.txt");
  git(repo, "commit", "-m", "base");
  git(repo, "push", "-u", "origin", "main");
  return { root, remote, repo };
}

function disableMaintenance(repo: string): void {
  git(repo, "config", "--local", "maintenance.auto", "false");
  git(repo, "config", "--local", "maintenance.autoDetach", "false");
  git(repo, "config", "--local", "gc.auto", "0");
  git(repo, "config", "--local", "gc.autoDetach", "false");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
