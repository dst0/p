import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertCleanMain,
  assertReleaseCertificateAuthority,
  inspectReleaseCertificate,
  markReleaseCertificateStale,
  readReleaseAuditState,
  writeReleaseAuditState,
} from "./release-audit-certificate.js";
import { persistReleaseReceipt } from "./release-certificate-receipt.js";
import { computeReleaseInputHash } from "./release-inputs.js";
import { versionMutationPaths } from "./release-path-policy.js";

const WORKTREE_TRANSITIONS = new Map([
  ["version_bumped", "artifacts_ready"],
  ["artifacts_ready", "checks_passed"],
  ["release_committed", "tagged"],
  ["next_cycle_committed", "released"],
]);
const COMMIT_TRANSITIONS = new Map([
  ["checks_passed", "release_committed"],
  ["tagged", "next_cycle_committed"],
]);

function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function gitMaybe(repoRoot, args) {
  try {
    return git(repoRoot, args);
  } catch {
    return null;
  }
}

function isAncestor(repoRoot, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function currentVersion(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
}

function authorizationHash(token, state) {
  return sha256(`${token}\0${state.certificateId}\0${state.targetVersion}`);
}

function assertToken(state, token, targetVersion) {
  if (
    !token ||
    authorizationHash(token, state) !== state.tokenHash ||
    state.targetVersion !== targetVersion
  ) {
    throw new Error("Release audit authorization token or target does not match");
  }
}

function requireState(repoRoot, token, expectedState, targetVersion, options = {}) {
  const state = readReleaseAuditState(repoRoot);
  if (!state || state.state !== expectedState) {
    throw new Error(`Release audit authorization requires state ${expectedState}`);
  }
  assertReleaseCertificateAuthority(repoRoot, state);
  assertToken(state, token, targetVersion);
  if (!options.allowHeadChange && git(repoRoot, ["rev-parse", "HEAD"]) !== state.expectedHeadSha) {
    throw new Error("Release HEAD changed outside the certified transaction");
  }
  return state;
}

export function beginRelease(repoRoot, targetVersion) {
  const inspection = inspectReleaseCertificate(repoRoot, targetVersion);
  if (!inspection.valid) {
    markReleaseCertificateStale(repoRoot, inspection.reason);
    throw new Error(`Release audit is not certified: ${inspection.reason}`);
  }
  assertCleanMain(repoRoot);
  const token = randomBytes(32).toString("hex");
  const state = writeReleaseAuditState(repoRoot, {
    ...inspection.state,
    state: "release_in_progress",
    tokenHash: authorizationHash(token, inspection.state),
    expectedHeadSha: inspection.state.baseSha,
    startedAt: new Date().toISOString(),
  });
  return { state: state.state, token, certificateId: state.certificateId };
}

export function consumeVersionBumpAuthorization(repoRoot, targetVersion, token) {
  const state = requireState(repoRoot, token, "release_in_progress", targetVersion);
  assertCleanMain(repoRoot);
  if (computeReleaseInputHash(repoRoot) !== state.inputHash) {
    throw new Error("Release input hash changed before version bump authorization");
  }
  return writeReleaseAuditState(repoRoot, { ...state, state: "version_bump_in_progress" });
}

export function markVersionBumped(repoRoot, targetVersion, token) {
  const state = requireState(repoRoot, token, "version_bump_in_progress", targetVersion);
  if (currentVersion(repoRoot) !== targetVersion) {
    throw new Error(`Version bump did not produce ${targetVersion}`);
  }
  const changed = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  const allowedPaths = versionMutationPaths(repoRoot);
  const unexpected = changed.filter((path) => !allowedPaths.has(path));
  if (unexpected.length > 0) {
    throw new Error(`Version bump changed unexpected files: ${unexpected.join(", ")}`);
  }
  return writeReleaseAuditState(repoRoot, {
    ...state,
    state: "version_bumped",
    versionFiles: changed.sort(),
    postBumpInputHash: computeReleaseInputHash(repoRoot),
  });
}

export function writeReleaseReceipt(repoRoot, targetVersion, token, releaseDate) {
  const state = requireState(repoRoot, token, "version_bumped", targetVersion);
  return persistReleaseReceipt(repoRoot, state, releaseDate);
}

export function advanceReleaseState(repoRoot, targetVersion, token, fromState, toState) {
  if (WORKTREE_TRANSITIONS.get(fromState) !== toState) {
    throw new Error(`Invalid release state transition: ${fromState} -> ${toState}`);
  }
  const state = requireState(repoRoot, token, fromState, targetVersion);
  return writeReleaseAuditState(repoRoot, { ...state, state: toState, transitionedAt: new Date().toISOString() });
}

export function recordReleaseCommit(repoRoot, targetVersion, token, fromState, toState) {
  if (COMMIT_TRANSITIONS.get(fromState) !== toState) {
    throw new Error(`Invalid release commit transition: ${fromState} -> ${toState}`);
  }
  const state = requireState(repoRoot, token, fromState, targetVersion, { allowHeadChange: true });
  const currentHeadSha = git(repoRoot, ["rev-parse", "HEAD"]);
  const parents = git(repoRoot, ["show", "-s", "--format=%P", currentHeadSha]).split(" ").filter(Boolean);
  if (parents.length !== 1 || parents[0] !== state.expectedHeadSha) {
    throw new Error("Release commit is not a direct child of the certified transaction HEAD");
  }
  if (git(repoRoot, ["status", "--porcelain"])) {
    throw new Error("Controlled release commit left uncommitted changes");
  }
  return writeReleaseAuditState(repoRoot, {
    ...state,
    state: toState,
    expectedHeadSha: currentHeadSha,
    ...(toState === "release_committed" ? { releaseCommitSha: currentHeadSha } : {}),
    ...(toState === "next_cycle_committed" ? { nextCycleCommitSha: currentHeadSha } : {}),
    transitionedAt: new Date().toISOString(),
  });
}

function remoteReleaseRefs(repoRoot, targetVersion) {
  const output = git(repoRoot, [
    "ls-remote",
    "--refs",
    "origin",
    "refs/heads/main",
    `refs/tags/v${targetVersion}`,
  ]);
  return new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/\s+/, 2).reverse()),
  );
}

