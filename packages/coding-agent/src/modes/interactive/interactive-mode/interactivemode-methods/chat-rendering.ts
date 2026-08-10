import { Spacer, Text } from "@dst0/p-tui";
import { SLEEP_TOOL_NAME } from "../../../../core/messages.ts";
import type { SessionContext } from "../../../../core/session-manager.ts";
import { hasTrustRequiringProjectResources } from "../../../../core/trust-manager.ts";
import { ToolExecutionComponent } from "../../components/tool-execution.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_renderSessionContext(
  self: InteractiveMode,
  sessionContext: SessionContext,
  options: { updateFooter?: boolean; populateHistory?: boolean } = {},
): void {
  self.pendingTools.clear();
  const renderedPendingTools = new Map<string, ToolExecutionComponent>();

  if (options.updateFooter) {
    self.footer.invalidate();
    self.updateEditorBorderColor();
  }

  for (const message of sessionContext.messages) {
    // Assistant messages need special handling for tool calls
    if (message.role === "assistant") {
      self.addMessageToChat(message);
      // Render tool call components
      for (const content of message.content) {
        if (content.type === "toolCall" && content.name !== SLEEP_TOOL_NAME) {
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

          if (message.stopReason === "aborted" || message.stopReason === "error") {
            let errorMessage: string;
            if (message.stopReason === "aborted") {
              const retryAttempt = self.session.retryAttempt;
              errorMessage =
                retryAttempt > 0
                  ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
                  : "Operation aborted";
            } else {
              errorMessage = message.errorMessage || "Error";
            }
            component.updateResult({
              content: [{ type: "text", text: errorMessage }],
              isError: true,
            });
          } else {
            renderedPendingTools.set(content.id, component);
          }
        }
      }
    } else if (message.role === "toolResult") {
      // Match tool results to pending tool components
      const component = renderedPendingTools.get(message.toolCallId);
      if (component) {
        component.updateResult(message);
        renderedPendingTools.delete(message.toolCallId);
      }
    } else {
      // All other messages use standard rendering
      self.addMessageToChat(message, options);
    }
  }

  for (const [toolCallId, component] of renderedPendingTools) {
    self.pendingTools.set(toolCallId, component);
  }
  self.ui.requestRender();
}

export function do_renderInitialMessages(self: InteractiveMode): void {
  // Get aligned messages and entries from session context
  const context = self.sessionManager.buildSessionContext();
  self.renderSessionContext(context, {
    updateFooter: true,
    populateHistory: true,
  });
  self.renderProjectTrustWarningIfNeeded();

  // Show compaction info if session was compacted
  const allEntries = self.sessionManager.getEntries();
  const compactionCount = allEntries.filter((e) => e.type === "compaction").length;
  if (compactionCount > 0) {
    const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
    self.showStatus(`Session compacted ${times}`);
  }
}

export function do_renderProjectTrustWarningIfNeeded(self: InteractiveMode): void {
  if (self.settingsManager.isProjectTrusted() || !hasTrustRequiringProjectResources(self.sessionManager.getCwd())) {
    return;
  }

  if (self.chatContainer.children.length > 0) {
    self.chatContainer.addChild(new Spacer(1));
  }
  self.chatContainer.addChild(
    new Text(
      theme.fg(
        "warning",
        "This project is not trusted. Project .p resources and packages are ignored. Use /trust to save a trust decision, then restart p.",
      ),
      1,
      0,
    ),
  );
}

export async function do_getUserInput(self: InteractiveMode): Promise<string> {
  const queuedInput = self.pendingUserInputs.shift();
  if (queuedInput !== undefined) {
    return queuedInput;
  }

  return new Promise((resolve) => {
    self.onInputCallback = (text: string) => {
      self.onInputCallback = undefined;
      resolve(text);
    };
  });
}

export function do_rebuildChatFromMessages(self: InteractiveMode): void {
  self.chatContainer.clear();
  const context = self.sessionManager.buildSessionContext();
  self.renderSessionContext(context);
}

export function do_handleCtrlC(self: InteractiveMode): void {
  const now = Date.now();
  if (now - self.lastSigintTime < 500) {
    void self.shutdown();
  } else {
    self.clearEditor();
    self.lastSigintTime = now;
  }
}

export function do_handleCtrlD(self: InteractiveMode): void {
  // Only called when editor is empty (enforced by CustomEditor)
  void self.shutdown();
}
