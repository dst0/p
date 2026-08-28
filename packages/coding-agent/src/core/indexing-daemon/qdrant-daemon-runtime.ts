import {
  DEFAULT_QDRANT_STARTUP_TIMEOUT_MS,
  DEFAULT_WORKSPACE_CODE_RAG_SETTINGS,
  normalizeQdrantCollectionPrefix,
  QdrantCollectionAdmin,
  QdrantServerManager,
  resolveQdrantEndpoint,
} from "@dst0/p-code-index";
import {
  createQdrantCollectionGarbageCollector,
  hasPersistedQdrantCollections,
} from "./qdrant-collection-garbage-collector.ts";
import type { IndexingDaemonOptions, QdrantGarbageCollector } from "./types.ts";

interface CreateQdrantDaemonRuntimeOptions {
  daemonOptions: IndexingDaemonOptions;
  canDeleteCollections: () => boolean;
  onLog: (level: "debug" | "error", message: string) => void;
}

export interface QdrantDaemonRuntime {
  collectionPrefix: string;
  endpointUrl: string;
  garbageCollector: QdrantGarbageCollector;
  collectGarbageOnStart: boolean;
  startMaintenance(signal?: AbortSignal): Promise<void>;
  stopProcess(): Promise<void>;
}

export function createQdrantDaemonRuntime(options: CreateQdrantDaemonRuntimeOptions): QdrantDaemonRuntime {
  const daemonOptions = options.daemonOptions;
  const endpoint = resolveQdrantEndpoint(
    daemonOptions.qdrantUrl ?? DEFAULT_WORKSPACE_CODE_RAG_SETTINGS.qdrantUrl,
    true,
  );
  const collectionPrefix = normalizeQdrantCollectionPrefix(
    daemonOptions.collectionPrefix ?? DEFAULT_WORKSPACE_CODE_RAG_SETTINGS.collectionPrefix,
  );
  const manager =
    endpoint.kind === "managed-local"
      ? new QdrantServerManager(endpoint.port, {
          qdrantBinary: daemonOptions.qdrantBinary,
          dataDirectory: daemonOptions.qdrantDataDirectory,
          startupTimeoutMs: daemonOptions.qdrantStartupTimeoutMs ?? DEFAULT_QDRANT_STARTUP_TIMEOUT_MS,
          apiKey: daemonOptions.qdrantApiKey,
          onLog: options.onLog,
        })
      : undefined;
  const remoteAdmin = manager
    ? undefined
    : new QdrantCollectionAdmin({
        url: endpoint.url,
        timeoutMs: DEFAULT_WORKSPACE_CODE_RAG_SETTINGS.searchTimeoutMs,
        apiKey: daemonOptions.qdrantApiKey,
      });
  const garbageCollector =
    daemonOptions.qdrantGarbageCollector ??
    (manager
      ? createQdrantCollectionGarbageCollector({
          agentDir: daemonOptions.agentDir,
          collectionPrefix,
          qdrantUrl: endpoint.url,
          getApiKey: () => manager.getApiKey(),
          isOwnedStorage: () => manager.isOwnedServerHealthy(),
          canDeleteCollections: options.canDeleteCollections,
          onLog: options.onLog,
        })
      : { start: async () => {}, stop: async () => {} });

  return {
    collectionPrefix,
    endpointUrl: endpoint.url,
    garbageCollector,
    collectGarbageOnStart: manager !== undefined && hasPersistedQdrantCollections(daemonOptions.qdrantDataDirectory),
    async startMaintenance(signal) {
      if (!manager) {
        await remoteAdmin?.listCollections();
        return;
      }
      const started = await manager.ensureStarted(signal);
      if (!started && !(await manager.isOwnedServerHealthy())) {
        options.onLog("debug", "Skipping Qdrant collection GC because local storage ownership is unproven");
        return;
      }
      void garbageCollector.start().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        options.onLog("error", `Qdrant collection GC failed to start: ${message}`);
      });
    },
    async stopProcess() {
      await manager?.stop();
    },
  };
}
