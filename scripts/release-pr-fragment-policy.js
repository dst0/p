#!/usr/bin/env node

import { execFileSync } from "node:child_process";

import { materialReleasePaths } from "./release-change-fragments.js";
import { affectedChangelogPackages } from "./release-changelog-audit.js";
import { parseReleaseChangeFragment } from "./release-fragment-parser.js";

const CHANGES_PREFIX = ".changes/";
const CONFIG_PATH = ".changes/config.json";

const [baseSha, headSha] = process.argv.slice(2);
if (![baseSha, headSha].every((sha) => /^[a-f0-9]{40}$/.test(sha ?? ""))) {
  console.error("Usage: node scripts/release-pr-fragment-policy.js <base-sha> <head-sha>");
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function existsAtRevision(revision, path) {
  try {
    execFileSync("git", ["cat-file", "-e", `${revision}:${path}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function commitAt(revision) {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]).trim();
  } catch {
    return undefined;
  }
}

// main only allows squash merges, so a PR becomes one first-parent commit whose diff is what
// scripts/release-change-fragments.js audits at release time. On GitHub's refs/pull/N/merge
// checkout that diff is HEAD^1..HEAD; pull_request.base.sha can be stale, so it only anchors a
// checkout of the PR head itself.
const head = commitAt("HEAD");
let diffBase;
if (commitAt("HEAD^2") === headSha) {
  diffBase = commitAt("HEAD^1");
} else if (head === headSha) {
  diffBase = git(["merge-base", baseSha, "HEAD"]).trim();
} else {
  console.error(`HEAD ${head} is neither PR head ${headSha} nor its merge commit`);
  process.exit(1);
}
const changedPaths = git(["diff-tree", "-r", "-z", "--no-commit-id", "--name-only", diffBase, "HEAD"])
  .split("\0")
  .filter(Boolean)
  .sort();
const affectedPackages = affectedChangelogPackages(materialReleasePaths(changedPaths));
const errors = [];
const fragments = [];
for (const path of changedPaths) {
  if (path === CONFIG_PATH) {
    if (!existsAtRevision("HEAD", path)) {
      errors.push(`${CONFIG_PATH} is a required release audit input and cannot be deleted`);
    }
  } else if (!path.startsWith(CHANGES_PREFIX) || !path.endsWith(".json")) {
    continue;
  } else if (path.includes("/", CHANGES_PREFIX.length)) {
    errors.push(`${path}: release-note fragments must be top-level .changes/<id>.json files`);
  } else if (existsAtRevision(diffBase, path)) {
    errors.push(`${path}: release-note fragments introduced before this PR cannot be modified or deleted`);
  } else {
    try {
      // Parse the exact committed bytes, as the release reads them from the working tree.
      fragments.push(parseReleaseChangeFragment(path, git(["show", `HEAD:${path}`])));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}
const coveredPackages = new Set(fragments.flatMap((fragment) => fragment.packages));
const missingPackages = affectedPackages.filter((name) => !coveredPackages.has(name));
if (missingPackages.length > 0) {
  errors.push(
    `Release-note fragments do not cover ${missingPackages.join(", ")}. Add a .changes/<id>.json fragment ` +
      'naming every affected package (type "None" with a specific reason for non-user-facing changes).',
  );
}
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  affectedPackages.length === 0
    ? "No material release changes require a release-note fragment."
    : `Release-note fragments ${fragments.map((fragment) => fragment.id).join(", ")} cover ${affectedPackages.join(", ")}.`,
);
