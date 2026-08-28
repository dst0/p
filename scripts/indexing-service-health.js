import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { matchesConfiguredEmbeddingBackend } from "../packages/code-index/dist/index.js";
import { computeIndexingRuntimeConfigFingerprint } from "../packages/coding-agent/dist/core/indexing-runtime-config.js";

const DEFAULT_BACKEND_STARTUP_TIMEOUT_MS = 5 * 60_000;
const READY_TIMEOUT_MARGIN_MS = 60_000;
const POLL_MS = 500;

export function computeIndexingServiceReadyTimeoutMs(config) {
  const qdrantTimeoutMs = positiveTimeout(config?.qdrantStartupTimeoutMs, DEFAULT_BACKEND_STARTUP_TIMEOUT_MS);
  const embeddingTimeoutMs =
    config?.searchMode === "bm25-only"
      ? 0
      : positiveTimeout(config?.embeddingStartupTimeoutMs, DEFAULT_BACKEND_STARTUP_TIMEOUT_MS);
  return qdrantTimeoutMs + embeddingTimeoutMs + READY_TIMEOUT_MARGIN_MS;
}

function positiveTimeout(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function isIndexingServiceReady({ configuredDevice, denseEmbeddings, expectedFingerprint, health, status }) {
  if (!status?.running || !Number.isSafeInteger(status.pid) || status.pid <= 0) return false;
  if (!isProcessRunning(status.pid)) return false;
  if (!expectedFingerprint || status.runtimeConfigFingerprint !== expectedFingerprint) return false;
  if (!denseEmbeddings) return true;
  const embeddingRequired = Array.isArray(status.repos) && status.repos.some(repositoryNeedsEmbedding);
  if (!health) return !embeddingRequired;
  if (health.status !== "ready" || health.fallbackOccurred === true) return false;
  return matchesConfiguredEmbeddingBackend(configuredDevice, health);
}

function repositoryNeedsEmbedding(repository) {
  if (!repository || typeof repository !== "object") return false;
  if (["queued", "initializing", "updating"].includes(repository.state)) return true;
  return repository.state === "error" && /embedding server|embedding backend/i.test(String(repository.lastError ?? ""));
}

export async function waitForIndexingServiceReady(agentDir, timeoutMs) {
  const config = readJson(path.join(agentDir, "code-rag.json"));
  const configuredDevice = typeof config?.embeddingDevice === "string" ? config.embeddingDevice : undefined;
  const denseEmbeddings = config?.searchMode !== "bm25-only";
  const expectedFingerprint = computeIndexingRuntimeConfigFingerprint(agentDir);
  const deadline = Date.now() + (timeoutMs ?? computeIndexingServiceReadyTimeoutMs(config));
  while (Date.now() < deadline) {
    const status = readJson(path.join(agentDir, "indexing-service-status.json"));
    const health = denseEmbeddings ? await readEmbeddingHealth() : undefined;
    if (isIndexingServiceReady({ configuredDevice, denseEmbeddings, expectedFingerprint, health, status })) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("Timed out waiting for the installed indexing daemon and its configured embedding backend");
}

export async function readEmbeddingHealth() {
  try {
    const response = await fetch("http://127.0.0.1:18742/health", { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

export function readJson(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const agentDir = process.argv[2];
  if (!agentDir) throw new Error("Usage: indexing-service-health.js <agent-directory>");
  await waitForIndexingServiceReady(agentDir);
}
