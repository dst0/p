import fs from "node:fs";
import path from "node:path";
import type { BM25Vocabulary } from "../../bm25.ts";
import { getGitInfo } from "../../discover.ts";
import { EmbeddingProviderHttp } from "../../embed/http.ts";
import type { EmbeddingProvider } from "../../embed/provider.ts";
import { QdrantServerManager } from "../../embed/qdrant-server.ts";
import { type DelegatedMethods, installDelegatedMethods } from "../../utils/install-delegated-methods.ts";
import { DEFAULT_WORKSPACE_CODE_RAG_SETTINGS, loadWorkspaceCodeRagSettings } from "../config.ts";
import type { FilePreparationPlan } from "../file-preparation.ts";
import { resolveQdrantEndpoint } from "../qdrant-endpoint.ts";
import type {
  CodeRagService,
  IndexManifest,
  IndexUpdateSummary,
  RagErrorInfo,
  RagState,
  RagVectorStore,
  WorkspaceCodeRagServiceOptions,
  WorkspaceCodeRagSettings,
} from "../types.ts";
import { QdrantVectorStore } from "../vector-store.ts";
import { hashText } from "./helpers.ts";
import * as filePreparationDelegates from "./workspacecoderagservice-methods/file-preparation.ts";
import * as incrementalRefreshDelegates from "./workspacecoderagservice-methods/incremental-refresh.ts";
import * as lifecycleDelegates from "./workspacecoderagservice-methods/lifecycle.ts";
import * as rebuildDelegates from "./workspacecoderagservice-methods/rebuild.ts";
import * as refreshDelegates from "./workspacecoderagservice-methods/refresh.ts";
import * as searchResponseDelegates from "./workspacecoderagservice-methods/search-response.ts";
import * as sparseRefreshDelegates from "./workspacecoderagservice-methods/sparse-refresh.ts";
import * as stateManagementDelegates from "./workspacecoderagservice-methods/state-management.ts";

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The installer below synchronously defines every delegated method.
export class WorkspaceCodeRagService implements CodeRagService {
  public workspaceRoot: string;

  public repoId: string;

  public repositoryDirectory: string;

  public manifestPath: string;

  public settings: WorkspaceCodeRagSettings;

  public embeddingProvider: EmbeddingProvider;

  public vectorStore: RagVectorStore;

  public qdrantServerManager: QdrantServerManager | null;

  public ownsEmbeddingProvider: boolean;

  public ownsVectorStore: boolean;

  public allowSearchRefresh: boolean;

  public now: () => Date;

  public manifest: IndexManifest | undefined;

  public payloadIndexMaintenance: { collection: string; promise: Promise<void> } | undefined;

  public state: RagState = "not_initialized";

  public staleReason: string | undefined;

  public lastError: RagErrorInfo | undefined;

  public configurationError: Error | undefined;

  public initialized = false;

  public disposed = false;

  public refreshPromise: Promise<IndexUpdateSummary> | undefined;

  public refreshController: AbortController | undefined;

  public cachedVocabulary: BM25Vocabulary | undefined;

  public cachedVocabularyGeneration: string | undefined;

  public lastPreparationPlan: FilePreparationPlan | undefined;

  public serviceOptions: WorkspaceCodeRagServiceOptions;

  constructor(options: WorkspaceCodeRagServiceOptions) {
    this.serviceOptions = options;
    this.workspaceRoot = fs.realpathSync(options.workspaceRoot);
    const workspaceStat = fs.statSync(this.workspaceRoot);
    if (!workspaceStat.isDirectory()) throw new Error(`Code RAG workspace is not a directory: ${this.workspaceRoot}`);
    const gitInfo = getGitInfo(this.workspaceRoot);
    this.repoId = hashText(`${this.workspaceRoot}\0${gitInfo.remote}`);
    this.repositoryDirectory = path.join(options.dataDirectory, this.repoId);
    this.manifestPath = path.join(this.repositoryDirectory, "manifest.json");
    this.now = options.now ?? (() => new Date());
    const manageLocalBackends = options.manageLocalBackends ?? true;
    this.allowSearchRefresh = options.allowSearchRefresh ?? true;

    try {
      this.settings = loadWorkspaceCodeRagSettings(options);
    } catch (error) {
      this.settings = { ...DEFAULT_WORKSPACE_CODE_RAG_SETTINGS, enabled: false };
      this.configurationError = error instanceof Error ? error : new Error(String(error));
      this.state = "unavailable";
      this.lastError = this.errorInfo("RAG_BACKEND_UNAVAILABLE", this.configurationError.message);
    }

    this.ownsEmbeddingProvider = options.embeddingProvider === undefined;
    this.embeddingProvider =
      options.embeddingProvider ??
      new EmbeddingProviderHttp(
        this.settings.embeddingServerUrl,
        this.settings.embeddingDimensions,
        manageLocalBackends,
        this.settings.embeddingModel,
        {
          pythonExecutable: this.settings.pythonExecutable,
          configPath: options.userConfigPath,
          startupTimeoutMs: this.settings.embeddingStartupTimeoutMs,
          requestTimeoutMs: this.settings.embeddingTimeoutMs,
          batchSize: this.settings.encodeBatchSize,
        },
      );
    this.ownsVectorStore = options.vectorStore === undefined;
    const qdrantEndpoint = resolveQdrantEndpoint(this.settings.qdrantUrl, this.settings.remoteBackendsAllowed);
    const managesLocalQdrant = manageLocalBackends && this.ownsVectorStore && qdrantEndpoint.kind === "managed-local";
    this.qdrantServerManager = managesLocalQdrant
      ? new QdrantServerManager(qdrantEndpoint.port, {
          qdrantBinary: this.settings.qdrantBinary,
          dataDirectory: this.settings.qdrantDataDirectory,
          startupTimeoutMs: this.settings.qdrantStartupTimeoutMs,
          apiKey: this.settings.qdrantApiKey,
        })
      : null;
    const qdrantApiKey = this.settings.qdrantApiKey ?? this.qdrantServerManager?.getApiKey();
    if (qdrantApiKey) this.settings.qdrantApiKey = qdrantApiKey;
    this.vectorStore =
      options.vectorStore ??
      new QdrantVectorStore({
        url: this.settings.qdrantUrl,
        apiKey: qdrantApiKey,
        timeoutMs: this.settings.searchTimeoutMs,
        upsertBatchSize: this.settings.upsertBatchSize,
      });
  }
}

type WorkspaceCodeRagServiceMethods = DelegatedMethods<
  WorkspaceCodeRagService,
  typeof filePreparationDelegates &
    typeof incrementalRefreshDelegates &
    typeof lifecycleDelegates &
    typeof rebuildDelegates &
    typeof refreshDelegates &
    typeof searchResponseDelegates &
    typeof sparseRefreshDelegates &
    typeof stateManagementDelegates
>;

export interface WorkspaceCodeRagService extends WorkspaceCodeRagServiceMethods {}

installDelegatedMethods(WorkspaceCodeRagService.prototype, [
  filePreparationDelegates,
  incrementalRefreshDelegates,
  lifecycleDelegates,
  rebuildDelegates,
  refreshDelegates,
  searchResponseDelegates,
  sparseRefreshDelegates,
  stateManagementDelegates,
]);
