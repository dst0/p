import type { ImageContent, TextContent } from "@dst0/p-ai";
import { runAgentLoop, runAgentLoopContinue } from "../../agent-loop.ts";
import type { AgentContext, AgentEvent, AgentMessage } from "../../types.ts";
import type { Agent } from "../agent.ts";

export function do_subscribe(
  self: Agent,
  listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
): () => void {
  self.listeners.add(listener);
  return () => self.listeners.delete(listener);
}

export function do_steer(self: Agent, message: AgentMessage): void {
  self.steeringQueue.enqueue(message);
}

export function do_followUp(self: Agent, message: AgentMessage): void {
  self.followUpQueue.enqueue(message);
}

export function do_clearSteeringQueue(self: Agent): void {
  self.steeringQueue.clear();
}

export function do_clearFollowUpQueue(self: Agent): void {
  self.followUpQueue.clear();
}

export function do_clearAllQueues(self: Agent): void {
  self.clearSteeringQueue();
  self.clearFollowUpQueue();
}

export function do_hasQueuedMessages(self: Agent): boolean {
  return self.steeringQueue.hasItems() || self.followUpQueue.hasItems();
}

export function do_abort(self: Agent): void {
  self.activeRun?.abortController.abort();
}

export function do_waitForIdle(self: Agent): Promise<void> {
  return self.activeRun?.promise ?? Promise.resolve();
}

export function do_reset(self: Agent): void {
  self._state.messages = [];
  self._state.isStreaming = false;
  self._state.streamingMessage = undefined;
  self._state.pendingToolCalls = new Set<string>();
  self._state.errorMessage = undefined;
  self.clearFollowUpQueue();
  self.clearSteeringQueue();
}

export async function do_prompt(
  self: Agent,
  input: string | AgentMessage | AgentMessage[],
  images?: ImageContent[],
): Promise<void> {
  if (self.activeRun) {
    throw new Error(
      "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
    );
  }
  const messages = self.normalizePromptInput(input, images);
  await self.runPromptMessages(messages);
}

export async function do_continue(self: Agent): Promise<void> {
  if (self.activeRun) {
    throw new Error("Agent is already processing. Wait for completion before continuing.");
  }

  const lastMessage = self._state.messages[self._state.messages.length - 1];
  if (!lastMessage) {
    throw new Error("No messages to continue from");
  }

  if (lastMessage.role === "assistant") {
    const queuedSteering = self.steeringQueue.drain();
    if (queuedSteering.length > 0) {
      await self.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
      return;
    }

    const queuedFollowUps = self.followUpQueue.drain();
    if (queuedFollowUps.length > 0) {
      await self.runPromptMessages(queuedFollowUps);
      return;
    }

    throw new Error("Cannot continue from message role: assistant");
  }

  await self.runContinuation();
}

export function do_normalizePromptInput(
  _self: Agent,
  input: string | AgentMessage | AgentMessage[],
  images?: ImageContent[],
): AgentMessage[] {
  if (Array.isArray(input)) {
    return input;
  }

  if (typeof input !== "string") {
    return [input];
  }

  const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
  if (images && images.length > 0) {
    content.push(...images);
  }
  return [{ role: "user", content, timestamp: Date.now() }];
}

export async function do_runPromptMessages(
  self: Agent,
  messages: AgentMessage[],
  options: { skipInitialSteeringPoll?: boolean } = {},
): Promise<void> {
  await self.runWithLifecycle(async (signal) => {
    await runAgentLoop(
      messages,
      self.createContextSnapshot(),
      self.createLoopConfig(options),
      (event) => self.processEvents(event),
      signal,
      self.streamFn,
    );
  });
}

export async function do_runContinuation(self: Agent): Promise<void> {
  await self.runWithLifecycle(async (signal) => {
    await runAgentLoopContinue(
      self.createContextSnapshot(),
      self.createLoopConfig(),
      (event) => self.processEvents(event),
      signal,
      self.streamFn,
    );
  });
}

export function do_createContextSnapshot(self: Agent): AgentContext {
  return {
    systemPrompt: self._state.systemPrompt,
    messages: self._state.messages.slice(),
    tools: self._state.tools.slice(),
  };
}
