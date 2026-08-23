import { readFileSync } from "node:fs";
import type { AgentMessage } from "@dst0/p-agent-core";
import type { ImageContent, TextContent } from "@dst0/p-ai";
import { stripFrontmatter } from "../../../utils/frontmatter.ts";
import type { CustomMessage } from "../../messages.ts";
import { expandPromptTemplate } from "../../prompt-templates.ts";
import type { AgentSession } from "../agentsession.ts";
import { createProjectRuleTurnContext } from "./prompt-context.ts";

export async function do__tryExecuteExtensionCommand(self: AgentSession, text: string): Promise<boolean> {
  // Parse command name and args
  const spaceIndex = text.indexOf(" ");
  const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
  const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

  const command = self._extensionRunner.getCommand(commandName);
  if (!command) return false;

  // Get command context from extension runner (includes session control methods)
  const ctx = self._extensionRunner.createCommandContext();

  try {
    await command.handler(args, ctx);
    return true;
  } catch (err) {
    // Emit error via extension runner
    self._extensionRunner.emitError({
      extensionPath: `command:${commandName}`,
      event: "command",
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

export function do__expandSkillCommand(self: AgentSession, text: string): string {
  if (!text.startsWith("/skill:")) return text;

  const spaceIndex = text.indexOf(" ");
  const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
  const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

  const skill = self.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
  if (!skill) return text; // Unknown skill, pass through

  try {
    const content = readFileSync(skill.filePath, "utf-8");
    const body = stripFrontmatter(content).trim();
    const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
    return args ? `${skillBlock}\n\n${args}` : skillBlock;
  } catch (err) {
    // Emit error like extension commands do
    self._extensionRunner.emitError({
      extensionPath: skill.filePath,
      event: "skill_expansion",
      error: err instanceof Error ? err.message : String(err),
    });
    return text; // Return original on error
  }
}

export async function do_steer(self: AgentSession, text: string, images?: ImageContent[]): Promise<void> {
  // Check for extension commands (cannot be queued)
  if (text.startsWith("/")) {
    self._throwIfExtensionCommand(text);
  }

  // Expand skill commands and prompt templates
  let expandedText = self._expandSkillCommand(text);
  expandedText = expandPromptTemplate(expandedText, [...self.promptTemplates]);

  await self._queueSteer(expandedText, images);
}

export async function do_followUp(self: AgentSession, text: string, images?: ImageContent[]): Promise<void> {
  // Check for extension commands (cannot be queued)
  if (text.startsWith("/")) {
    self._throwIfExtensionCommand(text);
  }

  // Expand skill commands and prompt templates
  let expandedText = self._expandSkillCommand(text);
  expandedText = expandPromptTemplate(expandedText, [...self.promptTemplates]);

  await self._queueFollowUp(expandedText, images);
}

export async function do__queueSteer(self: AgentSession, text: string, images?: ImageContent[]): Promise<void> {
  self._steeringMessages.push(text);
  self._emitQueueUpdate();
  self.agent.steer(createQueuedTurnMessages(self, text, images));
}

export async function do__queueFollowUp(self: AgentSession, text: string, images?: ImageContent[]): Promise<void> {
  self._followUpMessages.push(text);
  self._emitQueueUpdate();
  self.agent.followUp(createQueuedTurnMessages(self, text, images));
}

function createQueuedTurnMessages(self: AgentSession, text: string, images?: ImageContent[]): AgentMessage[] {
  const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
  if (images) {
    content.push(...images);
  }
  const userMessage: AgentMessage = {
    role: "user",
    content,
    timestamp: Date.now(),
  };
  const messages: AgentMessage[] = [userMessage];
  if (self._projectInstructionMode === "compiled") {
    const turn = createProjectRuleTurnContext(self, text);
    if (turn.gate) turn.gate.candidateMerge = "union";
    self._queuedProjectRuleGates.set(userMessage, turn.gate);
    if (turn.prompt) messages.push(self._createRuntimeContextPromptMessage(turn.prompt, Date.now(), turn.gate));
  }
  return messages;
}

export function do__throwIfExtensionCommand(self: AgentSession, text: string): void {
  const spaceIndex = text.indexOf(" ");
  const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
  const command = self._extensionRunner.getCommand(commandName);

  if (command) {
    throw new Error(
      `Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
    );
  }
}

export async function do_sendCustomMessage<T = unknown>(
  self: AgentSession,
  message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
  options?: {
    triggerTurn?: boolean;
    deliverAs?: "steer" | "followUp" | "nextTurn";
  },
): Promise<void> {
  const appMessage = {
    role: "custom" as const,
    customType: message.customType,
    content: message.content,
    display: message.display,
    details: message.details,
    timestamp: Date.now(),
  } satisfies CustomMessage<T>;
  if (options?.deliverAs === "nextTurn") {
    self._pendingNextTurnMessages.push(appMessage);
  } else if (self.isStreaming) {
    if (options?.deliverAs === "followUp") {
      self.agent.followUp(appMessage);
    } else {
      self.agent.steer(appMessage);
    }
  } else if (options?.triggerTurn) {
    await self._runAgentPrompt(appMessage);
  } else {
    self.agent.state.messages.push(appMessage);
    self.sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
    self._emit({ type: "message_start", message: appMessage });
    self._emit({ type: "message_end", message: appMessage });
  }
}
