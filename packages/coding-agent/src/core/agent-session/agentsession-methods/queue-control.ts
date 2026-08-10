import type { ImageContent, Model, TextContent } from "@dst0/p-ai";
import { modelsAreEqual } from "@dst0/p-ai";
import type { AgentSession } from "../agentsession.ts";
import type { ModelCycleResult } from "../session-types.ts";

export async function do_sendUserMessage(
  self: AgentSession,
  content: string | (TextContent | ImageContent)[],
  options?: { deliverAs?: "steer" | "followUp" },
): Promise<void> {
  // Normalize content to text string + optional images
  let text: string;
  let images: ImageContent[] | undefined;

  if (typeof content === "string") {
    text = content;
  } else {
    const textParts: string[] = [];
    images = [];
    for (const part of content) {
      if (part.type === "text") {
        textParts.push(part.text);
      } else {
        images.push(part);
      }
    }
    text = textParts.join("\n");
    if (images.length === 0) images = undefined;
  }

  // Use prompt() with expandPromptTemplates: false to skip command handling and template expansion
  await self.prompt(text, {
    expandPromptTemplates: false,
    streamingBehavior: options?.deliverAs,
    images,
    source: "extension",
  });
}

export function do_clearQueue(self: AgentSession): { steering: string[]; followUp: string[] } {
  const steering = [...self._steeringMessages];
  const followUp = [...self._followUpMessages];
  self._steeringMessages = [];
  self._followUpMessages = [];
  self.agent.clearAllQueues();
  self._emitQueueUpdate();
  return { steering, followUp };
}

export function do_getSteeringMessages(self: AgentSession): readonly string[] {
  return self._steeringMessages;
}

export function do_getFollowUpMessages(self: AgentSession): readonly string[] {
  return self._followUpMessages;
}

export async function do_abort(self: AgentSession): Promise<void> {
  self.abortRetry();
  self.agent.abort();
  await self.agent.waitForIdle();
}

export async function do__emitModelSelect(
  self: AgentSession,
  nextModel: Model<any>,
  previousModel: Model<any> | undefined,
  source: "set" | "cycle" | "restore",
): Promise<void> {
  if (modelsAreEqual(previousModel, nextModel)) return;
  await self._extensionRunner.emit({
    type: "model_select",
    model: nextModel,
    previousModel,
    source,
  });
}

export async function do_setModel(self: AgentSession, model: Model<any>): Promise<void> {
  if (modelsAreEqual(self.model, model)) {
    return;
  }

  if (!self._modelRegistry.hasConfiguredAuth(model)) {
    throw new Error(`No API key for ${model.provider}/${model.id}`);
  }

  const previousModel = self.model;
  const thinkingLevel = self._getThinkingLevelForModelSwitch();
  self.agent.state.model = model;
  self.sessionManager.appendModelChange(model.provider, model.id);
  self.settingsManager.setDefaultModelAndProvider(model.provider, model.id);

  // Re-clamp thinking level for new model's capabilities
  self.setThinkingLevel(thinkingLevel);

  await self._emitModelSelect(model, previousModel, "set");
}

export async function do_cycleModel(
  self: AgentSession,
  direction: "forward" | "backward" = "forward",
): Promise<ModelCycleResult | undefined> {
  if (self._scopedModels.length > 0) {
    return self._cycleScopedModel(direction);
  }
  return self._cycleAvailableModel(direction);
}

export async function do__cycleScopedModel(
  self: AgentSession,
  direction: "forward" | "backward",
): Promise<ModelCycleResult | undefined> {
  const scopedModels = self._scopedModels.filter((scoped) => self._modelRegistry.hasConfiguredAuth(scoped.model));
  if (scopedModels.length <= 1) return undefined;

  const currentModel = self.model;
  let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));

  if (currentIndex === -1) currentIndex = 0;
  const len = scopedModels.length;
  const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
  const next = scopedModels[nextIndex];
  const thinkingLevel = self._getThinkingLevelForModelSwitch(next.thinkingLevel);

  // Apply model
  self.agent.state.model = next.model;
  self.sessionManager.appendModelChange(next.model.provider, next.model.id);
  self.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);

  // Apply thinking level.
  // - Explicit scoped model thinking level overrides current session level
  // - Undefined scoped model thinking level inherits the current session preference
  // setThinkingLevel clamps to model capabilities.
  self.setThinkingLevel(thinkingLevel);

  await self._emitModelSelect(next.model, currentModel, "cycle");

  return {
    model: next.model,
    thinkingLevel: self.thinkingLevel,
    isScoped: true,
  };
}

export async function do__cycleAvailableModel(
  self: AgentSession,
  direction: "forward" | "backward",
): Promise<ModelCycleResult | undefined> {
  const availableModels = await self._modelRegistry.getAvailable();
  if (availableModels.length <= 1) return undefined;

  const currentModel = self.model;
  let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));

  if (currentIndex === -1) currentIndex = 0;
  const len = availableModels.length;
  const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
  const nextModel = availableModels[nextIndex];

  const thinkingLevel = self._getThinkingLevelForModelSwitch();
  self.agent.state.model = nextModel;
  self.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
  self.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);

  // Re-clamp thinking level for new model's capabilities
  self.setThinkingLevel(thinkingLevel);

  await self._emitModelSelect(nextModel, currentModel, "cycle");

  return {
    model: nextModel,
    thinkingLevel: self.thinkingLevel,
    isScoped: false,
  };
}