export function reconcileReleaseState(repoRoot) {
  const state = readReleaseAuditState(repoRoot);
  if (!state || ["certified", "evidence_ready", "stale", "aborted", "released"].includes(state.state)) {
    return state;
  }
  const refs = remoteReleaseRefs(repoRoot, state.targetVersion);
  const remoteMain = refs.get("refs/heads/main");
  const remoteTag = refs.get(`refs/tags/v${state.targetVersion}`);
  if (remoteTag) {
    if (remoteTag !== state.releaseCommitSha || !state.nextCycleCommitSha) {
      throw new Error("Remote release refs are partially published or do not match the persisted transaction");
    }
    execFileSync("git", ["fetch", "origin", "main"], { cwd: repoRoot, stdio: "ignore" });
    if (remoteMain !== state.nextCycleCommitSha && !isAncestor(repoRoot, state.nextCycleCommitSha, remoteMain)) {
      throw new Error("Remote main does not contain the persisted next-cycle release commit");
    }
    return writeReleaseAuditState(repoRoot, {
      ...state,
      state: "released",
      recoveredAt: new Date().toISOString(),
    });
  }
  if (state.releaseCommitSha && remoteMain && isAncestor(repoRoot, state.releaseCommitSha, remoteMain)) {
    throw new Error("Remote main contains a partial release commit without its target tag");
  }
  const tagName = `v${state.targetVersion}`;
  const localTag = gitMaybe(repoRoot, ["rev-parse", `refs/tags/${tagName}`]);
  if (localTag && localTag !== state.releaseCommitSha) {
    throw new Error(`Local tag ${tagName} does not match the persisted release commit`);
  }
  if (localTag) {
    execFileSync("git", ["tag", "--delete", tagName], { cwd: repoRoot, stdio: "ignore" });
  }
  return writeReleaseAuditState(repoRoot, {
    ...state,
    state: "aborted",
    abortedAt: new Date().toISOString(),
    abortReason:
      remoteMain === state.baseSha
        ? "Remote refs were unchanged; use a clean worktree to start a new certified release"
        : "Remote main advanced without this release; use a clean worktree to certify its new revision",
  });
}

export function failRelease(repoRoot, token, error) {
  const state = readReleaseAuditState(repoRoot);
  if (!state || !token) {
    return;
  }
  try {
    assertToken(state, token, state.targetVersion);
  } catch {
    return;
  }
  writeReleaseAuditState(repoRoot, {
    ...state,
    state: "failed",
    failedFromState: state.state,
    failure: String(error),
    failedAt: new Date().toISOString(),
  });
}
