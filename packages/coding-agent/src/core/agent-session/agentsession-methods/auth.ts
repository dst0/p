import type { AgentMessage, ThinkingLevel } from "@dst0/p-agent-core";
import type { Model } from "@dst0/p-ai";
import { clampThinkingLevel, modelsAreEqual, streamSimple } from "@dst0/p-ai";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "../../auth-guidance.ts";
import { estimateContextTokens } from "../../compaction/index.ts";
import type { AgentSession } from "../agentsession.ts";

export async function do__getRequiredRequestAuth(
  self: AgentSession,
  model: Model<any>,
): Promise<{
  apiKey: string;
  headers?: Record<string, string>;
}> {
  const result = await self._modelRegistry.getApiKeyAndHeaders(model);
  if (!result.ok) {
    if (result.error.startsWith("No API key found")) {
      throw new Error(formatNoApiKeyFoundMessage(model.provider));
    }
    throw new Error(result.error);
  }
  if (result.apiKey) {
    return { apiKey: result.apiKey, headers: result.headers };
  }

  const isOAuth = self._modelRegistry.isUsingOAuth(model);
  if (isOAuth) {
    throw new Error(
      `Authentication failed for "${model.provider}". ` +
        `Credentials may have expired or network is unavailable. ` +
        `Run '/login ${model.provider}' to re-authenticate.`,
    );
  }
  throw new Error(formatNoApiKeyFoundMessage(model.provider));
}

export async function do__getCompactionRequestAuth(
  self: AgentSession,
  model: Model<any>,
): Promise<{
  apiKey?: string;
  headers?: Record<string, string>;
}> {
  if (self.agent.streamFn === streamSimple) {
    return self._getRequiredRequestAuth(model);
  }

  const result = await self._modelRegistry.getApiKeyAndHeaders(model);
  return result.ok ? { apiKey: result.apiKey, headers: result.headers } : {};
}

export function do__getServiceModelRequest(
  self: AgentSession,
  minContextTokens = 0,
): {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
} {
  const fallbackModel = self.model;
  if (!fallbackModel) {
    throw new Error(formatNoModelSelectedMessage());
  }

  const selection = self.settingsManager.getServiceModelSelection();
  let selectedModel: Model<any> | undefined;
  if (selection.provider && selection.modelId) {
    selectedModel = self._modelRegistry.find(selection.provider, selection.modelId);
  } else if (selection.modelId) {
    selectedModel = self._modelRegistry.find(fallbackModel.provider, selection.modelId);
  }

  if (selectedModel) {
    const hasEnoughContext =
      minContextTokens <= 0 || selectedModel.contextWindow <= 0 || selectedModel.contextWindow >= minContextTokens;
    if (hasEnoughContext) {
      return {
        model: selectedModel,
        thinkingLevel: clampThinkingLevel(selectedModel, selection.thinkingLevel ?? "off") as ThinkingLevel,
      };
    }
  }

  return {
    model: fallbackModel,
    thinkingLevel: self.thinkingLevel,
  };
}

export async function do__getServiceAuthWithCurrentFallback(
  self: AgentSession,
  request: {
    model: Model<any>;
    thinkingLevel: ThinkingLevel;
  },
): Promise<{
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  apiKey?: string;
  headers?: Record<string, string>;
}> {
  try {
    const { apiKey, headers } = await self._getCompactionRequestAuth(request.model);
    return { ...request, apiKey, headers };
  } catch (err) {
    if (!self.model || modelsAreEqual(request.model, self.model)) {
      throw err;
    }
    const { apiKey, headers } = await self._getCompactionRequestAuth(self.model);
    return {
      model: self.model,
      thinkingLevel: self.thinkingLevel,
      apiKey,
      headers,
    };
  }
}

export function do__getFastResponderModelRequest(self: AgentSession):
  | {
      model: Model<string>;
      thinkingLevel: ThinkingLevel;
    }
  | undefined {
  const settings = self.settingsManager.getFastResponderSettings();
  if (!settings.enabled || !settings.modelId) {
    return undefined;
  }

  const fallbackModel = self.model;
  if (!fallbackModel) {
    return undefined;
  }

  const selectedModel = settings.provider
    ? self._modelRegistry.find(settings.provider, settings.modelId)
    : self._modelRegistry.find(fallbackModel.provider, settings.modelId);
  if (!selectedModel) {
    return undefined;
  }

  return {
    model: selectedModel,
    thinkingLevel: clampThinkingLevel(selectedModel, settings.thinkingLevel ?? "off"),
  };
}

export function do__shouldRunFastResponder(self: AgentSession, messages: AgentMessage[]): boolean {
  const settings = self.settingsManager.getFastResponderSettings();
  if (!settings.enabled) {
    return false;
  }
  if (!self._getFastResponderModelRequest()) {
    return false;
  }
  const promptTokens = estimateContextTokens(messages, self.systemPrompt, { useProviderUsage: false }).tokens;
  if (promptTokens < settings.minContextTokens) {
    return false;
  }
  const lastAssistant = self._findLastAssistantMessage();
  return !lastAssistant || lastAssistant.stopReason === "error" || lastAssistant.usage.cacheRead === 0;
}
