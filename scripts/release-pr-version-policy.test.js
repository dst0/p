import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const policyScript = resolve("scripts/release-pr-version-policy.js");

function git(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function write(repoRoot, path, content) {
  const target = join(repoRoot, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "p-pr-version-policy-"));
  git(repoRoot, "init", "-b", "main");
  git(repoRoot, "config", "user.email", "version-policy@example.invalid");
  git(repoRoot, "config", "user.name", "Version Policy Test");
  write(repoRoot, "package.json", '{"name":"root","version":"0.4.0","workspaces":["packages/*"]}\n');
  write(
    repoRoot,
    "package-lock.json",
    '{"version":"0.4.0","packages":{"":{"version":"0.4.0"},"node_modules/agent":{"name":"agent","version":"0.4.0"}}}\n',
  );
  write(repoRoot, "packages/agent/package.json", '{"name":"agent","version":"0.4.0"}\n');
  git(repoRoot, "add", "--all");
  git(repoRoot, "commit", "-m", "base");
  return repoRoot;
}

test("PR policy rejects release version changes but permits ordinary manifest edits", () => {
  for (const [manifest, expectedStatus] of [
    ['{"name":"root","version":"0.4.1","workspaces":["packages/*"]}\n', 1],
    ['{"name":"root","version":"0.4.0","workspaces":["packages/*"],"private":true}\n', 0],
  ]) {
    const repoRoot = fixture();
    try {
      const baseSha = git(repoRoot, "rev-parse", "HEAD");
      write(repoRoot, "package.json", manifest);
      git(repoRoot, "add", "package.json");
      git(repoRoot, "commit", "-m", "change manifest");
      const result = spawnSync(process.execPath, [policyScript, baseSha], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      assert.equal(result.status, expectedStatus, result.stderr);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

test("PR policy rejects internal workspace version drift hidden inside the lockfile", () => {
  const repoRoot = fixture();
  try {
    const baseSha = git(repoRoot, "rev-parse", "HEAD");
    const lockfile = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
    lockfile.packages["node_modules/agent"].version = "0.5.0";
    write(repoRoot, "package-lock.json", `${JSON.stringify(lockfile)}\n`);
    git(repoRoot, "add", "package-lock.json");
    git(repoRoot, "commit", "-m", "hide version drift in lockfile");

    const result = spawnSync(process.execPath, [policyScript, baseSha], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Feature PRs cannot change release versions/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
