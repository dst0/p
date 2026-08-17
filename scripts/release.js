#!/usr/bin/env node

/**
 * Executes a certified, lockstep monorepo release.
 *
 * Usage: node scripts/release.js <minor|patch|x.y.z>
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gt, inc, valid } from "semver";

import { certifyReleaseAudit, readReleaseAuditState } from "./release-audit-certificate.js";
import { applyReleaseFragments } from "./release-change-fragments.js";
import { getChangelogPaths } from "./release-changelog-audit.js";
import { isAllowedReleaseMutationPath } from "./release-path-policy.js";
import {
  advanceReleaseState,
  beginRelease,
  failRelease,
  reconcileReleaseState,
  recordReleaseCommit,
  writeReleaseReceipt,
} from "./release-transaction.js";

const requestedTarget = process.argv[2];
const bumpTypes = new Set(["minor", "patch"]);
const changelogHeader = "# Changelog\n\n## [Unreleased]\n\n";

if (!requestedTarget) {
  console.error("Usage: node scripts/release.js <minor|patch|x.y.z>");
  process.exit(1);
}

function displayCommand(command, args) {
  return [command, ...args].join(" ");
}

function run(command, args = [], options = {}) {
  console.log(`$ ${displayCommand(command, args)}`);
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.silent ? "pipe" : "inherit",
    env: options.env ?? process.env,
  });
}

function git(args, options = {}) {
  return run("git", args, options)?.trim() ?? "";
}

function getVersion() {
  return JSON.parse(readFileSync("package.json", "utf8")).version;
}

function resolveTargetVersion() {
  const currentVersion = getVersion();
  if (bumpTypes.has(requestedTarget)) {
    return inc(currentVersion, requestedTarget);
  }
  if (!valid(requestedTarget) || !gt(requestedTarget, currentVersion)) {
    throw new Error(`Release target ${requestedTarget} must be a semantic version greater than ${currentVersion}`);
  }
  if (Number(requestedTarget.split(".")[0]) !== Number(currentVersion.split(".")[0])) {
    throw new Error("Major releases are not permitted by repository policy");
  }
  return requestedTarget;
}

function changedPaths() {
  const tracked = git(["diff", "--name-only"], { silent: true });
  const staged = git(["diff", "--cached", "--name-only"], { silent: true });
  const untracked = git(["ls-files", "--others", "--exclude-standard"], { silent: true });
  return [...new Set(`${tracked}\n${staged}\n${untracked}`.split("\n").filter(Boolean))].sort();
}

function assertCleanWorktree() {
  const status = git(["status", "--porcelain"], { silent: true });
  if (status) {
    throw new Error(`Uncommitted changes detected:\n${status}`);
  }
}

function assertReleaseMutationPaths(paths) {
  const unexpected = paths.filter((path) => !isAllowedReleaseMutationPath(process.cwd(), path));
  if (unexpected.length > 0) {
    throw new Error(`Release generated unexpected changes: ${unexpected.join(", ")}`);
  }
}

function assertReleaseCommit(expectedTree) {
  const paths = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], { silent: true })
    .split("\n")
    .filter(Boolean);
  assertReleaseMutationPaths(paths);
  const committedTree = git(["show", "-s", "--format=%T", "HEAD"], { silent: true });
  if (committedTree !== expectedTree) {
    throw new Error("Release commit tree changed after the validated index was staged");
  }
}

function stageReleaseChanges(expectedPaths) {
  const paths = changedPaths();
  if (paths.length === 0) {
    throw new Error("Release did not generate any files to commit");
  }
  assertReleaseMutationPaths(paths);
  if (expectedPaths) {
    const expected = [...expectedPaths].sort();
    if (JSON.stringify(paths) !== JSON.stringify(expected)) {
      throw new Error(`Next-cycle commit must change exactly: ${expected.join(", ")}`);
    }
  }
  run("git", ["add", "--", ...paths]);
  return git(["write-tree"], { silent: true });
}

function updateChangelogsForRelease(version, releaseDate) {
  for (const path of getChangelogPaths(process.cwd())) {
    const content = readFileSync(path, "utf8");
    if (!content.startsWith(changelogHeader)) {
      throw new Error(`${path}: missing canonical [Unreleased] header`);
    }
    writeFileSync(
      path,
      content.replace(changelogHeader, `# Changelog\n\n## [${version}] - ${releaseDate}\n\n`),
    );
    console.log(`  Updated ${path}`);
  }
}

function addUnreleasedSections() {
  for (const path of getChangelogPaths(process.cwd())) {
    const content = readFileSync(path, "utf8");
    writeFileSync(path, content.replace(/^(# Changelog\n\n)/, `$1## [Unreleased]\n\n`));
    console.log(`  Added [Unreleased] to ${path}`);
  }
}

function assertTagAvailable(version) {
  const tagPath = join(".git", "refs", "tags", `v${version}`);
  if (existsSync(tagPath)) {
    throw new Error(`Tag v${version} already exists`);
  }
  try {
    execFileSync("git", ["rev-parse", "--verify", `refs/tags/v${version}`], { stdio: "ignore" });
    throw new Error(`Tag v${version} already exists`);
  } catch (error) {
    if (error instanceof Error && error.message === `Tag v${version} already exists`) {
      throw error;
    }
  }
}

function verifyRemoteRelease(version) {
  const output = git(
    ["ls-remote", "--refs", "origin", "refs/heads/main", `refs/tags/v${version}`],
    { silent: true },
  );
  const refs = new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/\s+/, 2).reverse()),
  );
  const expectedMain = git(["rev-parse", "HEAD"], { silent: true });
  const expectedTag = git(["rev-parse", `refs/tags/v${version}`], { silent: true });
  if (refs.get("refs/heads/main") !== expectedMain || refs.get(`refs/tags/v${version}`) !== expectedTag) {
    throw new Error("Remote main and release tag do not match the completed local transaction");
  }
}

let authorizationToken;
let targetVersion;
let releaseDate;

try {
  console.log("\n=== Certified Release ===\n");
  run("git", ["fetch", "origin", "main", "--tags"]);
  const priorState = readReleaseAuditState(process.cwd());
  if (priorState && !["certified", "evidence_ready", "stale", "aborted", "released"].includes(priorState.state)) {
    const recoveredState = reconcileReleaseState(process.cwd());
    if (recoveredState?.state === "released") {
      console.log(`Release v${recoveredState.targetVersion} was already published; transaction reconciled.`);
      process.exit(0);
    }
    if (recoveredState?.state === "aborted") {
      console.log("Aborted the incomplete local transaction because remote refs were unchanged.");
    }
  }
  assertCleanWorktree();
  targetVersion = resolveTargetVersion();
  releaseDate = new Date().toISOString().slice(0, 10);
  assertTagAvailable(targetVersion);

  console.log(`Auditing changelogs for origin/main -> ${targetVersion}...`);
  const certificate = certifyReleaseAudit(process.cwd(), targetVersion);
  const authorization = beginRelease(process.cwd(), targetVersion);
  authorizationToken = authorization.token;
  console.log(`  Certificate: ${certificate.certificateId}\n`);

  run(process.execPath, ["scripts/version-bump.js", targetVersion], {
    env: { ...process.env, P_RELEASE_AUDIT_TOKEN: authorizationToken },
  });
  if (getVersion() !== targetVersion) {
    throw new Error(`Version bump did not produce ${targetVersion}`);
  }

  console.log("Updating changelogs...");
  const appliedFragments = applyReleaseFragments(process.cwd());
  console.log(`  Applied ${appliedFragments.length} release-note fragment(s)`);
  updateChangelogsForRelease(targetVersion, releaseDate);
  console.log("Regenerating deterministic release artifacts...");
  run("npm", ["run", "shrinkwrap:coding-agent"]);
  writeReleaseReceipt(process.cwd(), targetVersion, authorizationToken, releaseDate);
  assertReleaseMutationPaths(changedPaths());
  advanceReleaseState(process.cwd(), targetVersion, authorizationToken, "version_bumped", "artifacts_ready");

  console.log("Running checks...");
  run("npm", ["run", "check"]);
  assertReleaseMutationPaths(changedPaths());
  advanceReleaseState(process.cwd(), targetVersion, authorizationToken, "artifacts_ready", "checks_passed");

  console.log("Committing and tagging release...");
  const releaseTree = stageReleaseChanges();
  run("git", ["commit", "-m", `Release v${targetVersion}`]);
  assertReleaseCommit(releaseTree);
  recordReleaseCommit(process.cwd(), targetVersion, authorizationToken, "checks_passed", "release_committed");
  assertCleanWorktree();
  run("git", ["tag", `v${targetVersion}`]);
  advanceReleaseState(process.cwd(), targetVersion, authorizationToken, "release_committed", "tagged");

  console.log("Adding [Unreleased] sections for the next cycle...");
  addUnreleasedSections();
  const nextCycleTree = stageReleaseChanges(getChangelogPaths(process.cwd()));
  run("git", ["commit", "-m", "Add [Unreleased] section for next cycle"]);
  assertReleaseCommit(nextCycleTree);
  recordReleaseCommit(process.cwd(), targetVersion, authorizationToken, "tagged", "next_cycle_committed");
  assertCleanWorktree();

  console.log("Atomically pushing main and tag...");
  run("git", ["push", "--atomic", "origin", "HEAD:main", `refs/tags/v${targetVersion}`]);
  verifyRemoteRelease(targetVersion);
  advanceReleaseState(process.cwd(), targetVersion, authorizationToken, "next_cycle_committed", "released");
  console.log(`\nPrepared release v${targetVersion}; CI publishing started from the tag.`);
} catch (error) {
  if (authorizationToken) {
    failRelease(process.cwd(), authorizationToken, error);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
