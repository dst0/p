import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

import {
  computeReleaseCertificateId,
  computeReleaseEvidenceHash,
  stableJson,
} from "./release-audit-certificate.js";
import { hashReleaseInputEntries, releaseInputPathsAtRevision } from "./release-inputs.js";
import { assertReleaseOnOriginMain } from "./release-origin-policy.js";
import { assertReleaseTargetVersion } from "./release-target-policy.js";
import {
  computeExpectedReleaseMutation,
  computeReleaseAuditEvidenceAtRevision,
} from "./release-output-verifier.js";

const RECEIPT_SCHEMA_VERSION = 2;

function git(repoRoot, args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return null;
    }
    throw error;
  }
}

function gitBuffer(repoRoot, revision, path) {
  const args = ["show", `${revision}:${path}`];
  return execFileSync("git", args, { cwd: repoRoot });
}

function isValidTagName(tagName) {
  return /^v\d+\.\d+\.\d+$/.test(tagName);
}

function sortValues(values) {
  return [...values].sort();
}

function compareSets(left, right) {
  return JSON.stringify(sortValues(left)) === JSON.stringify(sortValues(right));
}

function pathExists(repoRoot, revision, path) {
  return git(repoRoot, ["cat-file", "-e", `${revision}:${path}`], { allowFailure: true }) !== null;
}

function readReleaseInputHashAtRevision(repoRoot, baseSha) {
  const paths = releaseInputPathsAtRevision(repoRoot, baseSha);
  return hashReleaseInputEntries(
    paths.map((path) => ({ path, content: gitBuffer(repoRoot, baseSha, path) })),
  );
}

function readReceiptAtTag(repoRoot, tagName) {
  const path = `release-certificates/${tagName}.json.br`;
  const raw = gitBuffer(repoRoot, tagName, path);
  if (!raw.length) {
    throw new Error(`Release certificate is missing or unreadable at ${path}`);
  }
  const decompressed = brotliDecompressSync(raw).toString("utf8");
  return JSON.parse(decompressed);
}

export function persistReleaseReceipt(repoRoot, state, releaseDate) {
  const path = `release-certificates/v${state.targetVersion}.json.br`;
  const payload = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    certificateId: state.certificateId,
    schemaName: "release-certificate",
    baseSha: state.baseSha,
    originMainSha: state.originMainSha,
    targetVersion: state.targetVersion,
    inputPaths: state.inputPaths,
    inputHash: state.inputHash,
    evidenceHash: state.evidenceHash,
    evidence: state.evidence,
    allowMajor: state.allowMajor,
    releaseDate,
  };
  const payloadJson = `${stableJson(payload)}\n`;
  const compressed = brotliCompressSync(Buffer.from(payloadJson), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
  });
  const absolutePath = `${repoRoot}/${path}`;
  mkdirSync(`${repoRoot}/release-certificates`, { recursive: true });
  writeFileSync(absolutePath, compressed, { mode: 0o600 });
  return payload;
}

function validateReceiptState(receipt, expectedVersion) {
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new Error(`Unsupported release certificate schema: ${receipt.schemaVersion}`);
  }
  if (receipt.targetVersion !== expectedVersion) {
    throw new Error(`Receipt target ${receipt.targetVersion} does not match release tag ${expectedVersion}`);
  }
  if (!receipt.baseSha || !receipt.originMainSha || !receipt.evidenceHash || !receipt.inputHash) {
    throw new Error("Receipt is missing required audit fields");
  }
  if (!receipt.releaseDate) {
    throw new Error("Receipt is missing the deterministic release date");
  }
  if (typeof receipt.allowMajor !== "boolean") {
    throw new Error("Receipt is missing its major-release authorization state");
  }
  if (computeReleaseCertificateId(receipt) !== receipt.certificateId) {
    throw new Error("Receipt certificate id is invalid");
  }
  if (computeReleaseEvidenceHash(receipt.evidence) !== receipt.evidenceHash) {
    throw new Error("Receipt evidence hash is invalid");
  }
}

