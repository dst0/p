#!/usr/bin/env node

import { execFileSync } from "node:child_process";

import { resolveWorkspacePackagePaths } from "./release-workspaces.js";

const baseSha = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(baseSha ?? "")) {
  console.error("Usage: node scripts/release-pr-version-policy.js <base-sha>");
  process.exit(1);
}

function git(args, options = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (options.allowMissing) {
      return null;
    }
    throw error;
  }
}

function readJson(revision, path) {
  const content = git(["show", `${revision}:${path}`], { allowMissing: true });
  return content === null ? null : JSON.parse(content);
}

function internalDependencies(value, internalPackageNames) {
  const result = {};
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(value?.[section] ?? {})) {
      if (internalPackageNames.has(name)) {
        result[`${section}:${name}`] = range;
      }
    }
  }
  return result;
}

function versionStateAt(revision, path, internalPackageNames) {
  const data = readJson(revision, path);
  if (!data) {
    return null;
  }
  if (path === "package-lock.json" || path.endsWith("npm-shrinkwrap.json")) {
    return Object.fromEntries(
      Object.entries(data.packages ?? {})
        .filter(([lockPath, entry]) => lockPath === "" || internalPackageNames.has(entry.name))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([lockPath, entry]) => [
          lockPath,
          {
            version: entry.version,
            internalDependencies: internalDependencies(entry, internalPackageNames),
          },
        ]),
    );
  }
  return {
    version: data.version,
    internalDependencies: internalDependencies(data, internalPackageNames),
  };
}

const headSha = git(["rev-parse", "HEAD"]);
const allPaths = git(["ls-tree", "-r", "--name-only", headSha]).split("\n").filter(Boolean);
const rootPackage = readJson(headSha, "package.json");
const workspacePaths = resolveWorkspacePackagePaths(rootPackage, allPaths);
const internalPackageNames = new Set(
  workspacePaths.map((path) => readJson(headSha, path)?.name).filter(Boolean),
);
const paths = [
  "package.json",
  "package-lock.json",
  "packages/coding-agent/npm-shrinkwrap.json",
  ...workspacePaths,
];
const changedVersions = paths.filter((path) => {
  const before = versionStateAt(baseSha, path, internalPackageNames);
  return before !== null && JSON.stringify(before) !== JSON.stringify(versionStateAt(headSha, path, internalPackageNames));
});
if (changedVersions.length > 0) {
  throw new Error(
    `Feature PRs cannot change release versions; use the certified main release flow: ${changedVersions.join(", ")}`,
  );
}
