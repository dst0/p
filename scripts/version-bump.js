#!/usr/bin/env node

/**
 * Sets one lockstep version across the monorepo without invoking
 * `npm version -ws`, which cannot resolve unpublished workspace versions.
 * A certified release transaction must authorize every invocation.
 *
 * Usage: node scripts/version-bump.js [patch|minor|x.y.z]
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gt, inc, valid } from "semver";

import {
  consumeVersionBumpAuthorization,
  markVersionBumped,
} from "./release-transaction.js";
import {
  versionLockfileContent,
  versionPackageContent,
  workspacePackageNames,
} from "./release-version-content.js";
import { readWorkspacePackages } from "./release-workspaces.js";

const requestedTarget = process.argv[2] || "minor";
const bumpTypes = new Set(["patch", "minor"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveTargetVersion(currentVersion) {
  if (bumpTypes.has(requestedTarget)) {
    return inc(currentVersion, requestedTarget);
  }
  if (!valid(requestedTarget) || !gt(requestedTarget, currentVersion)) {
    return null;
  }
  if (Number(requestedTarget.split(".")[0]) !== Number(currentVersion.split(".")[0])) {
    return null;
  }
  return requestedTarget;
}

const repoRoot = process.cwd();
const rootPackagePath = join(repoRoot, "package.json");
const rootPackage = readJson(rootPackagePath);
const targetVersion = resolveTargetVersion(rootPackage.version);
if (!targetVersion) {
  console.error("Usage: node scripts/version-bump.js [patch|minor|x.y.z in the current major]");
  process.exit(1);
}

const workspacePackages = readWorkspacePackages(repoRoot);
const internalPackageNames = workspacePackageNames(workspacePackages);
const packages = new Map(
  workspacePackages.map(({ path, packageJson }) => [
    path,
    versionPackageContent(packageJson, targetVersion, internalPackageNames),
  ]),
);

const lockfilePath = join(repoRoot, "package-lock.json");
const lockfile = versionLockfileContent(readJson(lockfilePath), targetVersion, internalPackageNames);

const authorizationToken = process.env.P_RELEASE_AUDIT_TOKEN;
try {
  consumeVersionBumpAuthorization(repoRoot, targetVersion, authorizationToken);
} catch (error) {
  console.error(`Release audit authorization failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

for (const [relativePath, packageJson] of packages) {
  const previousVersion = packageJson.version;
  packageJson.version = targetVersion;
  writeJson(join(repoRoot, relativePath), packageJson);
  console.log(`${packageJson.name}: ${previousVersion} → ${targetVersion}`);
}
const previousRootVersion = rootPackage.version;
rootPackage.version = targetVersion;
writeJson(rootPackagePath, rootPackage);
writeJson(lockfilePath, lockfile);
console.log(`p-monorepo (root): ${previousRootVersion} → ${targetVersion}`);

execFileSync(process.execPath, [join(repoRoot, "scripts/generate-coding-agent-shrinkwrap.js")], {
  stdio: "inherit",
});
markVersionBumped(repoRoot, targetVersion, authorizationToken);
console.log(`\nBumped all packages to ${targetVersion}`);
