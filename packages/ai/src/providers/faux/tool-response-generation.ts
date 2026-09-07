import { registerApiProviderExclusive, unregisterApiProviders } from "../../api-registry.ts";
import type { Model, SimpleStreamOptions, StreamFunction, StreamOptions } from "../../types.ts";
import { createAssistantMessageEventStream } from "../../utils/event-stream.ts";
import {
  DEFAULT_API,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_TOKEN_SIZE,
  DEFAULT_MIN_TOKEN_SIZE,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_NAME,
  DEFAULT_PROVIDER,
} from "./constants.ts";
import { cloneMessage, createErrorMessage, withUsageEstimate } from "./message-playback.ts";
import { hideFauxRuntimeContext, randomId } from "./scenario-parsing.ts";
import { streamWithDeltas } from "./streaming-simulation.ts";
import type { FauxProviderRegistration, FauxResponseStep, RegisterFauxProviderOptions } from "./types.ts";

export function registerFauxProvider(options: RegisterFauxProviderOptions = {}): FauxProviderRegistration {
  const api = options.api ?? randomId(DEFAULT_API);
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const sourceId = randomId("faux-provider");
  const minTokenSize = Math.max(
    1,
    Math.min(options.tokenSize?.min ?? DEFAULT_MIN_TOKEN_SIZE, options.tokenSize?.max ?? DEFAULT_MAX_TOKEN_SIZE),
  );
  const maxTokenSize = Math.max(minTokenSize, options.tokenSize?.max ?? DEFAULT_MAX_TOKEN_SIZE);
  let pendingResponses: FauxResponseStep[] = [];
  const tokensPerSecond = options.tokensPerSecond;
  const state = { callCount: 0 };
  const promptCache = new Map<string, string>();

  const modelDefinitions = options.models?.length
    ? options.models
    : [
        {
          id: DEFAULT_MODEL_ID,
          name: DEFAULT_MODEL_NAME,
          reasoning: false,
          input: ["text", "image"] as ("text" | "image")[],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ];
  const models = modelDefinitions.map((definition) => ({
    id: definition.id,
    name: definition.name ?? definition.id,
    api,
    provider,
    baseUrl: DEFAULT_BASE_URL,
    reasoning: definition.reasoning ?? false,
    input: definition.input ?? ["text", "image"],
    cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: definition.contextWindow ?? 128000,
    maxTokens: definition.maxTokens ?? 16384,
  })) as [Model<string>, ...Model<string>[]];

  const stream: StreamFunction<string, StreamOptions> = (requestModel, context, streamOptions) => {
    const outer = createAssistantMessageEventStream();
    const step = pendingResponses.shift();
    state.callCount++;

    queueMicrotask(async () => {
      try {
        await streamOptions?.onResponse?.({ status: 200, headers: {} }, requestModel);
        if (!step) {
          let message = createErrorMessage(new Error("No more faux responses queued"), api, provider, requestModel.id);
          message = withUsageEstimate(message, context, streamOptions, promptCache);
          outer.push({ type: "error", reason: "error", error: message });
          outer.end(message);
          return;
        }

        const fauxContext = hideFauxRuntimeContext(context);
        const resolved =
          typeof step === "function" ? await step(fauxContext, streamOptions, state, requestModel) : step;
        let message = cloneMessage(resolved, api, provider, requestModel.id);
        message = withUsageEstimate(message, fauxContext, streamOptions, promptCache);
        await streamWithDeltas(outer, message, minTokenSize, maxTokenSize, tokensPerSecond, streamOptions?.signal);
      } catch (error) {
        const message = createErrorMessage(error, api, provider, requestModel.id);
        outer.push({ type: "error", reason: "error", error: message });
        outer.end(message);
      }
    });

    return outer;
  };

  const streamSimple: StreamFunction<string, SimpleStreamOptions> = (streamModel, context, streamOptions) =>
    stream(streamModel, context, streamOptions);

  const register = () =>
    registerApiProviderExclusive({ api, stream, streamSimple }, sourceId, {
      preserveOnReset: options.preserveOnReset,
    });
  if (options.registerImmediately ?? true) register();

  function getModel(): Model<string>;
  function getModel(requestedModelId: string): Model<string> | undefined;
  function getModel(requestedModelId?: string): Model<string> | undefined {
    if (!requestedModelId) {
      return models[0];
    }
    return models.find((candidate) => candidate.id === requestedModelId);
  }

  return {
    api,
    models,
    register,
    getModel,
    state,
    setResponses(responses) {
      pendingResponses = [...responses];
    },
    appendResponses(responses) {
      pendingResponses.push(...responses);
    },
    getPendingResponseCount() {
      return pendingResponses.length;
    },
    unregister() {
      unregisterApiProviders(sourceId);
    },
  };
}
