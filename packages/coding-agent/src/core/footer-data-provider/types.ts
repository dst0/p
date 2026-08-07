import type { FooterDataProvider } from "./footerdataprovider.ts";

export type GitPaths = {
  repoDir: string;
  commonGitDir: string;
  headPath: string;
};

export type PrefillProgress = {
  percent: number;
  elapsedMs: number;
  tokensPerSecond?: number;
};

export type GenerationProgress = {
  tokensPerSecond: number;
  tokens: number;
};

export type QueuedProgress = {
  position: number;
  queuedAhead: number;
  queue: string;
  workerId?: string;
  ticketId?: string;
  source: "llm-orchestrator";
  queuedAt?: number;
  queuedForMs?: number;
};

export type SendingProgress = {
  model: string;
};

export type ModelSwitchProgress = {
  fromModel: string;
  toModel: string;
};

export type LoadingProgress = {
  model: string;
};

export type ReadonlyFooterDataProvider = Pick<
  FooterDataProvider,
  | "getGitBranch"
  | "getExtensionStatuses"
  | "getAvailableProviderCount"
  | "getPrefillProgress"
  | "getGenProgress"
  | "getQueuedProgress"
  | "getSendingProgress"
  | "getModelSwitchProgress"
  | "getLoadingProgress"
  | "getIndexingStatus"
  | "onBranchChange"
  | "onProgressChange"
>;
