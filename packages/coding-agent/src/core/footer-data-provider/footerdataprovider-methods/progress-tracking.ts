import type { IndexStatus } from "../../indexing-service.ts";
import type { FooterDataProvider } from "../footerdataprovider.ts";
import type {
  GenerationProgress,
  LoadingProgress,
  ModelSwitchProgress,
  PrefillProgress,
  QueuedProgress,
  SendingProgress,
} from "../types.ts";

export function do_getGitBranch(self: FooterDataProvider): string | null {
  if (self.cachedBranch === undefined) {
    self.cachedBranch = self.resolveGitBranchSync();
  }
  return self.cachedBranch;
}

export function do_getExtensionStatuses(self: FooterDataProvider): ReadonlyMap<string, string> {
  return self.extensionStatuses;
}

export function do_getPrefillProgress(self: FooterDataProvider): PrefillProgress | undefined {
  return self.prefillProgress;
}

export function do_getGenProgress(self: FooterDataProvider): GenerationProgress | undefined {
  return self.genProgress;
}

export function do_getQueuedProgress(self: FooterDataProvider): QueuedProgress | undefined {
  return self.queuedProgress;
}

export function do_getSendingProgress(self: FooterDataProvider): SendingProgress | undefined {
  return self.sendingProgress;
}

export function do_getModelSwitchProgress(self: FooterDataProvider): ModelSwitchProgress | undefined {
  return self.modelSwitchProgress;
}

export function do_getLoadingProgress(self: FooterDataProvider): LoadingProgress | undefined {
  return self.loadingProgress;
}

export function do_getIndexingStatus(self: FooterDataProvider): IndexStatus {
  return self.indexingStatus;
}

export function do_onBranchChange(self: FooterDataProvider, callback: () => void): () => void {
  self.branchChangeCallbacks.add(callback);
  return () => self.branchChangeCallbacks.delete(callback);
}

export function do_onProgressChange(self: FooterDataProvider, callback: () => void): () => void {
  self.progressChangeCallbacks.add(callback);
  return () => self.progressChangeCallbacks.delete(callback);
}

export function do_setExtensionStatus(self: FooterDataProvider, key: string, text: string | undefined): void {
  if (text === undefined) {
    self.extensionStatuses.delete(key);
  } else {
    self.extensionStatuses.set(key, text);
  }
}

export function do_setPrefillProgress(self: FooterDataProvider, progress: PrefillProgress | undefined): void {
  self.prefillProgress = progress;
  if (progress) {
    self.genProgress = undefined;
    self.queuedProgress = undefined;
    self.sendingProgress = undefined;
    self.modelSwitchProgress = undefined;
    self.loadingProgress = undefined;
  }
  self.notifyProgressChange();
}

export function do_setGenProgress(self: FooterDataProvider, progress: GenerationProgress | undefined): void {
  self.genProgress = progress;
  if (progress) {
    self.prefillProgress = undefined;
    self.queuedProgress = undefined;
    self.sendingProgress = undefined;
    self.modelSwitchProgress = undefined;
    self.loadingProgress = undefined;
  }
  self.notifyProgressChange();
}

export function do_setQueuedProgress(self: FooterDataProvider, progress: QueuedProgress | undefined): void {
  if (progress) {
    // Ignore legacy/local message-queue payloads at runtime as well as at
    // the type boundary. QUEUED is an execution phase reported by the
    // orchestrator, while unsent steering/follow-up messages have their own UI.
    if (progress.source !== "llm-orchestrator") {
      return;
    }
    const sameTicket = progress.ticketId
      ? progress.ticketId === self.queuedProgress?.ticketId
      : self.queuedProgress?.ticketId === undefined && progress.queue === self.queuedProgress?.queue;
    self.queuedStartAt =
      progress.queuedAt ??
      (sameTicket ? self.queuedProgress?.queuedAt : undefined) ??
      Date.now() - Math.max(0, progress.queuedForMs ?? 0);
    self.queuedProgress = { ...progress, queuedAt: self.queuedStartAt };
  } else {
    self.queuedStartAt = undefined;
    self.queuedProgress = undefined;
  }
  if (self.queuedProgress) {
    self.prefillProgress = undefined;
    self.genProgress = undefined;
    self.sendingProgress = undefined;
    self.modelSwitchProgress = undefined;
    self.loadingProgress = undefined;
  }
  self.notifyProgressChange();
}

export function do_setSendingProgress(self: FooterDataProvider, progress: SendingProgress | undefined): void {
  self.sendingProgress = progress;
  if (progress) {
    self.prefillProgress = undefined;
    self.genProgress = undefined;
    self.queuedProgress = undefined;
    self.modelSwitchProgress = undefined;
    self.loadingProgress = undefined;
  }
  self.notifyProgressChange();
}

export function do_setModelSwitchProgress(self: FooterDataProvider, progress: ModelSwitchProgress | undefined): void {
  self.modelSwitchProgress = progress;
  if (progress) {
    self.prefillProgress = undefined;
    self.genProgress = undefined;
    self.queuedProgress = undefined;
    self.sendingProgress = undefined;
  }
  self.notifyProgressChange();
}

export function do_setLoadingProgress(self: FooterDataProvider, progress: LoadingProgress | undefined): void {
  self.loadingProgress = progress;
  if (progress) {
    self.prefillProgress = undefined;
    self.genProgress = undefined;
    self.queuedProgress = undefined;
    self.sendingProgress = undefined;
  }
  self.notifyProgressChange();
}

export function do_clearProgress(self: FooterDataProvider, options?: { preserveQueued?: boolean }): void {
  self.prefillProgress = undefined;
  self.genProgress = undefined;
  self.sendingProgress = undefined;
  self.modelSwitchProgress = undefined;
  self.loadingProgress = undefined;
  if (!options?.preserveQueued) {
    self.queuedProgress = undefined;
    self.queuedStartAt = undefined;
  }
  self.notifyProgressChange();
}

export function do_clearExtensionStatuses(self: FooterDataProvider): void {
  self.extensionStatuses.clear();
}

export function do_notifyProgressChange(self: FooterDataProvider): void {
  for (const cb of self.progressChangeCallbacks) cb();
}

export function do_getAvailableProviderCount(self: FooterDataProvider): number {
  return self.availableProviderCount;
}
