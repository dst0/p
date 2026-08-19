import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { certifyReleaseAudit, readReleaseAuditState } from "./release-audit-certificate.js";
import { disableDetachedGitMaintenance } from "./git-test-fixture.js";
import { advanceReleaseState, beginRelease } from "./release-transaction.js";
import { discoverWorkspacePackagePaths } from "./release-workspaces.js";

const sourceRoot = process.cwd();
const versionBumpScript = resolve("scripts/version-bump.js");
const shrinkwrapGenerator = resolve("scripts/generate-coding-agent-shrinkwrap.js");
const workspacePackages = [
  ["packages/agent/package.json", "@dst0/p-agent"],
  ["packages/ai/package.json", "@dst0/p-ai"],
  ["packages/coding-agent/package.json", "@dst0/p-coding-agent"],
  ["packages/code-index/package.json", "@dst0/p-code-index"],
  ["packages/site/package.json", "@dst0/p-site"],
  ["packages/tui/package.json", "@dst0/p-tui"],
  ["packages/coding-agent/examples/extensions/with-deps/package.json", "fixture-with-deps"],
  ["packages/coding-agent/examples/extensions/custom-provider-anthropic/package.json", "fixture-anthropic"],
  ["packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/package.json", "fixture-gitlab"],
  ["packages/coding-agent/examples/extensions/sandbox/package.json", "fixture-sandbox"],
];

function write(repoRoot, relativePath, content) {
  const target = join(repoRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function git(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "p-version-bump-"));
  git(repoRoot, "init", "-b", "main");
  disableDetachedGitMaintenance(repoRoot);
  git(repoRoot, "config", "user.email", "release-test@example.invalid");
  git(repoRoot, "config", "user.name", "Release Test");
  write(repoRoot, "AGENTS.md", "release rules\n");
  write(
    repoRoot,
    "package.json",
    '{"name":"fixture","version":"0.4.224","type":"module","workspaces":["packages/*","packages/coding-agent/examples/extensions/*"]}\n',
  );
  const lockPackages = { "": { version: "0.4.224" } };
  for (const [path, name] of workspacePackages) {
    const version = name === "@dst0/p-site" ? "0.4.134" : "0.4.224";
    const dependencies = name === "@dst0/p-coding-agent" ? { "@dst0/p-ai": "^0.4.224" } : undefined;
    write(repoRoot, path, `${JSON.stringify({ name, version, dependencies }, null, 2)}\n`);
    lockPackages[path.replace("/package.json", "")] = { name, version, dependencies };
  }
  write(
    repoRoot,
    "package-lock.json",
    `${JSON.stringify({ name: "fixture", version: "0.4.224", packages: lockPackages }, null, 2)}\n`,
  );
  write(
    repoRoot,
    "packages/agent/CHANGELOG.md",
    "# Changelog\n\n## [Unreleased]\n\n## [0.4.158] - 2026-08-01\n",
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
    write(repoRoot, path, path === "scripts/generate-coding-agent-shrinkwrap.js" ? "// fixture\n" : `${path}\n`);
  }
  git(repoRoot, "add", "--all");
  git(repoRoot, "commit", "-m", "release 0.4.158");
  git(repoRoot, "tag", "v0.4.158");
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
    "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Added value.\n\n## [0.4.158] - 2026-08-01\n",
  );
  git(repoRoot, "add", "--all");
  git(repoRoot, "commit", "-m", "add value");
  git(repoRoot, "update-ref", "refs/remotes/origin/main", "HEAD");
  return repoRoot;
}

