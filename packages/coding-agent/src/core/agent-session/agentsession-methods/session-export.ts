import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AssistantMessage } from "@dst0/p-ai";
import { resolvePath } from "../../../utils/paths.ts";
import type { ReplacedSessionContext } from "../../extensions/index.ts";
import { CURRENT_SESSION_VERSION, type SessionHeader } from "../../session-manager.ts";
import { getTaskVerificationCompletionPayload } from "../../task-verification/verified-completion.ts";
import type { AgentSession } from "../agentsession.ts";

export function do_exportToJsonl(self: AgentSession, outputPath?: string): string {
  const filePath = resolvePath(
    outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
    process.cwd(),
  );
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const header: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: self.sessionManager.getSessionId(),
    timestamp: new Date().toISOString(),
    cwd: self.sessionManager.getCwd(),
  };

  const branchEntries = self.sessionManager.getBranch();
  const lines = [JSON.stringify(header)];

  // Re-chain parentIds to form a linear sequence
  let prevId: string | null = null;
  for (const entry of branchEntries) {
    const linear = { ...entry, parentId: prevId };
    lines.push(JSON.stringify(linear));
    prevId = entry.id;
  }

  writeFileSync(filePath, `${lines.join("\n")}\n`);
  return filePath;
}

export function do_getLastAssistantText(self: AgentSession): string | undefined {
  const lastMessage = self.agent.state.messages[self.agent.state.messages.length - 1];
  const verifiedCompletion = getTaskVerificationCompletionPayload(lastMessage ? [lastMessage] : []);
  if (verifiedCompletion) return verifiedCompletion.summary;

  const lastAssistant = self.agent.state.messages
    .slice()
    .reverse()
    .find((m) => {
      if (m.role !== "assistant") return false;
      const msg = m as AssistantMessage;
      // Skip aborted messages with no content
      if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
      return true;
    });

  if (!lastAssistant) return undefined;

  let text = "";
  for (const content of (lastAssistant as AssistantMessage).content) {
    if (content.type === "text") {
      text += content.text;
    }
  }

  return text.trim() || undefined;
}

export function do_createReplacedSessionContext(self: AgentSession): ReplacedSessionContext {
  const context = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(self._extensionRunner.createCommandContext()),
  ) as ReplacedSessionContext;
  context.sendMessage = (message, options) => self.sendCustomMessage(message, options);
  context.sendUserMessage = (content, options) => self.sendUserMessage(content, options);
  return context;
}

export function do_hasExtensionHandlers(self: AgentSession, eventType: string): boolean {
  return self._extensionRunner.hasHandlers(eventType);
}
