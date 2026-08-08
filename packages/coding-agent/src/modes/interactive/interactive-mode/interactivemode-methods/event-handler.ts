import { Loader, Spacer, Text } from "@dst0/p-tui";
import type { AgentSessionEvent } from "../../../../core/agent-session.ts";
import { SLEEP_TOOL_NAME } from "../../../../core/messages.ts";
import { AssistantMessageComponent } from "../../components/assistant-message.ts";
import { CountdownTimer } from "../../components/countdown-timer.ts";
import { keyText } from "../../components/keybinding-hints.ts";
import { ToolExecutionComponent } from "../../components/tool-execution.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_handleEvent(self: InteractiveMode, event: AgentSessionEvent): Promise<void> {
  if (!self.isInitialized) {
    await self.init();
  }

  self.footer.invalidate();

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

    case "request_start": {
      const recentSwitch = self.getRecentModelSwitch();
      const queuedRetry = self.footerDataProvider.getQueuedProgress()?.source === "llm-orchestrator";
      self.footerDataProvider.clearProgress({ preserveQueued: queuedRetry });
      if (!queuedRetry) {
        if (recentSwitch) {
          self.footerDataProvider.setModelSwitchProgress(recentSwitch);
        }
        self.footerDataProvider.setSendingProgress({ model: self.getModelStatusLabel(event.model) });
      }
      self.ui.requestRender();
      break;
    }

    case "message_start":
      if (event.message.role === "custom") {
        self.addMessageToChat(event.message);
        self.ui.requestRender();
      } else if (event.message.role === "user") {
        self.addMessageToChat(event.message);
        self.updatePendingMessagesDisplay();
        self.ui.requestRender();
      } else if (event.message.role === "assistant") {
        self.footerDataProvider.clearProgress();
        self.footerDataProvider.setPrefillProgress({
          percent: 0,
          elapsedMs: 0,
        });
        self.streamingComponent = new AssistantMessageComponent(
          undefined,
          self.hideThinkingBlock,
          self.getMarkdownThemeWithSettings(),
          self.hiddenThinkingLabel,
        );
        self.streamingMessage = event.message;
        self.chatContainer.addChild(self.streamingComponent);
        self.streamingComponent.updateContent(self.streamingMessage);
        self.ui.requestRender();
      }
      break;

    case "message_update":
      if (self.streamingComponent && event.message.role === "assistant") {
        self.streamingMessage = event.message;
        self.streamingComponent.updateContent(self.streamingMessage);

        if (event.assistantMessageEvent?.type === "queue_progress") {
          self.footerDataProvider.setPrefillProgress(undefined);
          self.footerDataProvider.setGenProgress(undefined);
          self.footerDataProvider.setSendingProgress(undefined);
          self.footerDataProvider.setModelSwitchProgress(undefined);
          self.footerDataProvider.setLoadingProgress(undefined);
          self.footerDataProvider.setQueuedProgress({
            position: event.assistantMessageEvent.position,
            queuedAhead: event.assistantMessageEvent.queuedAhead,
            queue: event.assistantMessageEvent.queue,
            workerId: event.assistantMessageEvent.workerId,
            ticketId: event.assistantMessageEvent.ticketId,
            queuedAt: event.assistantMessageEvent.queuedAtMs,
            queuedForMs: event.assistantMessageEvent.queuedForMs,
            source: "llm-orchestrator",
          });
        } else if (event.assistantMessageEvent?.type === "prefill_progress") {
          self.footerDataProvider.setSendingProgress(undefined);
          self.clearLlmOrchestratorQueueProgress();
          const percent =
            "percent" in event.assistantMessageEvent && typeof event.assistantMessageEvent.percent === "number"
              ? event.assistantMessageEvent.percent
              : 100;
          const tokensPerSecond =
            "tokensPerSecond" in event.assistantMessageEvent &&
            typeof event.assistantMessageEvent.tokensPerSecond === "number"
              ? event.assistantMessageEvent.tokensPerSecond
              : undefined;
          self.footerDataProvider.setPrefillProgress({
            elapsedMs: event.assistantMessageEvent.elapsedMs,
            percent,
            tokensPerSecond,
          });
        } else if (event.assistantMessageEvent?.type === "gen_progress") {
          self.footerDataProvider.setPrefillProgress(undefined);
          self.footerDataProvider.setSendingProgress(undefined);
          self.clearLlmOrchestratorQueueProgress();
          self.footerDataProvider.setGenProgress({
            tokensPerSecond: event.assistantMessageEvent.tokensPerSecond,
            tokens: event.assistantMessageEvent.tokens,
          });
        } else if (event.assistantMessageEvent?.type === "model_switch_progress") {
          self.footerDataProvider.setPrefillProgress(undefined);
          self.footerDataProvider.setGenProgress(undefined);
          self.footerDataProvider.setSendingProgress(undefined);
          self.clearLlmOrchestratorQueueProgress();
          self.footerDataProvider.setModelSwitchProgress({
            fromModel: event.assistantMessageEvent.fromModel,
            toModel: event.assistantMessageEvent.toModel,
          });
        } else if (event.assistantMessageEvent?.type === "loading_progress") {
          self.footerDataProvider.setPrefillProgress(undefined);
          self.footerDataProvider.setGenProgress(undefined);
          self.footerDataProvider.setSendingProgress(undefined);
          self.clearLlmOrchestratorQueueProgress();
          self.footerDataProvider.setLoadingProgress({
            model: event.assistantMessageEvent.model,
          });
        } else if (
          event.assistantMessageEvent?.type === "text_start" ||
          event.assistantMessageEvent?.type === "thinking_start" ||
          event.assistantMessageEvent?.type === "toolcall_start"
        ) {
          self.footerDataProvider.setPrefillProgress(undefined);
          self.footerDataProvider.setSendingProgress(undefined);
          self.clearLlmOrchestratorQueueProgress();
          self.footerDataProvider.setGenProgress({
            tokensPerSecond: 0,
            tokens: 0,
          });
          self.footerDataProvider.setModelSwitchProgress(undefined);
          self.footerDataProvider.setLoadingProgress(undefined);
        }

        for (const content of self.streamingMessage.content) {
          if (content.type === "toolCall" && content.name !== SLEEP_TOOL_NAME) {
            if (!self.pendingTools.has(content.id)) {
              const component = new ToolExecutionComponent(
                content.name,
                content.id,
                content.arguments,
                {
                  showImages: self.settingsManager.getShowImages(),
                  imageWidthCells: self.settingsManager.getImageWidthCells(),
                  showHarnessMessages: self.settingsManager?.getShowHarnessMessages?.() ?? false,
                },
                self.getRegisteredToolDefinition(content.name),
                self.ui,
                self.sessionManager.getCwd(),
              );
              component.setExpanded(self.toolOutputExpanded);
              self.chatContainer.addChild(component);
              self.pendingTools.set(content.id, component);
            } else {
              const component = self.pendingTools.get(content.id);
              if (component) {
                component.updateArgs(content.arguments);
              }
            }
          }
        }
        self.ui.requestRender();
      }
      break;

    case "message_end":
      self.syncPlanTracker?.();
      if (event.message.role === "user") break;
      if (self.streamingComponent && event.message.role === "assistant") {
        self.streamingMessage = event.message;
        let errorMessage: string | undefined;
        if (self.streamingMessage.stopReason === "aborted") {
          const retryAttempt = self.session.retryAttempt;
          errorMessage =
            retryAttempt > 0
              ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
              : "Operation aborted";
          self.streamingMessage.errorMessage = errorMessage;
        }
        if (self.streamingMessage.stopReason === "error" && self.session.willRetryMessage(self.streamingMessage)) {
          self.removeTransientStreamingUi();
          self.footerDataProvider.clearProgress();
          self.footer.invalidate();
          self.ui.requestRender();
          break;
        }
        self.streamingComponent.updateContent(self.streamingMessage);

        if (self.streamingMessage.stopReason === "aborted" || self.streamingMessage.stopReason === "error") {
          if (!errorMessage) {
            errorMessage = self.streamingMessage.errorMessage || "Error";
          }
          for (const [, component] of self.pendingTools.entries()) {
            component.updateResult({
              content: [{ type: "text", text: errorMessage }],
              isError: true,
            });
          }
          self.pendingTools.clear();
        } else {
          // Args are now complete - trigger diff computation for edit tools
          for (const [, component] of self.pendingTools.entries()) {
            component.setArgsComplete();
          }
        }
        const isQueueSleepResponse = self.streamingMessage.content.some(
          (content) => content.type === "toolCall" && content.name === SLEEP_TOOL_NAME,
        );
        self.streamingComponent = undefined;
        self.streamingMessage = undefined;
        self.footerDataProvider.clearProgress({ preserveQueued: isQueueSleepResponse });
        self.footer.invalidate();
      }
      self.ui.requestRender();
      break;

    case "tool_execution_start": {
      if (event.toolName === SLEEP_TOOL_NAME) {
        break;
      }
      self.planStatusTracker.addToolEvent({
        id: event.toolCallId,
        name: event.toolName,
        status: "running",
        argsSummary: "args" in event ? JSON.stringify(event.args).slice(0, 30) : "",
      });
      self.syncPlanTracker();
      let component = self.pendingTools.get(event.toolCallId);
      if (!component) {
        component = new ToolExecutionComponent(
          event.toolName,
          event.toolCallId,
          event.args,
          {
            showImages: self.settingsManager.getShowImages(),
            imageWidthCells: self.settingsManager.getImageWidthCells(),
            showHarnessMessages: self.settingsManager?.getShowHarnessMessages?.() ?? false,
          },
          self.getRegisteredToolDefinition(event.toolName),
          self.ui,
          self.sessionManager.getCwd(),
        );
        component.setExpanded(self.toolOutputExpanded);
        self.chatContainer.addChild(component);
        self.pendingTools.set(event.toolCallId, component);
      }
      component.markExecutionStarted();
      self.ui.requestRender();
      break;
    }

    case "tool_execution_update": {
      const component = self.pendingTools.get(event.toolCallId);
      if (component) {
        component.updateResult({ ...event.partialResult, isError: false }, true);
        self.ui.requestRender();
      }
      break;
    }

    case "tool_execution_end": {
      if (event.toolName === SLEEP_TOOL_NAME) {
        self.pendingTools.delete(event.toolCallId);
        break;
      }
      self.planStatusTracker?.updateToolEvent(event.toolCallId, {
        status: event.isError ? "error" : "success",
      });
      self.syncPlanTracker?.();
      const component = self.pendingTools.get(event.toolCallId);
      if (component) {
        component.updateResult({ ...event.result, isError: event.isError });
        self.pendingTools.delete(event.toolCallId);
        self.ui.requestRender();
      }
      break;
    }

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
  }
}
