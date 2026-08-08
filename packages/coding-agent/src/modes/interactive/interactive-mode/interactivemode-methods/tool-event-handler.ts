import type { AgentSessionEvent } from "../../../../core/agent-session.ts";
import { SLEEP_TOOL_NAME } from "../../../../core/messages.ts";
import { ToolExecutionComponent } from "../../components/tool-execution.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function handleToolEvent(self: InteractiveMode, event: AgentSessionEvent): boolean {
  switch (event.type) {
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
    default:
      return false;
  }
  return true;
}
