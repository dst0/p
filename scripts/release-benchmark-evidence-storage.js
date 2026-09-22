import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

import { validateBenchmarkArtifactBuffers } from "./release-benchmark-artifacts.js";

const MAX_RESULT_BYTES = 100 * 1024 * 1024;
const MAX_REPORT_BYTES = 10 * 1024 * 1024;

function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function gitBuffer(repoRoot, revision, path) {
  return execFileSync("git", ["show", `${revision}:${path}`], { cwd: repoRoot });
}

function commonGitDirectory(repoRoot) {
  const gitDirectory = git(repoRoot, ["rev-parse", "--git-common-dir"]);
  return isAbsolute(gitDirectory) ? gitDirectory : resolve(repoRoot, gitDirectory);
}

function stateEvidencePaths(repoRoot, certificationId) {
  const prefix = resolve(commonGitDirectory(repoRoot), `p-release-benchmark-${certificationId}`);
  return { resultPath: `${prefix}-results.json.br`, reportPath: `${prefix}-report.md.br` };
}

export function releaseBenchmarkEvidencePaths(targetVersion) {
  return {
    resultPath: `release-certificates/v${targetVersion}-benchmark-results.json.br`,
    reportPath: `release-certificates/v${targetVersion}-benchmark-report.md.br`,
  };
}

function compress(value) {
  return brotliCompressSync(value, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } });
}

function decompress(value, maxOutputLength, label) {
  try {
    return brotliDecompressSync(value, { maxOutputLength });
  } catch (error) {
    throw new Error(`Benchmark certification ${label} evidence is not valid bounded Brotli`, { cause: error });
  }
}

function atomicWrite(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temporaryPath, value, { mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function persistBenchmarkEvidenceState(repoRoot, receipt, artifacts) {
  const paths = stateEvidencePaths(repoRoot, receipt.certificationId);
  atomicWrite(paths.resultPath, compress(artifacts.result));
  atomicWrite(paths.reportPath, compress(artifacts.report));
  return paths;
}

export function readBenchmarkEvidenceState(repoRoot, receipt) {
  const paths = stateEvidencePaths(repoRoot, receipt.certificationId);
  if (!existsSync(paths.resultPath) || !existsSync(paths.reportPath)) {
    throw new Error("Benchmark certification durable evidence is missing");
  }
  return validateBenchmarkArtifactBuffers(receipt, {
    result: decompress(readFileSync(paths.resultPath), MAX_RESULT_BYTES, "result"),
    report: decompress(readFileSync(paths.reportPath), MAX_REPORT_BYTES, "report"),
  });
}

export function persistReleaseBenchmarkEvidence(repoRoot, receipt) {
  const artifacts = readBenchmarkEvidenceState(repoRoot, receipt);
  const paths = releaseBenchmarkEvidencePaths(receipt.targetVersion);
  atomicWrite(resolve(repoRoot, paths.resultPath), compress(artifacts.result));
  atomicWrite(resolve(repoRoot, paths.reportPath), compress(artifacts.report));
  return paths;
}

export function verifyReleaseBenchmarkEvidence(repoRoot, tagName, receipt) {
  const paths = releaseBenchmarkEvidencePaths(receipt.targetVersion);
  return validateBenchmarkArtifactBuffers(receipt, {
    result: decompress(gitBuffer(repoRoot, tagName, paths.resultPath), MAX_RESULT_BYTES, "result"),
    report: decompress(gitBuffer(repoRoot, tagName, paths.reportPath), MAX_REPORT_BYTES, "report"),
  });
}
