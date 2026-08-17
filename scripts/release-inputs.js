import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getChangelogPaths } from "./release-changelog-audit.js";
import {
  discoverWorkspacePackagePaths,
  resolveWorkspacePackagePaths,
} from "./release-workspaces.js";

const REQUIRED_INPUTS = [
  ".github/workflows/build-binaries.yml",
  ".github/workflows/ci.yml",
  ".changes/config.json",
  "AGENTS.md",
  "package-lock.json",
  "package.json",
  "scripts/release-audit-certificate.js",
  "scripts/release-audit.js",
  "scripts/release-changelog-audit.js",
  "scripts/release-transaction.js",
  "scripts/release.js",
  "scripts/verify-release-certificate.js",
  "scripts/version-bump.js",
];

function selectedInputPaths(allPaths, rootPackage, workspacePaths) {
  const paths = new Set([
    ...REQUIRED_INPUTS,
    ...workspacePaths,
    ...allPaths.filter((path) => /^packages\/[^/]+\/CHANGELOG\.md$/.test(path)),
    ...allPaths.filter((path) => /^packages\/[^/]+\/npm-shrinkwrap\.json$/.test(path)),
    ...allPaths.filter((path) => /^\.changes\/[^/]+\.json$/.test(path)),
    ...allPaths.filter(
      (path) =>
        (/^scripts\/release.*\.js$/.test(path) && !path.endsWith(".test.js")) ||
        ["scripts/generate-coding-agent-shrinkwrap.js", "scripts/sync-versions.js"].includes(path),
    ),
  ]);
  for (const path of REQUIRED_INPUTS) {
    if (!allPaths.includes(path)) {
      throw new Error(`Required release audit input is missing: ${path}`);
    }
  }
  if (!Array.isArray(rootPackage.workspaces) && !Array.isArray(rootPackage.workspaces?.packages)) {
    throw new Error("Root package.json must declare npm workspaces");
  }
  return [...paths].sort();
}

export function releaseInputPaths(repoRoot) {
  const allPaths = [
    ...REQUIRED_INPUTS.filter((path) => existsSync(join(repoRoot, path))),
    ...getChangelogPaths(repoRoot),
    ...discoverWorkspacePackagePaths(repoRoot),
  ];
  const scriptsRoot = join(repoRoot, "scripts");
  for (const name of readdirSync(scriptsRoot)) {
    allPaths.push(`scripts/${name}`);
  }
  for (const packageName of readdirSync(join(repoRoot, "packages"))) {
    for (const name of ["CHANGELOG.md", "npm-shrinkwrap.json"]) {
      const path = `packages/${packageName}/${name}`;
      if (existsSync(join(repoRoot, path))) {
        allPaths.push(path);
      }
    }
  }
  for (const name of readdirSync(join(repoRoot, ".changes"))) {
    allPaths.push(`.changes/${name}`);
  }
  const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  return selectedInputPaths([...new Set(allPaths)], rootPackage, discoverWorkspacePackagePaths(repoRoot));
}

function git(repoRoot, args, options = {}) {
  return execFileSync("git", args, { cwd: repoRoot, ...options });
}

export function releaseInputPathsAtRevision(repoRoot, revision) {
  const allPaths = git(repoRoot, ["ls-tree", "-r", "--name-only", revision], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  const rootPackage = JSON.parse(
    git(repoRoot, ["show", `${revision}:package.json`], { encoding: "utf8" }),
  );
  const workspacePaths = resolveWorkspacePackagePaths(rootPackage, allPaths);
  return selectedInputPaths(allPaths, rootPackage, workspacePaths);
}

export function hashReleaseInputEntries(entries) {
  const hash = createHash("sha256");
  for (const { path, content } of entries) {
    hash.update(`${Buffer.byteLength(path)}:${path}:${content.byteLength}:`);
    hash.update(content);
  }
  return hash.digest("hex");
}

export function computeReleaseInputHash(repoRoot) {
  return hashReleaseInputEntries(
    releaseInputPaths(repoRoot).map((path) => ({ path, content: readFileSync(join(repoRoot, path)) })),
  );
}
