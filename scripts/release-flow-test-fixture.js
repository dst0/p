import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { disableDetachedGitMaintenance } from "./git-test-fixture.js";

const releaseScript = resolve("scripts/release.js");
const versionBumpScript = resolve("scripts/version-bump.js");
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

export function git(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

export function gitBuffer(repoRoot, ...args) {
  return execFileSync("git", args, { cwd: repoRoot });
}

export function write(repoRoot, relativePath, content) {
  const target = join(repoRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

export function cloneReleaseFlowFixtureRepository(fixture, directoryName) {
  const cloneRoot = join(fixture.root, directoryName);
  git(fixture.root, "clone", fixture.remoteRoot, cloneRoot);
  disableDetachedGitMaintenance(cloneRoot);
  return cloneRoot;
}

function addPackageFiles(repoRoot) {
  const lockPackages = { "": { version: "0.4.0" } };
  for (const [path, name] of workspacePackages) {
    write(repoRoot, path, `${JSON.stringify({ name, version: "0.4.0" }, null, 2)}\n`);
    lockPackages[path.replace("/package.json", "")] = { name, version: "0.4.0" };
  }
  write(
    repoRoot,
    "package.json",
    '{"name":"fixture","version":"0.4.0","type":"module","workspaces":["packages/*","packages/coding-agent/examples/extensions/*"]}\n',
  );
  write(
    repoRoot,
    "package-lock.json",
    `${JSON.stringify({ name: "fixture", version: "0.4.0", packages: lockPackages }, null, 2)}\n`,
  );
}

export function createReleaseFlowFixture() {
  const root = mkdtempSync(join(tmpdir(), "p-release-flow-"));
  const repoRoot = join(root, "repo");
  const remoteRoot = join(root, "origin.git");
  mkdirSync(repoRoot);
  git(root, "init", "--bare", "-b", "main", remoteRoot);
  git(repoRoot, "init", "-b", "main");
  disableDetachedGitMaintenance(remoteRoot);
  disableDetachedGitMaintenance(repoRoot);
  git(repoRoot, "config", "user.email", "release-test@example.invalid");
  git(repoRoot, "config", "user.name", "Release Test");
  git(repoRoot, "remote", "add", "origin", remoteRoot);
  addPackageFiles(repoRoot);
  write(repoRoot, "AGENTS.md", "release rules\n");
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
    "scripts/release-output-verifier.js",
    "scripts/release-origin-policy.js",
    "scripts/release-target-policy.js",
    "scripts/release-transaction.js",
    "scripts/release-version-content.js",
    "scripts/release-workspaces.js",
    "scripts/verify-release-certificate.js",
    ".github/workflows/build-binaries.yml",
    ".github/workflows/ci.yml",
  ]) {
    write(repoRoot, path, `${path}\n`);
  }
  write(repoRoot, "scripts/version-bump.js", `import ${JSON.stringify(versionBumpScript)};\n`);
  write(
    repoRoot,
    "scripts/generate-coding-agent-shrinkwrap.js",
    'import { readFileSync, writeFileSync } from "node:fs";\nconst pkg = JSON.parse(readFileSync("packages/coding-agent/package.json"));\nconst shrinkwrap = JSON.parse(readFileSync("packages/coding-agent/npm-shrinkwrap.json"));\nshrinkwrap.version = pkg.version;\nshrinkwrap.packages[""].version = pkg.version;\nwriteFileSync("packages/coding-agent/npm-shrinkwrap.json", `${JSON.stringify(shrinkwrap, null, 2)}\\n`);\n',
  );
  write(
    repoRoot,
    "packages/coding-agent/npm-shrinkwrap.json",
    '{"name":"@dst0/p-coding-agent","version":"0.4.0","packages":{"":{"name":"@dst0/p-coding-agent","version":"0.4.0"}}}\n',
  );
  write(repoRoot, "packages/ai/src/models.generated.ts", "export const generatedModels = [];\n");
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
  git(repoRoot, "push", "-u", "origin", "main", "--tags");
  const fakeBin = join(root, "bin");
  write(root, "bin/npm", "#!/bin/sh\nexit 0\n");
  chmodSync(join(fakeBin, "npm"), 0o755);
  return { root, repoRoot, remoteRoot, fakeBin };
}

export function runFixtureRelease(fixture) {
  return spawnSync(process.execPath, [releaseScript, "0.5.0"], {
    cwd: fixture.repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${fixture.fakeBin}:${process.env.PATH}` },
    timeout: 30_000,
  });
}
