import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import { validateReleaseBenchmarkArtifact } from "./release-benchmark-artifact-validation.js";

const CANONICAL_AGENTS = ["p", "pi", "kilo"];
const CANONICAL_TASKS = [
  "typescript-calculator",
  "monolith-split",
  "event-sourced-inventory",
  "durable-workflow-saga",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertCanonicalArray(actual, expected, label) {
  if (!Array.isArray(actual) || stableJson(actual) !== stableJson(expected)) {
    throw new Error(`Benchmark certification ${label} must be ${expected.join(", ")}`);
  }
}

function readPublicationArtifact(path, label, maxBytes) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error(`Benchmark certification requires an absolute ${label} artifact path`);
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > maxBytes) {
    throw new Error(`Benchmark certification ${label} artifact is not a bounded regular file`);
  }
  return readFileSync(path);
}

export function validateBenchmarkArtifactBuffers(evidence, artifacts) {
  const result = artifacts?.result;
  const report = artifacts?.report;
  if (!Buffer.isBuffer(result) || !Buffer.isBuffer(report)) {
    throw new Error("Benchmark certification artifact buffers are missing");
  }
  if (result.length < 1 || result.length > 100 * 1024 * 1024) {
    throw new Error("Benchmark certification result artifact is not bounded");
  }
  if (report.length < 1 || report.length > 10 * 1024 * 1024) {
    throw new Error("Benchmark certification report artifact is not bounded");
  }
  if (sha256(result) !== evidence.resultSha256 || sha256(report) !== evidence.reportSha256) {
    throw new Error("Benchmark certification artifact hashes do not match the supplied evidence");
  }
  if (!report.toString("utf8").includes("**Result: PASSED**")) {
    throw new Error("Benchmark certification report artifact is not passing");
  }
  let document;
  try {
    document = JSON.parse(result.toString("utf8"));
  } catch (error) {
    throw new Error("Benchmark certification result artifact is not valid JSON", { cause: error });
  }
  if (document?.certification?.passed !== true || document.certification.failures?.length !== 0) {
    throw new Error("Benchmark certification result artifact is not passing");
  }
  validateReleaseBenchmarkArtifact(document, evidence);
  assertCanonicalArray(document.agents, CANONICAL_AGENTS, "artifact agents");
  assertCanonicalArray(document.tasks?.map((task) => task?.id), CANONICAL_TASKS, "artifact tasks");
  if (document.runs !== 3 || document.results?.length !== 36) {
    throw new Error("Benchmark certification result artifact requires exactly 3 runs and 36 cells");
  }
  const expectedCells = new Set();
  for (let run = 1; run <= 3; run += 1) {
    for (const agent of CANONICAL_AGENTS) {
      for (const task of CANONICAL_TASKS) expectedCells.add(`${run}:${agent}:${task}`);
    }
  }
  for (const row of document.results) {
    const key = `${row?.run}:${row?.agent}:${row?.task}`;
    if (!expectedCells.delete(key)) {
      throw new Error(`Benchmark certification result artifact has invalid cell ${key}`);
    }
  }
  if (expectedCells.size !== 0) {
    throw new Error("Benchmark certification result artifact is missing canonical cells");
  }
  return { result, report };
}

export function readAndValidateBenchmarkArtifactPaths(evidence, artifacts) {
  const actualKeys = artifacts && typeof artifacts === "object" ? Object.keys(artifacts).sort() : [];
  if (stableJson(actualKeys) !== stableJson(["reportPath", "resultPath"])) {
    throw new Error("Benchmark certification artifact paths has an unexpected field set");
  }
  return validateBenchmarkArtifactBuffers(evidence, {
    result: readPublicationArtifact(artifacts.resultPath, "result", 100 * 1024 * 1024),
    report: readPublicationArtifact(artifacts.reportPath, "report", 10 * 1024 * 1024),
  });
}
