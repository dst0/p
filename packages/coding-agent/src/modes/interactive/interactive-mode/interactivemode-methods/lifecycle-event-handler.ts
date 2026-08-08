import { Loader, Spacer, Text } from "@dst0/p-tui";
import type { AgentSessionEvent } from "../../../../core/agent-session.ts";
import { CountdownTimer } from "../../components/countdown-timer.ts";
import { keyText } from "../../components/keybinding-hints.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function handleLifecycleEvent(self: InteractiveMode, event: AgentSessionEvent): Promise<boolean> {
  switch (event.type) {
    case "agent_start":
      self.pendingTools.clear();
      self.footerDataProvider.clearProgress();
      if (self.settingsManager.getShowTerminalProgress()) {
        self.ui.terminal.setProgress(true);
      }
      // Restore main escape handler if retry handler is still active
      // (retry success event fires later, but we need main handler now)
      if (self.retryEscapeHandler) {
        self.defaultEditor.onEscape = self.retryEscapeHandler;
        self.retryEscapeHandler = undefined;
      }
      if (self.retryCountdown) {
        self.retryCountdown.dispose();
        self.retryCountdown = undefined;
      }
      if (self.retryLoader) {
        self.retryLoader.stop();
        self.retryLoader = undefined;
      }
      self.stopWorkingLoader();
      if (self.workingVisible) {
        self.loadingAnimation = self.createWorkingLoader();
        self.statusContainer.addChild(self.loadingAnimation);
      }
      self.ui.requestRender();
      break;
    case "queue_update":
      self.updatePendingMessagesDisplay();
      self.ui.requestRender();
      break;
    case "session_info_changed":
      self.updateTerminalTitle();
      self.footer.invalidate();
      self.ui.requestRender();
      break;
    case "thinking_level_changed":
      self.footer.invalidate();
      self.updateEditorBorderColor();
      break;
    case "interaction_mode_changed":
      self.footer.invalidate();
      self.ui.requestRender();
      break;
    case "agent_end":
      self.footerDataProvider.clearProgress();
      if (self.settingsManager.getShowTerminalProgress()) {
        self.ui.terminal.setProgress(false);
      }
      if (self.loadingAnimation) {
        self.loadingAnimation.stop();
        self.loadingAnimation = undefined;
        self.statusContainer.clear();
      }
      if (self.streamingComponent) {
        self.chatContainer.removeChild(self.streamingComponent);
        self.streamingComponent = undefined;
        self.streamingMessage = undefined;
      }
      self.pendingTools.clear();

      await self.checkShutdownRequested();

      self.ui.requestRender();
      break;
    case "compaction_start": {
      if (self.settingsManager.getShowTerminalProgress()) {
        self.ui.terminal.setProgress(true);
      }
      // Keep editor active; submissions are queued during compaction.
      self.autoCompactionEscapeHandler = self.defaultEditor.onEscape;
      self.defaultEditor.onEscape = () => {
        self.session.abortCompaction();
      };
      self.statusContainer.clear();
      const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
      const label =
        event.reason === "manual"
          ? `Compacting context... ${cancelHint}`
          : `${event.reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
      self.autoCompactionLoader = new Loader(
        self.ui,
        (spinner) => theme.fg("accent", spinner),
        (text) => theme.fg("muted", text),
        label,
      );
      self.statusContainer.addChild(self.autoCompactionLoader);
      self.ui.requestRender();
      break;
    }
    case "compaction_progress": {
      if (self.autoCompactionLoader) {
        const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
        self.autoCompactionLoader.setMessage(
          `Compacting chunk ${event.currentChunk}/${event.totalChunks}... ${cancelHint}`,
        );
      }
      break;
    }
    case "compaction_end": {
      if (self.settingsManager.getShowTerminalProgress()) {
        self.ui.terminal.setProgress(false);
      }
      if (self.autoCompactionEscapeHandler) {
        self.defaultEditor.onEscape = self.autoCompactionEscapeHandler;
        self.autoCompactionEscapeHandler = undefined;
      }
      if (self.autoCompactionLoader) {
        self.autoCompactionLoader.stop();
        self.autoCompactionLoader = undefined;
        self.statusContainer.clear();
      }
      if (event.aborted) {
        if (event.reason === "manual") {
          self.showError("Compaction cancelled");
        } else {
          self.showStatus("Auto-compaction cancelled");
        }
      } else if (event.result) {
        self.chatContainer.clear();
        self.rebuildChatFromMessages();
        self.footer.invalidate();
      } else if (event.errorMessage) {
        if (event.reason === "manual") {
          self.showError(event.errorMessage);
        } else {
          self.chatContainer.addChild(new Spacer(1));
          self.chatContainer.addChild(new Text(theme.fg("error", event.errorMessage), 1, 0));
        }
      }
      void self.flushCompactionQueue({ willRetry: event.willRetry });
      self.ui.requestRender();
      break;
    }
    case "auto_retry_start": {
      self.showRetryProgressInFooter(event);
      // Set up escape to abort retry
      self.retryEscapeHandler = self.defaultEditor.onEscape;
      self.defaultEditor.onEscape = () => {
        self.session.abortRetry();
      };
      // Show retry indicator
      self.statusContainer.clear();
      self.retryCountdown?.dispose();
      const retryPrefix =
        event.reason === "model_loading" || self.getRecentModelSwitch() ? "Model switching; retrying" : "Retrying";
      const retryMessage = (seconds: number) =>
        `${retryPrefix} (${event.attempt}/${event.maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
      self.retryLoader = new Loader(
        self.ui,
        (spinner) => theme.fg("warning", spinner),
        (text) => theme.fg("muted", text),
        retryMessage(Math.ceil(event.delayMs / 1000)),
      );
      self.retryCountdown = new CountdownTimer(
        event.delayMs,
        self.ui,
        (seconds) => {
          self.retryLoader?.setMessage(retryMessage(seconds));
        },
        () => {
          self.retryCountdown = undefined;
        },
      );
      self.statusContainer.addChild(self.retryLoader);
      self.ui.requestRender();
      break;
    }
    case "auto_retry_end": {
      // Restore escape handler
      if (self.retryEscapeHandler) {
        self.defaultEditor.onEscape = self.retryEscapeHandler;
        self.retryEscapeHandler = undefined;
      }
      if (self.retryCountdown) {
        self.retryCountdown.dispose();
        self.retryCountdown = undefined;
      }
      // Stop loader
      if (self.retryLoader) {
        self.retryLoader.stop();
        self.retryLoader = undefined;
        self.statusContainer.clear();
      }
      // Show error only on final failure (success shows normal response)
      if (!event.success) {
        self.showError(`Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`);
      }
      self.ui.requestRender();
      break;
    }
    default:
      return false;
  }
  return true;
}
