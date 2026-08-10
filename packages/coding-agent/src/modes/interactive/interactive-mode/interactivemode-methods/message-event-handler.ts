import type { AgentSessionEvent } from "../../../../core/agent-session.ts";
import { SLEEP_TOOL_NAME } from "../../../../core/messages.ts";
import { AssistantMessageComponent } from "../../components/assistant-message.ts";
import { ToolExecutionComponent } from "../../components/tool-execution.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function handleMessageEvent(self: InteractiveMode, event: AgentSessionEvent): boolean {
  switch (event.type) {
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
    default:
      return false;
  }
  return true;
}
