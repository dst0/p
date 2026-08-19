import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { brotliCompressSync, createBrotliDecompress } from "node:zlib";

const repoRoot = resolve(import.meta.dirname, "..");
const resultsRoot = join(repoRoot, "benchmarks", "results");
const restoredRecordingRuns = new Map([
  ["2026-07-19-long-tasks-mini-pc-model", 4],
  ["2026-07-19-mini-pc-model", 6],
  ["2026-07-19-monolith-split-mini-pc-model", 2],
  ["2026-07-29-pi-p-kilo-sokann-qwen-27b-restart", 6],
]);

function trackedEvidencePaths() {
  return execFileSync(
    "git",
    ["ls-files", "-z", "benchmarks/results"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
}

function evidenceJsonFiles(trackedPaths) {
  return trackedPaths
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
  if (reference.includes("/") || basename(file) === "state.json") {
    return join(dirname(file), reference);
  }
  const startupIndex = context.indexOf("startupProbes");
  if (startupIndex === -1) return join(dirname(file), reference);
  const agent = context[startupIndex + 1];
  return join(dirname(file), "diagnostics", `${agent}-startup`, reference);
}

function hasValidBrotliIndexBlob(cwd, path) {
  return new Promise(resolveValidation => {
    const git = spawn("git", ["show", `:${path}`], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const decompressor = createBrotliDecompress();
    let compressedBytes = 0;
    let decoderDone = false;
    let decoderValid = false;
    let gitDone = false;
    let gitValid = false;
    let settled = false;
    const finish = () => {
      if (settled || !decoderDone || !gitDone) return;
      settled = true;
      resolveValidation(compressedBytes > 0 && decoderValid && gitValid);
    };
    git.stdout.on("data", chunk => {
      compressedBytes += chunk.length;
    });
    git.once("error", () => {
      gitValid = false;
    });
    git.once("close", code => {
      gitDone = true;
      gitValid = code === 0;
      finish();
    });
    decompressor.on("data", () => {});
    decompressor.once("error", () => {
      decoderDone = true;
      git.stdout.unpipe(decompressor);
      git.stdout.resume();
      finish();
    });
    decompressor.once("end", () => {
      decoderDone = true;
      decoderValid = true;
      finish();
    });
    git.stdout.pipe(decompressor);
  });
}

test("Brotli recording references resolve to individual archives", async () => {
  const trackedPaths = trackedEvidencePaths();
  const trackedFiles = new Map(trackedPaths.map(path => [join(repoRoot, path), path]));
  const evidenceFiles = evidenceJsonFiles(trackedPaths);
  assert.notEqual(evidenceFiles.length, 0, "tracked benchmark evidence scan was empty");
  const archiveValidation = new Map();
  const missing = [];
  for (const file of evidenceFiles) {
    const document = JSON.parse(readFileSync(file, "utf8"));
    for (const { reference, context } of recordingReferences(document)) {
      const archive = resolveRecording(file, reference, context);
      const trackedPath = trackedFiles.get(archive);
      if (!reference.endsWith(".br")) continue;
      if (!trackedPath || !existsSync(archive)) {
        missing.push(`${file}: ${reference}`);
        continue;
      }
      let validation = archiveValidation.get(trackedPath);
      if (!validation) {
        validation = hasValidBrotliIndexBlob(repoRoot, trackedPath);
        archiveValidation.set(trackedPath, validation);
      }
      if (!(await validation)) missing.push(`${file}: ${reference}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("rejects intent-to-add and corrupt Brotli index blobs", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-archive-reference-"));
  const path = "recording.jsonl.br";
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, path), brotliCompressSync(Buffer.from("evidence\n")));
    execFileSync("git", ["add", "-N", "--", path], { cwd: root });
    assert.equal(await hasValidBrotliIndexBlob(root, path), false);

    execFileSync("git", ["add", "--", path], { cwd: root });
    assert.equal(await hasValidBrotliIndexBlob(root, path), true);

    writeFileSync(join(root, path), "not Brotli");
    execFileSync("git", ["add", "--", path], { cwd: root });
    assert.equal(await hasValidBrotliIndexBlob(root, path), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
