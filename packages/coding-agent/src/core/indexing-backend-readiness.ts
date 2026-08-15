import { matchesConfiguredEmbeddingBackend } from "@dst0/p-code-index";
import { getAgentDir } from "../config.ts";
import { requestIndexingBackendForRepo } from "./indexed-repos.ts";
import { readIndexingSelectionConfiguration } from "./indexing-config-reader.ts";

const DEFAULT_STARTUP_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_MS = 250;

export interface IndexingBackendReadinessOptions {
  agentDir?: string;
  fetchImplementation?: typeof fetch;
  pollMs?: number;
  timeoutMs?: number;
}

export async function waitForIndexingEmbeddingBackend(
  cwd: string,
  signal?: AbortSignal,
  options: IndexingBackendReadinessOptions = {},
): Promise<void> {
  const agentDir = options.agentDir ?? getAgentDir();
  const configuration = readIndexingSelectionConfiguration(agentDir);
  if (configuration.searchMode === "bm25-only") return;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  if (await probeEmbeddingBackend(configuration.device, fetchImplementation, signal)) return;
  if (!requestIndexingBackendForRepo(cwd, agentDir)) {
    throw new Error("Code indexing is not enabled for this repository");
  }

  const timeoutMs = options.timeoutMs ?? configuration.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason ?? new Error("Embedding backend readiness wait was cancelled");
    if (await probeEmbeddingBackend(configuration.device, fetchImplementation, signal)) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error("Timed out waiting for the indexing daemon to resume its embedding backend");
}

async function probeEmbeddingBackend(
  configuredDevice: string | undefined,
  fetchImplementation: typeof fetch,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const timeoutSignal = AbortSignal.timeout(2_000);
    const response = await fetchImplementation("http://127.0.0.1:18742/health", {
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
    if (!response.ok) return false;
    const health = (await response.json()) as {
      status?: unknown;
      requestedBackend?: unknown;
      selectedBackend?: unknown;
      fallbackOccurred?: unknown;
    };
    if (health.status !== "ready") return false;
    if (!matchesConfiguredEmbeddingBackend(configuredDevice, health)) {
      throw new Error(`Configured embedding backend ${configuredDevice} did not resume on the requested device`);
    }
    return true;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error instanceof Error && error.message.startsWith("Configured embedding backend")) throw error;
    return false;
  }
}
