import type { AgentMessage } from "@dst0/p-agent-core";
import type { ImageContent } from "@dst0/p-ai";
import type { BuildSystemPromptOptions } from "../../../system-prompt.ts";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  BeforeProviderRequestEvent,
  ContextEvent,
  ContextEventResult,
  ExtensionContext,
} from "../../types.ts";
import type { ExtensionRunner } from "../extensionrunner.ts";
import type { BeforeAgentStartCombinedResult } from "../types.ts";

export async function do_emitContext(self: ExtensionRunner, messages: AgentMessage[]): Promise<AgentMessage[]> {
  const ctx = self.createContext();
  let currentMessages = structuredClone(messages);

  for (const ext of self.extensions) {
    const handlers = ext.handlers.get("context");
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      try {
        const event: ContextEvent = { type: "context", messages: currentMessages };
        const handlerResult = await handler(event, ctx);

        if (handlerResult && (handlerResult as ContextEventResult).messages) {
          currentMessages = (handlerResult as ContextEventResult).messages!;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        self.emitError({
          extensionPath: ext.path,
          event: "context",
          error: message,
          stack,
        });
      }
    }
  }

  return currentMessages;
}

export async function do_emitBeforeProviderRequest(self: ExtensionRunner, payload: unknown): Promise<unknown> {
  const ctx = self.createContext();
  let currentPayload = payload;

  for (const ext of self.extensions) {
    const handlers = ext.handlers.get("before_provider_request");
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      try {
        const event: BeforeProviderRequestEvent = {
          type: "before_provider_request",
          payload: currentPayload,
        };
        const handlerResult = await handler(event, ctx);
        if (handlerResult !== undefined) {
          currentPayload = handlerResult;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        self.emitError({
          extensionPath: ext.path,
          event: "before_provider_request",
          error: message,
          stack,
        });
      }
    }
  }

  return currentPayload;
}

export async function do_emitBeforeAgentStart(
  self: ExtensionRunner,
  prompt: string,
  images: ImageContent[] | undefined,
  systemPrompt: string,
  systemPromptOptions: BuildSystemPromptOptions,
): Promise<BeforeAgentStartCombinedResult | undefined> {
  let currentSystemPrompt = systemPrompt;
  const ctx = Object.defineProperties({}, Object.getOwnPropertyDescriptors(self.createContext())) as ExtensionContext;
  ctx.getSystemPrompt = () => {
    self.assertActive();
    return currentSystemPrompt;
  };
  const messages: NonNullable<BeforeAgentStartEventResult["message"]>[] = [];
  let systemPromptModified = false;

  for (const ext of self.extensions) {
    const handlers = ext.handlers.get("before_agent_start");
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      try {
        const event: BeforeAgentStartEvent = {
          type: "before_agent_start",
          prompt,
          images,
          systemPrompt: currentSystemPrompt,
          systemPromptOptions,
        };
        const handlerResult = await handler(event, ctx);

        if (handlerResult) {
          const result = handlerResult as BeforeAgentStartEventResult;
          if (result.message) {
            messages.push(result.message);
          }
          if (result.systemPrompt !== undefined) {
            currentSystemPrompt = result.systemPrompt;
            systemPromptModified = true;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        self.emitError({
          extensionPath: ext.path,
          event: "before_agent_start",
          error: message,
          stack,
        });
      }
    }
  }

  if (messages.length > 0 || systemPromptModified) {
    return {
      messages: messages.length > 0 ? messages : undefined,
      systemPrompt: systemPromptModified ? currentSystemPrompt : undefined,
    };
  }

  return undefined;
}
