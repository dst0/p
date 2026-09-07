import type { AgentMessage } from "@dst0/p-agent-core";
import { Spacer } from "@dst0/p-tui";
import { isInternalAgentMessage, parseSkillBlock } from "../../../../core/agent-session.ts";
import type { TruncationResult } from "../../../../core/tools/truncate.ts";
import { AssistantMessageComponent } from "../../components/assistant-message.ts";
import { BashExecutionComponent } from "../../components/bash-execution.ts";
import { BranchSummaryMessageComponent } from "../../components/branch-summary-message.ts";
import { CompactionSummaryMessageComponent } from "../../components/compaction-summary-message.ts";
import { CustomMessageComponent } from "../../components/custom-message.ts";
import { SkillInvocationMessageComponent } from "../../components/skill-invocation-message.ts";
import { UserMessageComponent } from "../../components/user-message.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_addMessageToChat(
  self: InteractiveMode,
  message: AgentMessage,
  options?: { populateHistory?: boolean },
): void {
  switch (message.role) {
    case "bashExecution": {
      const component = new BashExecutionComponent(message.command, self.ui, message.excludeFromContext);
      if (message.output) {
        component.appendOutput(message.output);
      }
      component.setComplete(
        message.exitCode,
        message.cancelled,
        message.truncated ? ({ truncated: true } as TruncationResult) : undefined,
        message.fullOutputPath,
      );
      self.chatContainer.addChild(component);
      break;
    }
    case "custom": {
      if (message.display) {
        // Gate internal_repair messages behind showHarnessMessages setting
        if (message.customType === "internal_repair" && !self.settingsManager.getShowHarnessMessages()) {
          break;
        }
        const renderer = self.session.extensionRunner.getMessageRenderer(message.customType);
        const component = new CustomMessageComponent(message, renderer, self.getMarkdownThemeWithSettings());
        component.setExpanded(self.toolOutputExpanded);
        self.chatContainer.addChild(component);
      }
      break;
    }
    case "compactionSummary": {
      self.chatContainer.addChild(new Spacer(1));
      const component = new CompactionSummaryMessageComponent(message, self.getMarkdownThemeWithSettings());
      component.setExpanded(self.toolOutputExpanded);
      self.chatContainer.addChild(component);
      break;
    }
    case "branchSummary": {
      self.chatContainer.addChild(new Spacer(1));
      const component = new BranchSummaryMessageComponent(message, self.getMarkdownThemeWithSettings());
      component.setExpanded(self.toolOutputExpanded);
      self.chatContainer.addChild(component);
      break;
    }
    case "user": {
      // Gate internal repair messages behind showHarnessMessages setting
      if (isInternalAgentMessage(message) && !self.settingsManager.getShowHarnessMessages()) {
        break;
      }
      const textContent = self.getUserMessageText(message);
      if (textContent) {
        if (self.chatContainer.children.length > 0) {
          self.chatContainer.addChild(new Spacer(1));
        }
        const skillBlock = parseSkillBlock(textContent);
        if (skillBlock) {
          // Render skill block (collapsible)
          const component = new SkillInvocationMessageComponent(skillBlock, self.getMarkdownThemeWithSettings());
          component.setExpanded(self.toolOutputExpanded);
          self.chatContainer.addChild(component);
          // Render user message separately if present
          if (skillBlock.userMessage) {
            self.chatContainer.addChild(new Spacer(1));
            const userComponent = new UserMessageComponent(skillBlock.userMessage, self.getMarkdownThemeWithSettings());
            self.chatContainer.addChild(userComponent);
          }
        } else {
          const userComponent = new UserMessageComponent(textContent, self.getMarkdownThemeWithSettings());
          self.chatContainer.addChild(userComponent);
        }
        if (options?.populateHistory) {
          self.editor.addToHistory?.(textContent);
        }
      }
      break;
    }
    case "assistant": {
      const assistantComponent = new AssistantMessageComponent(
        message,
        self.hideThinkingBlock,
        self.getMarkdownThemeWithSettings(),
        self.hiddenThinkingLabel,
      );
      self.chatContainer.addChild(assistantComponent);
      break;
    }
    case "toolResult": {
      // Tool results are rendered inline with tool calls, handled separately
      break;
    }
    default: {
      const _exhaustive: never = message;
    }
  }
}
