import type { Model } from "@dst0/p-ai";
import { QUEUED_FOOTER_ANIMATION_MS } from "../../components/footer.ts";
import { theme } from "../../theme/theme.ts";
import { RECENT_MODEL_SWITCH_MS } from "../constants.ts";
import { isExpandable } from "../helpers.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_handleFollowUp(self: InteractiveMode): Promise<void> {
  const text = (self.editor.getExpandedText?.() ?? self.editor.getText()).trim();
  if (!text) return;

  // Queue input during compaction (extension commands execute immediately)
  if (self.session.isCompacting) {
    if (self.isExtensionCommand(text)) {
      self.editor.addToHistory?.(text);
      self.editor.setText("");
      await self.session.prompt(text);
    } else {
      self.queueCompactionMessage(text, "followUp");
    }
    return;
  }

  // Alt+Enter queues a follow-up message (waits until agent finishes)
  // This handles extension commands (execute immediately), prompt template expansion, and queueing
  if (self.session.isStreaming) {
    self.editor.addToHistory?.(text);
    self.editor.setText("");
    await self.session.prompt(text, { streamingBehavior: "followUp" });
    self.updatePendingMessagesDisplay();
    self.ui.requestRender();
  }
  // If not streaming, Alt+Enter acts like regular Enter (trigger onSubmit)
  else if (self.editor.onSubmit) {
    self.editor.setText("");
    self.editor.onSubmit(text);
  }
}

export function do_handleDequeue(self: InteractiveMode): void {
  const restored = self.restoreQueuedMessagesToEditor();
  if (restored === 0) {
    self.showStatus("No queued messages to restore");
  } else {
    self.showStatus(`Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`);
  }
}

export function do_updateEditorBorderColor(self: InteractiveMode): void {
  if (self.isBashMode) {
    self.editor.borderColor = theme.getBashModeBorderColor();
  } else {
    const level = self.session.thinkingLevel || "off";
    self.editor.borderColor = theme.getThinkingBorderColor(level);
  }
  self.ui.requestRender();
}

export function do_cycleThinkingLevel(self: InteractiveMode): void {
  const newLevel = self.session.cycleThinkingLevel();
  if (newLevel === undefined) {
    self.showStatus("Current model does not support thinking");
  } else {
    self.footer.invalidate();
    self.updateEditorBorderColor();
    self.showStatus(`Thinking level: ${newLevel}`);
  }
}

export async function do_cycleModel(self: InteractiveMode, direction: "forward" | "backward"): Promise<void> {
  try {
    const previousModel = self.session.model;
    const result = await self.session.cycleModel(direction);
    if (result === undefined) {
      const msg = self.session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available";
      self.showStatus(msg);
    } else {
      self.noteModelSwitch(previousModel, result.model);
      self.footer.invalidate();
      self.updateEditorBorderColor();
      const thinkingStr =
        result.model.reasoning && result.thinkingLevel !== "off" ? ` (thinking: ${result.thinkingLevel})` : "";
      self.showStatus(`Switched to ${result.model.name || result.model.id}${thinkingStr}`);
      void self.maybeWarnAboutAnthropicSubscriptionAuth(result.model);
    }
  } catch (error) {
    self.showError(error instanceof Error ? error.message : String(error));
  }
}

export function do_toggleToolOutputExpansion(self: InteractiveMode): void {
  self.setToolsExpanded(!self.toolOutputExpanded);
}

export function do_setToolsExpanded(self: InteractiveMode, expanded: boolean): void {
  self.toolOutputExpanded = expanded;
  const activeHeader = self.customHeader ?? self.builtInHeader;
  if (isExpandable(activeHeader)) {
    activeHeader.setExpanded(expanded);
  }
  for (const child of self.chatContainer.children) {
    if (isExpandable(child)) {
      child.setExpanded(expanded);
    }
  }
  self.ui.requestRender();
}

export function do_getModelStatusLabel(_self: InteractiveMode, model: Model<any>): string {
  return `${model.provider}/${model.id}`;
}

export function do_noteModelSwitch(
  self: InteractiveMode,
  previousModel: Model<any> | undefined,
  nextModel: Model<any>,
): void {
  if (previousModel && previousModel.provider === nextModel.provider && previousModel.id === nextModel.id) {
    return;
  }
  const switchProgress = {
    fromModel: previousModel ? self.getModelStatusLabel(previousModel) : "",
    toModel: self.getModelStatusLabel(nextModel),
    timestamp: Date.now(),
  };
  self.lastModelSwitch = switchProgress;
  self.footerDataProvider.setModelSwitchProgress({
    fromModel: switchProgress.fromModel,
    toModel: switchProgress.toModel,
  });
}

export function do_getRecentModelSwitch(self: InteractiveMode): { fromModel: string; toModel: string } | undefined {
  if (!self.lastModelSwitch) {
    return undefined;
  }
  if (Date.now() - self.lastModelSwitch.timestamp > RECENT_MODEL_SWITCH_MS) {
    self.lastModelSwitch = undefined;
    return undefined;
  }
  return {
    fromModel: self.lastModelSwitch.fromModel,
    toModel: self.lastModelSwitch.toModel,
  };
}

export function do_clearLlmOrchestratorQueueProgress(self: InteractiveMode): void {
  if (self.footerDataProvider.getQueuedProgress()?.source === "llm-orchestrator") {
    self.footerDataProvider.setQueuedProgress(undefined);
  }
}

export function do_updateQueuedFooterSpinnerTimer(self: InteractiveMode): void {
  const shouldAnimate = self.footerDataProvider.getQueuedProgress() !== undefined;
  if (shouldAnimate && !self.queuedFooterSpinnerTimer) {
    self.queuedFooterSpinnerTimer = setInterval(() => {
      if (self.footerDataProvider.getQueuedProgress() === undefined) {
        self.updateQueuedFooterSpinnerTimer();
        return;
      }
      self.ui.requestRender();
    }, QUEUED_FOOTER_ANIMATION_MS);
    return;
  }
  if (!shouldAnimate && self.queuedFooterSpinnerTimer) {
    clearInterval(self.queuedFooterSpinnerTimer);
    self.queuedFooterSpinnerTimer = undefined;
  }
}
