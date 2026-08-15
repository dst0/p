#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EmbeddingProviderHttp } from "../../dist/embed/http.js";
import { WorkspaceCodeRagService } from "../../dist/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "../..");
const model = "Qwen/Qwen3-Embedding-0.6B";
const embeddingPort = 18743;
const qdrantPort = 6335;
const options = parseArguments(process.argv.slice(2));
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-mps-precision-"));
const repository = path.join(temporaryDirectory, "repository");
const pythonExecutable =
  process.env.P_INDEX_BENCHMARK_PYTHON ??
  path.join(os.homedir(), ".p", "agent", "indexing-service", "venv", "bin", "python3");
const qdrantBinary =
  process.env.P_INDEX_BENCHMARK_QDRANT ??
  path.join(os.homedir(), ".p", "agent", "indexing-service", "bin", "qdrant");

try {
  await assertExclusiveMps();
  assertExecutable(pythonExecutable, "Python embedding runtime");
  assertExecutable(qdrantBinary, "Qdrant");
  generateRepository(repository, options.files, options.functionsPerFile);
  const results = [];
  for (const precision of ["float32", "bfloat16"]) {
    results.push(await runVariant(precision));
    await delay(2_000);
  }
  const fp32 = results[0];
  const bf16 = results[1];
  const report = {
    fixture: { files: options.files, functionsPerFile: options.functionsPerFile },
    results,
    comparison: {
      indexingSpeedup: round(bf16.indexingChunksPerSecond / fp32.indexingChunksPerSecond),
      endToEndSpeedup: round(fp32.rebuildSeconds / bf16.rebuildSeconds),
      modelMemoryReduction: round(1 - bf16.modelBytes / fp32.modelBytes),
    },
  };
  console.table(
    results.map((result) => ({
      precision: result.precision,
      chunks: result.chunks,
      "index chunks/s": result.indexingChunksPerSecond,
      "rebuild seconds": result.rebuildSeconds,
      "startup seconds": result.startupSeconds,
      "peak RSS MiB": result.peakRssMiB,
    })),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (options.keep) console.error(`Benchmark workspace retained at ${temporaryDirectory}`);
  else fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function runVariant(precision) {
  const configPath = path.join(temporaryDirectory, `code-rag-${precision}.json`);
  const dataDirectory = path.join(temporaryDirectory, `data-${precision}`);
  const qdrantDataDirectory = path.join(temporaryDirectory, `qdrant-${precision}`);
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({
      embeddingDevice: "mps",
      maxEmbeddingBatchSize: 1,
      maxSequenceLength: 512,
      mpsPrecision: precision,
    })}\n`,
  );
  const server = startEmbeddingServer(configPath);
  let service;
  let peakRssKiB = 0;
  const sampler = setInterval(() => {
    peakRssKiB = Math.max(peakRssKiB, readRssKiB(server.child.pid));
  }, 250);
  try {
    const startupStarted = performance.now();
    const startupHealth = await waitForHealth(server);
    const startupSeconds = secondsSince(startupStarted);
    assertMpsHealth(startupHealth, precision);
    const embeddingProvider = new EmbeddingProviderHttp(
      `http://127.0.0.1:${embeddingPort}`,
      1024,
      false,
      model,
      { requestTimeoutMs: 10 * 60_000, maxRetries: 0, batchSize: 64 },
    );
    service = new WorkspaceCodeRagService({
      workspaceRoot: repository,
      dataDirectory,
      userConfigPath: configPath,
      embeddingProvider,
      settings: {
        enabled: true,
        autoRefresh: false,
        qdrantUrl: `http://127.0.0.1:${qdrantPort}`,
        qdrantBinary,
        qdrantDataDirectory,
        collectionPrefix: `p_mps_precision_${precision}`,
      },
    });
    let indexingStarted;
    let indexingFinished;
    const rebuildStarted = performance.now();
    const rebuilt = await service.rebuild({
      onProgress: (progress) => {
        if (progress.phase === "indexing" && indexingStarted === undefined) indexingStarted = performance.now();
        if (progress.phase === "finalizing" && indexingFinished === undefined) indexingFinished = performance.now();
      },
    });
    const rebuildFinished = performance.now();
    const search = await service.search({
      query: "normalize a module payload and compute its deterministic checksum",
      limit: 5,
      freshness: "allow_stale",
    });
    if (rebuilt.status.state !== "ready" || rebuilt.status.indexedChunks < 1) {
      throw new Error(`${precision} rebuild did not produce a ready index`);
    }
    if (search.results.length === 0) throw new Error(`${precision} semantic-search validation returned no results`);
    const health = await fetchHealth();
    assertMpsHealth(health, precision);
    const indexingSeconds = ((indexingFinished ?? rebuildFinished) - (indexingStarted ?? rebuildStarted)) / 1_000;
    return {
      precision,
      files: rebuilt.status.indexedFiles,
      chunks: rebuilt.status.indexedChunks,
      startupSeconds,
      rebuildSeconds: round((rebuildFinished - rebuildStarted) / 1_000),
      indexingSeconds: round(indexingSeconds),
      indexingChunksPerSecond: round(rebuilt.status.indexedChunks / indexingSeconds),
      peakRssMiB: round(peakRssKiB / 1024),
      modelBytes: health.resource_plan.model_bytes,
      executionDevice: health.executionDevice,
      fallbackOccurred: health.fallbackOccurred,
      oomBackoffs: health.runtime.oom_backoffs,
      searchResults: search.results.length,
    };
  } finally {
    clearInterval(sampler);
    if (service) await service.dispose();
    await stopChild(server.child);
  }
}