test("version bump rejects missing authorization before writing files", () => {
  const repoRoot = createFixture();
  try {
    const before = readFileSync(join(repoRoot, "package.json"), "utf8");
    const result = spawnSync(process.execPath, [versionBumpScript, "0.5.0"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release audit authorization/i);
    assert.equal(readFileSync(join(repoRoot, "package.json"), "utf8"), before);
    for (const disallowed of ["major", "1.0.0"]) {
      const majorResult = spawnSync(process.execPath, [versionBumpScript, disallowed], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      assert.notEqual(majorResult.status, 0);
      assert.equal(readFileSync(join(repoRoot, "package.json"), "utf8"), before);
    }
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("version bump consumes the matching certificate transaction exactly once", () => {
  const repoRoot = createFixture();
  try {
    certifyReleaseAudit(repoRoot, "0.5.0");
    const authorization = beginRelease(repoRoot, "0.5.0");
    const result = spawnSync(process.execPath, [versionBumpScript, "0.5.0"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, P_RELEASE_AUDIT_TOKEN: authorization.token },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(readFileSync(join(repoRoot, "package.json"))).version, "0.5.0");
    for (const [path] of workspacePackages) {
      assert.equal(JSON.parse(readFileSync(join(repoRoot, path))).version, "0.5.0", path);
    }
    const codingAgent = JSON.parse(readFileSync(join(repoRoot, "packages/coding-agent/package.json")));
    assert.equal(codingAgent.dependencies["@dst0/p-ai"], "^0.5.0");
    const lockfile = JSON.parse(readFileSync(join(repoRoot, "package-lock.json")));
    assert.equal(lockfile.version, "0.5.0");
    for (const entry of Object.values(lockfile.packages)) {
      assert.equal(entry.version, "0.5.0");
    }
    assert.equal(readReleaseAuditState(repoRoot).state, "version_bumped");
    assert.throws(
      () => advanceReleaseState(repoRoot, "0.5.0", authorization.token, "version_bumped", "released"),
      /Invalid release state transition/,
    );
    assert.throws(() => certifyReleaseAudit(repoRoot, "0.5.1"), /Cannot replace release audit/);
    const retry = spawnSync(process.execPath, [versionBumpScript, "0.5.0"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, P_RELEASE_AUDIT_TOKEN: authorization.token },
    });
    assert.notEqual(retry.status, 0);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("bumps the real 0.4.224 and 0.4.134 manifest snapshot and shrinkwrap to 0.5.0", () => {
  const repoRoot = createFixture();
  try {
    const snapshotPaths = [
      "package.json",
      "package-lock.json",
      "packages/coding-agent/npm-shrinkwrap.json",
      ...discoverWorkspacePackagePaths(sourceRoot),
      "packages/agent/CHANGELOG.md",
      "packages/ai/CHANGELOG.md",
      "packages/coding-agent/CHANGELOG.md",
      "packages/tui/CHANGELOG.md",
    ];
    for (const path of snapshotPaths) {
      const target = join(repoRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(sourceRoot, path), target);
    }
    copyFileSync(shrinkwrapGenerator, join(repoRoot, "scripts/generate-coding-agent-shrinkwrap.js"));
    git(repoRoot, "add", "--all");
    git(repoRoot, "commit", "-m", "load current release base snapshot");
    git(repoRoot, "tag", "v0.4.224");
    write(
      repoRoot,
      ".changes/add-value.json",
      '{"schemaVersion":1,"packages":["agent","ai","coding-agent","tui"],"type":"Changed","summary":"Exercise the current workspace release snapshot."}\n',
    );
    write(repoRoot, "packages/agent/src/index.js", "export const value = 2;\n");
    git(repoRoot, "add", "--all");
    git(repoRoot, "commit", "-m", "cover current release snapshot");
    git(repoRoot, "update-ref", "refs/remotes/origin/main", "HEAD");
    certifyReleaseAudit(repoRoot, "0.5.0");
    const authorization = beginRelease(repoRoot, "0.5.0");
    const result = spawnSync(process.execPath, [versionBumpScript, "0.5.0"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, P_RELEASE_AUDIT_TOKEN: authorization.token },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    for (const path of discoverWorkspacePackagePaths(repoRoot)) {
      assert.equal(JSON.parse(readFileSync(join(repoRoot, path))).version, "0.5.0", path);
    }
    const shrinkwrap = JSON.parse(readFileSync(join(repoRoot, "packages/coding-agent/npm-shrinkwrap.json")));
    assert.equal(shrinkwrap.version, "0.5.0");
    assert.equal(shrinkwrap.packages[""].version, "0.5.0");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
