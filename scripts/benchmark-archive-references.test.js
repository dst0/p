import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const resultsRoot = join(repoRoot, "benchmarks", "results");
const restoredRecordingRuns = new Map([
  ["2026-07-19-long-tasks-mini-pc-model", 4],
  ["2026-07-19-mini-pc-model", 6],
  ["2026-07-19-monolith-split-mini-pc-model", 2],
  ["2026-07-29-pi-p-kilo-sokann-qwen-27b-restart", 6],
]);

function evidenceJsonFiles() {
  return execFileSync(
    "git",
    ["ls-files", "-z", "benchmarks/results"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(path => path.endsWith("/results.json") || path.endsWith("/state.json"))
    .map(path => join(repoRoot, path));
}

function recordingReferences(value, context = [], references = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => recordingReferences(entry, [...context, index], references));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "recording" && typeof entry === "string") references.push({ reference: entry, context });
      else recordingReferences(entry, [...context, key], references);
    }
  }
  return references;
}

function resolveRecording(file, reference, context) {
  if (reference.includes("/") || file.endsWith("/state.json")) {
    return join(dirname(file), reference);
  }
  const startupIndex = context.indexOf("startupProbes");
  if (startupIndex === -1) return join(dirname(file), reference);
  const agent = context[startupIndex + 1];
  return join(dirname(file), "diagnostics", `${agent}-startup`, reference);
}

test("Brotli recording references resolve to individual archives", () => {
  const missing = [];
  for (const file of evidenceJsonFiles()) {
    const document = JSON.parse(readFileSync(file, "utf8"));
    for (const { reference, context } of recordingReferences(document)) {
      if (reference.endsWith(".br") && !existsSync(resolveRecording(file, reference, context))) {
        missing.push(`${file}: ${reference}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("all 18 restored recording references use unique Brotli archives", () => {
  let total = 0;
  for (const [run, expected] of restoredRecordingRuns) {
    const resultFile = join(resultsRoot, run, "results.json");
    const document = JSON.parse(readFileSync(resultFile, "utf8"));
    const references = recordingReferences(document)
      .map(({ reference }) => reference)
      .filter(reference => reference.startsWith("recordings/"));
    assert.equal(references.length, expected, run);
    assert.equal(new Set(references).size, expected, `${run} contains duplicate recording references`);
    for (const reference of references) {
      assert.match(reference, /\.jsonl\.br$/u, `${run} retained a legacy recording extension`);
      assert.equal(existsSync(join(resultsRoot, run, reference)), true, `${run}: ${reference}`);
    }
    total += references.length;
  }
  assert.equal(total, 18);
});
