import type { AgentMessage } from "@dst0/p-agent-core";
import type {
  MessageEndEvent,
  MessageEndEventResult,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
  ToolResultEventResult,
  UserBashEvent,
  UserBashEventResult,
} from "../../types.ts";
import type { ExtensionRunner } from "../extensionrunner.ts";

export async function do_emitMessageEnd(
  self: ExtensionRunner,
  event: MessageEndEvent,
): Promise<AgentMessage | undefined> {
  const ctx = self.createContext();
  let currentMessage = event.message;
  let modified = false;

  for (const ext of self.extensions) {
    const handlers = ext.handlers.get("message_end");
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      try {
        const currentEvent: MessageEndEvent = { ...event, message: currentMessage };
        const handlerResult = (await handler(currentEvent, ctx)) as MessageEndEventResult | undefined;
        if (!handlerResult?.message) continue;

        if (handlerResult.message.role !== currentMessage.role) {
          self.emitError({
            extensionPath: ext.path,
            event: "message_end",
            error: "message_end handlers must return a message with the same role",
          });
          continue;
        }

        currentMessage = handlerResult.message;
        modified = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        self.emitError({
          extensionPath: ext.path,
          event: "message_end",
          error: message,
          stack,
        });
      }
    }
  }

  return modified ? currentMessage : undefined;
}

export async function do_emitToolResult(
  self: ExtensionRunner,
  event: ToolResultEvent,
): Promise<ToolResultEventResult | undefined> {
  const ctx = self.createContext();
  const currentEvent: ToolResultEvent = { ...event };
  let modified = false;

  for (const ext of self.extensions) {
    const handlers = ext.handlers.get("tool_result");
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      try {
        const handlerResult = (await handler(currentEvent, ctx)) as ToolResultEventResult | undefined;
        if (!handlerResult) continue;

        if (handlerResult.content !== undefined) {
          currentEvent.content = handlerResult.content;
          modified = true;
        }
        if (handlerResult.details !== undefined) {
          currentEvent.details = handlerResult.details;
          modified = true;
        }
        if (handlerResult.isError !== undefined) {
          currentEvent.isError = handlerResult.isError;
          modified = true;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        self.emitError({
          extensionPath: ext.path,
          event: "tool_result",
          error: message,
          stack,
        });
      }
    }
  }

  if (!modified) {
    return undefined;
  }

  return {
    content: currentEvent.content,
    details: currentEvent.details,
    isError: currentEvent.isError,
  };
}

export async function do_emitToolCall(
  self: ExtensionRunner,
  event: ToolCallEvent,
): Promise<ToolCallEventResult | undefined> {
  const ctx = self.createContext();
  let result: ToolCallEventResult | undefined;

  for (const ext of self.extensions) {
    const handlers = ext.handlers.get("tool_call");
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      const handlerResult = await handler(event, ctx);

      if (handlerResult) {
        result = handlerResult as ToolCallEventResult;
        if (result.block) {
          return result;
        }
      }
    }
  }

  return result;
}

export async function do_emitUserBash(
  self: ExtensionRunner,
  event: UserBashEvent,
): Promise<UserBashEventResult | undefined> {
  const ctx = self.createContext();

  for (const ext of self.extensions) {
    const handlers = ext.handlers.get("user_bash");
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      try {
        const handlerResult = await handler(event, ctx);
        if (handlerResult) {
          return handlerResult as UserBashEventResult;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        self.emitError({
          extensionPath: ext.path,
          event: "user_bash",
          error: message,
          stack,
        });
      }
    }
  }

  return undefined;
}
