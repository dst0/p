import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_WORKSPACE_CODE_RAG_SETTINGS,
  getQdrantCollectionCreatedAt,
  getRepositoryRefreshLockState,
  QdrantCollectionAdmin,
} from "@dst0/p-code-index";

export const QDRANT_COLLECTION_GC_INTERVAL_MS = 24 * 60 * 60_000;

export interface QdrantCollectionGcResult {
  deleted: number;
  failed: number;
  retained: number;
}

interface CollectObsoleteQdrantCollectionsOptions {
  dataDirectory: string;
  collectionPrefix: string;
  collectionAdmin: Pick<QdrantCollectionAdmin, "listCollections" | "deleteCollection">;
  canDeleteCollections?: () => boolean;
  now?: () => number;
}

interface CreateQdrantCollectionGarbageCollectorOptions {
  agentDir: string;
  collectionPrefix: string;
  qdrantUrl: string;
  getApiKey: () => string | undefined;
  isOwnedStorage: () => Promise<boolean>;
  canDeleteCollections: () => boolean;
  onLog: (level: "debug" | "error", message: string) => void;
}

interface CollectionProtectionSnapshot {
  collections: Set<string>;
  refreshInProgress: boolean;
}

export class QdrantCollectionGarbageCollector {
  private readonly collect: () => Promise<QdrantCollectionGcResult>;
  private readonly onLog?: (level: "debug" | "error", message: string) => void;
  private readonly isOwnedStorage?: () => Promise<boolean>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private runPromise: Promise<void> | undefined;
  private stopped = false;

  constructor(
    collect: () => Promise<QdrantCollectionGcResult>,
    onLog?: (level: "debug" | "error", message: string) => void,
    isOwnedStorage?: () => Promise<boolean>,
  ) {
    this.collect = collect;
    this.onLog = onLog;
    this.isOwnedStorage = isOwnedStorage;
  }

  async start(): Promise<void> {
    if (this.stopped || this.timer) return;
    if (this.runPromise) return this.runPromise;
    const operation = (async () => {
      if (this.isOwnedStorage && !(await this.isOwnedStorage())) {
        this.onLog?.("debug", "Skipping Qdrant collection GC because local storage ownership is unproven");
        return;
      }
      if (this.stopped) return;
      const result = await this.collect();
      this.onLog?.(
        "debug",
        `Qdrant collection GC deleted ${result.deleted}, retained ${result.retained}, failed ${result.failed}`,
      );
    })()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.onLog?.("error", `Qdrant collection GC failed: ${message}`);
      })
      .finally(() => {
        if (this.runPromise === operation) this.runPromise = undefined;
        this.schedule();
      });
    this.runPromise = operation;
    return operation;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.runPromise;
  }

  private schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.start();
    }, QDRANT_COLLECTION_GC_INTERVAL_MS);
  }
}

export function createQdrantCollectionGarbageCollector(
  options: CreateQdrantCollectionGarbageCollectorOptions,
): QdrantCollectionGarbageCollector {
  let collectionAdmin: QdrantCollectionAdmin | undefined;
  return new QdrantCollectionGarbageCollector(
    async () => {
      collectionAdmin ??= new QdrantCollectionAdmin({
        url: options.qdrantUrl,
        timeoutMs: DEFAULT_WORKSPACE_CODE_RAG_SETTINGS.searchTimeoutMs,
        apiKey: options.getApiKey(),
      });
      return collectObsoleteQdrantCollections({
        dataDirectory: path.join(options.agentDir, "code-rag"),
        collectionPrefix: options.collectionPrefix,
        collectionAdmin,
        canDeleteCollections: options.canDeleteCollections,
      });
    },
    options.onLog,
    options.isOwnedStorage,
  );
}

export async function collectObsoleteQdrantCollections(
  options: CollectObsoleteQdrantCollectionsOptions,
): Promise<QdrantCollectionGcResult> {
  const before = readCollectionProtectionSnapshot(options.dataDirectory);
  const collections = await options.collectionAdmin.listCollections();
  const after = readCollectionProtectionSnapshot(options.dataDirectory);
  const protectedCollections = new Set([...before.collections, ...after.collections]);
  const now = options.now?.() ?? Date.now();
  const result: QdrantCollectionGcResult = { deleted: 0, failed: 0, retained: 0 };
  const snapshotsAllowDeletion = !before.refreshInProgress && !after.refreshInProgress;
  for (const collection of collections) {
    if (protectedCollections.has(collection)) {
      result.retained += 1;
      continue;
    }
    const createdAt = getQdrantCollectionCreatedAt(collection, options.collectionPrefix);
    if (
      !snapshotsAllowDeletion ||
      !(options.canDeleteCollections?.() ?? true) ||
      createdAt === undefined ||
      now - createdAt < QDRANT_COLLECTION_GC_INTERVAL_MS
    ) {
      result.retained += 1;
      continue;
    }
    try {
      await options.collectionAdmin.deleteCollection(collection);
      result.deleted += 1;
    } catch {
      result.failed += 1;
      result.retained += 1;
    }
  }
  return result;
}

function readCollectionProtectionSnapshot(dataDirectory: string): CollectionProtectionSnapshot {
  const collections = new Set<string>();
  let refreshInProgress = false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dataDirectory, { withFileTypes: true });
  } catch (error) {
    throw new Error("Cannot safely enumerate persisted Qdrant collection references", { cause: error });
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repositoryDirectory = path.join(dataDirectory, entry.name);
    if (getRepositoryRefreshLockState(repositoryDirectory) === "active") refreshInProgress = true;
    for (const filename of ["manifest.json", "rebuild-checkpoint.json"]) {
      const collection = readCollectionReference(path.join(repositoryDirectory, filename));
      if (collection) collections.add(collection);
    }
  }
  return { collections, refreshInProgress };
}

function readCollectionReference(filePath: string): string | undefined {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error("Cannot safely read Qdrant collection reference", { cause: error });
  }
  try {
    const value = JSON.parse(contents) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Collection reference is not an object");
    }
    const collection = (value as { collection?: unknown }).collection;
    if (typeof collection !== "string" || collection.length === 0) throw new Error("Collection name is missing");
    return collection;
  } catch (error) {
    throw new Error("Cannot safely read Qdrant collection reference", { cause: error });
  }
}

export function hasPersistedQdrantCollections(qdrantDataDirectory: string): boolean {
  try {
    return fs
      .readdirSync(path.join(qdrantDataDirectory, "storage", "collections"), { withFileTypes: true })
      .some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}