function isDateUtc(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function receiptTag(tagName) {
  return tagName.slice(1);
}

function mutationMismatch(changedPath) {
  if (changedPath === "package-lock.json") {
    throw new Error(`${changedPath} does not match the deterministic version mutation`);
  }
  if (changedPath === "packages/coding-agent/npm-shrinkwrap.json") {
    throw new Error("coding-agent shrinkwrap does not match deterministic regeneration");
  }
  if (changedPath === "package.json") {
    throw new Error("package.json has non-version mutation outside deterministic release versioning");
  }
  if (/^packages\/[^/]+\/package\.json$/.test(changedPath)) {
    throw new Error(`${changedPath} has non-version mutation beyond deterministic version mutation`);
  }
  if (/packages\/[^/]+\/CHANGELOG\.md$/.test(changedPath)) {
    throw new Error("released content does not match the certified changelog preview");
  }
  if (/packages\/ai\/src\/(?:image-)?models\.generated\.ts$/.test(changedPath)) {
    throw new Error(`Generated model source drifted from deterministic base: ${changedPath}`);
  }
  throw new Error(`release commit paths do not exactly match certified outputs`);
}

function verifyTagParent(repoRoot, tagSha, baseSha) {
  const parents = git(repoRoot, ["show", "-s", "--format=%P", tagSha]).split(" ").filter(Boolean);
  if (parents.length !== 1 || parents[0] !== baseSha) {
    throw new Error("Release tag is not a direct child of the certified base commit");
  }
}

export function verifyReleaseReceipt(repoRoot, tagName) {
  if (!isValidTagName(tagName)) {
    throw new Error("Release tag must match vX.Y.Z");
  }
  const targetVersion = receiptTag(tagName);
  const tagRef = `refs/tags/${tagName}`;
  const tagSha = git(repoRoot, ["rev-parse", "--verify", tagRef]);
  if (!tagSha || git(repoRoot, ["cat-file", "-t", tagRef]) !== "commit") {
    throw new Error(`Release tag ${tagName} must be lightweight and point directly to a commit`);
  }
  const receipt = readReceiptAtTag(repoRoot, tagName);
  validateReceiptState(receipt, targetVersion);
  if (!isDateUtc(receipt.releaseDate)) {
    throw new Error("Receipt releaseDate must be a UTC date");
  }
  if (receipt.originMainSha !== receipt.baseSha) {
    throw new Error("Receipt origin/main SHA does not match its certified base SHA");
  }
  verifyTagParent(repoRoot, tagSha, receipt.baseSha);
  const canonicalInputPaths = releaseInputPathsAtRevision(repoRoot, receipt.baseSha);
  if (!compareSets(receipt.inputPaths, canonicalInputPaths)) {
    throw new Error("Receipt input paths do not match the canonical base scope");
  }
  const computedInputHash = readReleaseInputHashAtRevision(repoRoot, receipt.baseSha);
  if (computedInputHash !== receipt.inputHash) {
    throw new Error("Receipt input hash changed after certificate audit");
  }
  const expectedEvidence = computeReleaseAuditEvidenceAtRevision(
    repoRoot,
    receipt.baseSha,
    targetVersion,
  );
  if (computeReleaseEvidenceHash(expectedEvidence) !== receipt.evidenceHash) {
    throw new Error("Receipt evidence does not match a deterministic audit");
  }
  if (stableJson(expectedEvidence) !== stableJson(receipt.evidence)) {
    throw new Error("Receipt evidence does not match a deterministic audit");
  }

  const baseVersion = JSON.parse(gitBuffer(repoRoot, receipt.baseSha, "package.json")).version;
  if (!baseVersion) {
    throw new Error("Certified base package version is missing");
  }
  assertReleaseTargetVersion(baseVersion, targetVersion, { allowMajor: receipt.allowMajor });
  assertReleaseOnOriginMain(repoRoot, tagSha);

  const expectedMutation = computeExpectedReleaseMutation(repoRoot, receipt.baseSha, targetVersion, receipt.releaseDate);
  for (const deletedPath of expectedMutation.deletedPaths) {
    if (pathExists(repoRoot, tagName, deletedPath)) {
      throw new Error("release-note fragments must be absent from the release tag");
    }
  }
  const receiptPath = `release-certificates/${tagName}.json.br`;
  const expectedCommitPaths = [
    ...expectedMutation.expectedPaths,
    ...expectedMutation.deletedPaths,
    receiptPath,
  ];
  const changedPaths = git(repoRoot, [
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    `${tagSha}^`,
    tagSha,
  ])
    .split("\n")
    .filter(Boolean);
  if (!compareSets(expectedCommitPaths, changedPaths)) {
    throw new Error("release commit paths do not exactly match certified outputs");
  }
  for (const [path, expectedContent] of expectedMutation.changedContents) {
    const tagContent = gitBuffer(repoRoot, tagName, path);
    if (!tagContent.equals(expectedContent)) {
      mutationMismatch(path);
    }
  }
  for (const [path, expectedContent] of expectedMutation.unchangedContents) {
    if (!pathExists(repoRoot, tagName, path) || !gitBuffer(repoRoot, tagName, path).equals(expectedContent)) {
      throw new Error("release commit paths do not exactly match certified outputs");
    }
  }
  return { receipt };
}
