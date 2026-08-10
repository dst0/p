import type { AgentEvent, AgentMessage } from "@dst0/p-agent-core";
import type { ImageContent } from "@dst0/p-ai";
import type { SessionStats } from "../../../../core/agent-session.ts";
import type { BashResult } from "../../../../core/bash-executor.ts";
import type { CompactionResult } from "../../../../core/compaction/index.ts";
import type { RpcResponse, RpcSlashCommand } from "../../rpc-types.ts";
import type { RpcClient } from "../rpcclient.ts";

export async function do_setFollowUpMode(self: RpcClient, mode: "all" | "one-at-a-time"): Promise<void> {
  await self.send({ type: "set_follow_up_mode", mode });
}

export async function do_compact(self: RpcClient, customInstructions?: string): Promise<CompactionResult> {
  const response = await self.send({ type: "compact", customInstructions });
  return self.getData(response);
}

export async function do_setAutoCompaction(self: RpcClient, enabled: boolean): Promise<void> {
  await self.send({ type: "set_auto_compaction", enabled });
}

export async function do_setAutoRetry(self: RpcClient, enabled: boolean): Promise<void> {
  await self.send({ type: "set_auto_retry", enabled });
}

export async function do_abortRetry(self: RpcClient): Promise<void> {
  await self.send({ type: "abort_retry" });
}

export async function do_bash(self: RpcClient, command: string): Promise<BashResult> {
  const response = await self.send({ type: "bash", command });
  return self.getData(response);
}

export async function do_abortBash(self: RpcClient): Promise<void> {
  await self.send({ type: "abort_bash" });
}

export async function do_getSessionStats(self: RpcClient): Promise<SessionStats> {
  const response = await self.send({ type: "get_session_stats" });
  return self.getData(response);
}

export async function do_exportHtml(self: RpcClient, outputPath?: string): Promise<{ path: string }> {
  const response = await self.send({ type: "export_html", outputPath });
  return self.getData(response);
}

export async function do_switchSession(self: RpcClient, sessionPath: string): Promise<{ cancelled: boolean }> {
  const response = await self.send({ type: "switch_session", sessionPath });
  return self.getData(response);
}

export async function do_fork(self: RpcClient, entryId: string): Promise<{ text: string; cancelled: boolean }> {
  const response = await self.send({ type: "fork", entryId });
  return self.getData(response);
}

export async function do_clone(self: RpcClient): Promise<{ cancelled: boolean }> {
  const response = await self.send({ type: "clone" });
  return self.getData(response);
}

export async function do_getForkMessages(self: RpcClient): Promise<Array<{ entryId: string; text: string }>> {
  const response = await self.send({ type: "get_fork_messages" });
  return self.getData<{ messages: Array<{ entryId: string; text: string }> }>(response).messages;
}

export async function do_getLastAssistantText(self: RpcClient): Promise<string | null> {
  const response = await self.send({ type: "get_last_assistant_text" });
  return self.getData<{ text: string | null }>(response).text;
}

export async function do_setSessionName(self: RpcClient, name: string): Promise<void> {
  await self.send({ type: "set_session_name", name });
}

export async function do_getMessages(self: RpcClient): Promise<AgentMessage[]> {
  const response = await self.send({ type: "get_messages" });
  return self.getData<{ messages: AgentMessage[] }>(response).messages;
}

export async function do_getCommands(self: RpcClient): Promise<RpcSlashCommand[]> {
  const response = await self.send({ type: "get_commands" });
  return self.getData<{ commands: RpcSlashCommand[] }>(response).commands;
}

export function do_waitForIdle(self: RpcClient, timeout = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout waiting for agent to become idle. Stderr: ${self.stderr}`));
    }, timeout);

    const unsubscribe = self.onEvent((event) => {
      if (event.type === "agent_end") {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

export function do_collectEvents(self: RpcClient, timeout = 60000): Promise<AgentEvent[]> {
  return new Promise((resolve, reject) => {
    const events: AgentEvent[] = [];
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout collecting events. Stderr: ${self.stderr}`));
    }, timeout);

    const unsubscribe = self.onEvent((event) => {
      events.push(event);
      if (event.type === "agent_end") {
        clearTimeout(timer);
        unsubscribe();
        resolve(events);
      }
    });
  });
}

export async function do_promptAndWait(
  self: RpcClient,
  message: string,
  images?: ImageContent[],
  timeout = 60000,
): Promise<AgentEvent[]> {
  const eventsPromise = self.collectEvents(timeout);
  await self.prompt(message, images);
  return eventsPromise;
}

export function do_handleLine(self: RpcClient, line: string): void {
  try {
    const data = JSON.parse(line);

    // Check if it's a response to a pending request
    if (data.type === "response" && data.id && self.pendingRequests.has(data.id)) {
      const pending = self.pendingRequests.get(data.id)!;
      self.pendingRequests.delete(data.id);
      pending.resolve(data as RpcResponse);
      return;
    }

    // Otherwise it's an event
    for (const listener of self.eventListeners) {
      listener(data as AgentEvent);
    }
  } catch {
    // Ignore non-JSON lines
  }
}

export function do_createProcessExitError(self: RpcClient, code: number | null, signal: NodeJS.Signals | null): Error {
  return new Error(`Agent process exited (code=${code} signal=${signal}). Stderr: ${self.stderr}`);
}

export function do_rejectPendingRequests(self: RpcClient, error: Error): void {
  for (const pending of self.pendingRequests.values()) {
    pending.reject(error);
  }
  self.pendingRequests.clear();
}