function startEmbeddingServer(configPath) {
  const logs = [];
  const child = spawn(
    pythonExecutable,
    [path.join(packageDirectory, "embedding_server.py"), "--port", String(embeddingPort), "--model", model, "--config", configPath],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (data) => {
      logs.push(data.toString());
      if (logs.length > 100) logs.shift();
    });
  }
  return { child, logs };
}

async function waitForHealth(server) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) throw new Error(`Embedding server exited:\n${server.logs.join("")}`);
    try {
      const health = await fetchHealth();
      if (health.status === "ready") return health;
    } catch {
      // Model startup is still in progress.
    }
    await delay(500);
  }
  throw new Error(`Embedding server startup timed out:\n${server.logs.join("")}`);
}

async function fetchHealth(port = embeddingPort) {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`Embedding health returned HTTP ${response.status}`);
  return response.json();
}

function assertMpsHealth(health, precision) {
  if (health.selectedBackend !== "mps" || !String(health.executionDevice).startsWith("mps")) {
    throw new Error(`${precision} did not execute on MPS: ${JSON.stringify(health)}`);
  }
  if (health.resource_plan?.dtype !== precision) throw new Error(`Expected ${precision}, got ${health.resource_plan?.dtype}`);
  if (health.fallbackOccurred) throw new Error(`${precision} fell back: ${health.fallbackReason}`);
  if (health.runtime?.oom_backoffs !== 0) throw new Error(`${precision} reported an OOM backoff`);
}

async function assertExclusiveMps() {
  try {
    const health = await fetchHealth(18742);
    if (health.status === "ready") {
      throw new Error("The installed indexing daemon is using MPS. Stop it before running this exclusive benchmark.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("exclusive benchmark")) throw error;
  }
}

function generateRepository(directory, fileCount, functionsPerFile) {
  fs.mkdirSync(directory, { recursive: true });
  execFileSync("git", ["init", "--quiet", directory]);
  for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
    const lines = [`export const moduleId = ${fileIndex};`, ""];
    for (let functionIndex = 0; functionIndex < functionsPerFile; functionIndex += 1) {
      const salt = (fileIndex + 1) * 10_000 + functionIndex * 97;
      lines.push(
        `export function normalizeModule${fileIndex}Stage${functionIndex}(payload) {`,
        `  const values = payload.values.map((value, index) => (value + ${salt} + index) % 65521);`,
        "  const checksum = values.reduce((total, value) => (total * 33 + value) % 2147483647, 5381);",
        `  return { module: ${fileIndex}, stage: ${functionIndex}, checksum, values };`,
        "}",
        "",
      );
    }
    fs.writeFileSync(path.join(directory, `module-${String(fileIndex).padStart(3, "0")}.js`), `${lines.join("\n")}\n`);
  }
}

function parseArguments(arguments_) {
  const value = { files: 16, functionsPerFile: 12, keep: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] === "--keep") value.keep = true;
    else if (arguments_[index] === "--files") value.files = positiveInteger(arguments_[++index], "--files");
    else if (arguments_[index] === "--functions-per-file") {
      value.functionsPerFile = positiveInteger(arguments_[++index], "--functions-per-file");
    } else throw new Error(`Unknown argument: ${arguments_[index]}`);
  }
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function assertExecutable(filename, label) {
  if (!fs.existsSync(filename)) throw new Error(`${label} was not found at ${filename}`);
}

function readRssKiB(pid) {
  try {
    return Number.parseInt(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function secondsSince(started) {
  return round((performance.now() - started) / 1_000);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
