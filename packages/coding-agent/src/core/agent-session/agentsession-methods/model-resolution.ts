import type { AgentMessage } from "@dst0/p-agent-core";
import { getImageModel, getImageModels, getImageProviders, type ImagesApi, type ImagesModel } from "@dst0/p-ai";
import type { AgentSession } from "../agentsession.ts";

export async function do__runAgentPrompt(self: AgentSession, messages: AgentMessage | AgentMessage[]): Promise<void> {
  try {
    await self.agent.prompt(messages);
    while (await self._handlePostAgentRun()) {
      await self.agent.continue();
    }
  } finally {
    self._flushPendingBashMessages();
  }
}

export async function do__handlePostAgentRun(self: AgentSession): Promise<boolean> {
  const msg = self._lastAssistantMessage;
  self._lastAssistantMessage = undefined;
  if (!msg) {
    return false;
  }

  if (self._isRetryableError(msg) && (await self._prepareRetry(msg))) {
    return true;
  }

  if (msg.stopReason === "error" && self._retryAttempt > 0) {
    self._emit({
      type: "auto_retry_end",
      success: false,
      attempt: self._retryAttempt,
      finalError: msg.errorMessage,
    });
    self._retryAttempt = 0;
  }

  if (await self.checkCompaction(msg)) {
    return true;
  }

  // The agent loop drains both queues before emitting agent_end. Any messages
  // here were queued by agent_end extension handlers and need a continuation.
  return self.agent.hasQueuedMessages();
}

export interface ResolvedImageModel {
  model: ImagesModel<ImagesApi>;
  apiKey?: string;
  headers?: Record<string, string>;
}

export function do_getImageModel(self: AgentSession): ImagesModel<ImagesApi> | undefined {
  return self._imageModel;
}

export function do_setImageModel(self: AgentSession, model: ImagesModel<ImagesApi>): void {
  self._imageModel = model;
}

export async function do_resolveImageModel(self: AgentSession): Promise<ResolvedImageModel | undefined> {
  let model = self._imageModel;

  if (!model) {
    const defaultProvider = self.settingsManager.getDefaultImageProvider();
    const defaultModelId = self.settingsManager.getDefaultImageModel();
    if (defaultProvider && defaultModelId) {
      const configuredProviderModel = self.modelRegistry
        .getAll()
        .find((candidate) => candidate.provider === defaultProvider);
      model = getImageModel(defaultProvider, defaultModelId, {
        ...(configuredProviderModel?.baseUrl ? { baseUrl: configuredProviderModel.baseUrl } : {}),
        ...(configuredProviderModel?.headers ? { headers: configuredProviderModel.headers } : {}),
      });
    }
  }

  if (!model) {
    const providers = getImageProviders();
    for (const provider of providers) {
      const apiKey = await self.modelRegistry.getApiKeyForProvider(provider);
      if (apiKey) {
        const available = getImageModels(provider);
        if (available.length > 0) {
          model = available[0];
          break;
        }
      }
    }
  }

  if (!model) {
    return undefined;
  }

  const configuredProviderModel = self.modelRegistry
    .getAll()
    .find((candidate) => candidate.provider === model.provider);
  if (configuredProviderModel) {
    const auth = await self.modelRegistry.getApiKeyAndHeaders(configuredProviderModel);
    if (!auth.ok) throw new Error(auth.error);
    return {
      model,
      apiKey: auth.apiKey,
      headers: auth.headers,
    };
  }

  const apiKey = await self.modelRegistry.getApiKeyForProvider(model.provider);
  return { model, apiKey };
}
