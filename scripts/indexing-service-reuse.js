#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isIndexingServiceReady, readEmbeddingHealth, readJson } from "./indexing-service-health.js";

export function canReuseIndexingService({
  configuredDevice,
  denseEmbeddings,
  health,
  newIndexingVersion,
  newRuntimeConfigFingerprint,
  status,
}) {
  if (!newIndexingVersion || status?.indexingVersion !== newIndexingVersion) return false;
  return isIndexingServiceReady({
    configuredDevice,
    denseEmbeddings,
    expectedFingerprint: newRuntimeConfigFingerprint,
    health,
    status,
  });
}

export async function inspectIndexingServiceReuse(agentDir, newIndexingVersion, newRuntimeConfigFingerprint) {
  const status = readJson(path.join(agentDir, "indexing-service-status.json"));
  const config = readJson(path.join(agentDir, "code-rag.json"));
  const denseEmbeddings = config?.searchMode !== "bm25-only";
  const health = denseEmbeddings ? await readEmbeddingHealth() : undefined;
  return canReuseIndexingService({
    configuredDevice: typeof config?.embeddingDevice === "string" ? config.embeddingDevice : undefined,
    denseEmbeddings,
    health,
    newIndexingVersion,
    newRuntimeConfigFingerprint,
    status,
  });
}

async function runCli() {
  const [newIndexingVersion, newRuntimeConfigFingerprint] = process.argv.slice(2);
  const agentDir = process.env.P_CODING_AGENT_DIR ?? path.join(os.homedir(), ".p", "agent");
  const reusable = await inspectIndexingServiceReuse(agentDir, newIndexingVersion, newRuntimeConfigFingerprint);
  process.stdout.write(reusable ? "reuse" : "restart");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
