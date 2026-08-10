import type { InteractiveMode } from "../interactivemode.ts";

export async function do_handleCompactCommand(
  self: InteractiveMode,
  customInstructions?: string,
  options?: { dryRun?: boolean; audit?: boolean },
): Promise<void> {
  const entries = self.sessionManager.getEntries();
  const messageCount = entries.filter((e) => e.type === "message").length;

  if (messageCount < 2) {
    self.showWarning("Nothing to compact (no messages yet)");
    return;
  }

  if (self.loadingAnimation) {
    self.loadingAnimation.stop();
    self.loadingAnimation = undefined;
  }
  self.statusContainer.clear();

  try {
    if (options?.dryRun) {
      self.showStatus(self.formatCompactionDryRun(self.session.getCompactionDryRun()));
      return;
    }
    const result = await self.session.compact(customInstructions);
    if (options?.audit && result.details && typeof result.details === "object" && "audit" in result.details) {
      const audit = (
        result.details as {
          audit?: {
            beforeTokens: number;
            afterTokens: number;
            savedTokens: number;
          };
        }
      ).audit;
      if (audit) {
        self.showStatus(`Compaction audit: ${audit.beforeTokens} -> ${audit.afterTokens}, saved ${audit.savedTokens}`);
      }
    }
  } catch {
    // Ignore, will be emitted as an event
  }
}

export function do_stop(self: InteractiveMode): void {
  if (self.settingsManager.getShowTerminalProgress()) {
    self.ui.terminal.setProgress(false);
  }
  self.ui.terminal.setMouseTracking?.(false);
  self.planPanelInputUnsubscribe?.();
  self.planPanelInputUnsubscribe = undefined;
  if (self.queuedFooterSpinnerTimer) {
    clearInterval(self.queuedFooterSpinnerTimer);
    self.queuedFooterSpinnerTimer = undefined;
  }
  if (self.loadingAnimation) {
    self.loadingAnimation.stop();
    self.loadingAnimation = undefined;
  }
  self.clearExtensionTerminalInputListeners();
  self.footer.dispose();
  self.footerDataProvider.dispose();
  if (self.unsubscribe) {
    self.unsubscribe();
  }
  if (self.isInitialized) {
    self.ui.stop();
    self.isInitialized = false;
  }
  self.unregisterSignalHandlers();
}
