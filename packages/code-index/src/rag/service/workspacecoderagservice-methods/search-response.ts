import { randomBytes } from "node:crypto";
import path from "node:path";
import type { IndexUpdateSummary, RagErrorCode, RagErrorInfo, SemanticSearchResponse } from "../../types.ts";
import type { RefreshPlan } from "../types.ts";
import type { WorkspaceCodeRagService } from "../workspacecoderagservice.ts";

export function do_emptySearchResponse(
  self: WorkspaceCodeRagService,
  query: string,
  startedAt: number,
): SemanticSearchResponse {
  return {
    query,
    workspaceRoot: self.workspaceRoot,
    status: self.snapshotStatus(),
    results: [],
    diagnostics: {
      durationMs: Date.now() - startedAt,
      indexGeneration: self.manifest?.generation,
      staleReason: self.staleReason,
      truncated: false,
    },
  };
}

export function do_emptyUpdateSummary(self: WorkspaceCodeRagService, fullRebuild: boolean): IndexUpdateSummary {
  return {
    status: self.snapshotStatus(),
    durationMs: 0,
    filesScanned: 0,
    filesAdded: 0,
    filesChanged: 0,
    filesDeleted: 0,
    filesUnchanged: 0,
    chunksEmbedded: 0,
    fullRebuild,
  };
}

export function do_summaryForPlan(
  self: WorkspaceCodeRagService,
  plan: RefreshPlan,
  startedAt: number,
  chunksEmbedded: number,
  fullRebuild: boolean,
): IndexUpdateSummary {
  return {
    status: self.snapshotStatus(),
    durationMs: Date.now() - startedAt,
    filesScanned: plan.added.length + plan.changed.length + plan.unchanged.length,
    filesAdded: plan.added.length,
    filesChanged: plan.changed.length,
    filesDeleted: plan.deleted.length,
    filesUnchanged: plan.unchanged.length,
    chunksEmbedded,
    fullRebuild,
  };
}

export function do_errorInfo(self: WorkspaceCodeRagService, code: RagErrorCode, message: string): RagErrorInfo {
  return { code, message: message.slice(0, 500), at: self.now().toISOString() };
}

export function do_createGeneration(self: WorkspaceCodeRagService): string {
  return `${self.now().getTime().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function do_collectionName(self: WorkspaceCodeRagService, generation: string): string {
  const prefix = self.settings.collectionPrefix.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  return `${prefix}_${self.repoId.slice(0, 16)}_${generation.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function do_vocabularyPath(self: WorkspaceCodeRagService, generation: string): string {
  return path.join(self.repositoryDirectory, `bm25-${generation}.json`);
}

export function do_startBackgroundRefresh(self: WorkspaceCodeRagService): void {
  if (!self.settings.autoRefresh || self.refreshPromise) return;
  void self.refresh().catch(() => undefined);
}
