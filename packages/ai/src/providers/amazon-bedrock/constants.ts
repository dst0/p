import {
  BedrockRuntimeClient,
  type BedrockRuntimeClientConfig,
  ConversationRole,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.ts";
import { AssistantMessageEventStream } from "../../utils/event-stream.ts";
import { createHttpProxyAgentsForTarget } from "../../utils/node-http-proxy.ts";
import { adjustMaxTokensForThinking, buildBaseOptions, clampReasoning } from "../simple-options.ts";
import {
  buildAdditionalModelRequestFields,
  convertToolConfig,
  getConfiguredBedrockRegion,
  getStandardBedrockEndpointRegion,
  hasConfiguredBedrockProfile,
  mapStopReason,
  shouldUseExplicitBedrockEndpoint,
} from "./auth.ts";
import {
  buildSystemPrompt,
  isAnthropicClaudeModel,
  resolveCacheRetention,
  supportsAdaptiveThinking,
} from "./message-conversion.ts";
import {
  addCustomHeadersMiddleware,
  formatBedrockError,
  handleContentBlockDelta,
  handleContentBlockStart,
  handleContentBlockStop,
  handleMetadata,
} from "./request-building.ts";
import { convertMessages } from "./streaming.ts";
import type { BedrockOptions, Block } from "./types.ts";

export const EMPTY_TEXT_PLACEHOLDER = "<empty>";

export const streamBedrock: StreamFunction<"bedrock-converse-stream", BedrockOptions> = (
  model: Model<"bedrock-converse-stream">,
  context: Context,
  options: BedrockOptions = {},
): AssistantMessageEventStream => {
  const stream = new AssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "bedrock-converse-stream" as Api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    const blocks = output.content as Block[];

    const config: BedrockRuntimeClientConfig = {
      profile: options.profile,
    };
    const configuredRegion = getConfiguredBedrockRegion(options);
    const hasConfiguredProfile = hasConfiguredBedrockProfile();
    const endpointRegion = getStandardBedrockEndpointRegion(model.baseUrl);
    const useExplicitEndpoint = shouldUseExplicitBedrockEndpoint(model.baseUrl, configuredRegion, hasConfiguredProfile);

    // Only pin standard AWS Bedrock runtime endpoints when no region/profile is configured.
    // This preserves custom endpoints (VPC/proxy) from #3402 without forcing built-in
    // catalog defaults such as us-east-1 to override AWS_REGION/AWS_PROFILE.
    if (useExplicitEndpoint) {
      config.endpoint = model.baseUrl;
    }

    // Resolve bearer token for Bedrock API key auth.
    const bearerToken = options.bearerToken || process.env.AWS_BEARER_TOKEN_BEDROCK || undefined;
    const useBearerToken = bearerToken !== undefined && process.env.AWS_BEDROCK_SKIP_AUTH !== "1";

    // in Node.js/Bun environment only
    if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
      // Region resolution: ARN-embedded > explicit option > env vars > SDK default chain.
      // When the model ID is an inference profile ARN, extract the region from it.
      // This avoids conflicts with AWS_REGION set for other services.
      const arnRegionMatch = model.id.match(/^arn:aws(?:-[a-z0-9-]+)?:bedrock:([a-z0-9-]+):/);
      if (arnRegionMatch) {
        config.region = arnRegionMatch[1];
      } else if (configuredRegion) {
        config.region = configuredRegion;
      } else if (endpointRegion && useExplicitEndpoint) {
        config.region = endpointRegion;
      } else if (!hasConfiguredProfile) {
        config.region = "us-east-1";
      }

      // Support proxies that don't need authentication
      if (process.env.AWS_BEDROCK_SKIP_AUTH === "1") {
        config.credentials = {
          accessKeyId: "dummy-access-key",
          secretAccessKey: "dummy-secret-key",
        };
      }

      const proxyAgents = createHttpProxyAgentsForTarget(model.baseUrl);
      if (proxyAgents) {
        // Bedrock runtime uses NodeHttp2Handler by default since v3.798.0, which is based
        // on `http2` module and has no support for http agent.
        // Use NodeHttpHandler to support HTTP(S) proxy agents.
        config.requestHandler = new NodeHttpHandler(proxyAgents);
      } else if (process.env.AWS_BEDROCK_FORCE_HTTP1 === "1") {
        // Some custom endpoints require HTTP/1.1 instead of HTTP/2
        config.requestHandler = new NodeHttpHandler();
      }
    } else {
      // Non-Node environment (browser): fall back to us-east-1 since
      // there's no config file resolution available.
      config.region =
        configuredRegion || (endpointRegion && useExplicitEndpoint ? endpointRegion : undefined) || "us-east-1";
    }

    if (useBearerToken) {
      config.token = { token: bearerToken };
      config.authSchemePreference = ["httpBearerAuth"];
    }

    try {
      const client = new BedrockRuntimeClient(config);
      if (options.headers && Object.keys(options.headers).length > 0) {
        addCustomHeadersMiddleware(client, options.headers);
      }
      const cacheRetention = resolveCacheRetention(options.cacheRetention);
      const inferenceMaxTokens = options.maxTokens ?? (isAnthropicClaudeModel(model) ? model.maxTokens : undefined);
      let commandInput = {
        modelId: model.id,
        messages: convertMessages(context, model, cacheRetention),
        system: buildSystemPrompt(context.systemPrompt, model, cacheRetention),
        inferenceConfig: {
          ...(inferenceMaxTokens !== undefined && { maxTokens: inferenceMaxTokens }),
          ...(options.temperature !== undefined && { temperature: options.temperature }),
        },
        toolConfig: convertToolConfig(context.tools, options.toolChoice),
        additionalModelRequestFields: buildAdditionalModelRequestFields(model, options),
        ...(options.requestMetadata !== undefined && { requestMetadata: options.requestMetadata }),
      };
      const nextCommandInput = await options?.onPayload?.(commandInput, model);
      if (nextCommandInput !== undefined) {
        commandInput = nextCommandInput as typeof commandInput;
      }
      const command = new ConverseStreamCommand(commandInput);

      const response = await client.send(command, { abortSignal: options.signal });
      if (response.$metadata.httpStatusCode !== undefined) {
        const responseHeaders: Record<string, string> = {};
        if (response.$metadata.requestId) {
          responseHeaders["x-amzn-requestid"] = response.$metadata.requestId;
        }
        await options?.onResponse?.({ status: response.$metadata.httpStatusCode, headers: responseHeaders }, model);
      }

      for await (const item of response.stream!) {
        if (item.messageStart) {
          if (item.messageStart.role !== ConversationRole.ASSISTANT) {
            throw new Error("Unexpected assistant message start but got user message start instead");
          }
          stream.push({ type: "start", partial: output });
        } else if (item.contentBlockStart) {
          handleContentBlockStart(item.contentBlockStart, blocks, output, stream);
        } else if (item.contentBlockDelta) {
          handleContentBlockDelta(item.contentBlockDelta, blocks, output, stream);
        } else if (item.contentBlockStop) {
          handleContentBlockStop(item.contentBlockStop, blocks, output, stream);
        } else if (item.messageStop) {
          output.stopReason = mapStopReason(item.messageStop.stopReason);
        } else if (item.metadata) {
          handleMetadata(item.metadata, model, output);
        } else if (item.internalServerException) {
          throw item.internalServerException;
        } else if (item.modelStreamErrorException) {
          throw item.modelStreamErrorException;
        } else if (item.validationException) {
          throw item.validationException;
        } else if (item.throttlingException) {
          throw item.throttlingException;
        } else if (item.serviceUnavailableException) {
          throw item.serviceUnavailableException;
        }
      }

      if (options.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      if (output.stopReason === "error" || output.stopReason === "aborted") {
        throw new Error("An unknown error occurred");
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content) {
        delete (block as Block).index;
        // partialJson is only a streaming scratch buffer; never persist it.
        delete (block as Block).partialJson;
      }
      output.stopReason = options.signal?.aborted ? "aborted" : "error";
      output.errorMessage = formatBedrockError(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
};

export const BEDROCK_ERROR_PREFIXES: Record<string, string> = {
  InternalServerException: "Internal server error",
  ModelStreamErrorException: "Model stream error",
  ValidationException: "Validation error",
  ThrottlingException: "Throttling error",
  ServiceUnavailableException: "Service unavailable",
};

export const BEDROCK_DATA_RETENTION_DOCS_URL =
  "https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html";

export const RESERVED_HEADER_EXACT = new Set(["authorization", "host"]);

export const streamSimpleBedrock: StreamFunction<"bedrock-converse-stream", SimpleStreamOptions> = (
  model: Model<"bedrock-converse-stream">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const base = buildBaseOptions(model, options, undefined);
  if (!options?.reasoning) {
    return streamBedrock(model, context, { ...base, reasoning: undefined } satisfies BedrockOptions);
  }

  if (isAnthropicClaudeModel(model)) {
    if (supportsAdaptiveThinking(model.id, model.name)) {
      return streamBedrock(model, context, {
        ...base,
        reasoning: options.reasoning,
        thinkingBudgets: options.thinkingBudgets,
      } satisfies BedrockOptions);
    }

    // Undefined means the caller did not request an output cap; let the helper use the model cap.
    // Do not coerce to 0 here, or the thinking budget would become the entire maxTokens value.
    const adjusted = adjustMaxTokensForThinking(
      base.maxTokens,
      model.maxTokens,
      options.reasoning,
      options.thinkingBudgets,
    );

    return streamBedrock(model, context, {
      ...base,
      maxTokens: adjusted.maxTokens,
      reasoning: options.reasoning,
      thinkingBudgets: {
        ...(options.thinkingBudgets || {}),
        [clampReasoning(options.reasoning)!]: adjusted.thinkingBudget,
      },
    } satisfies BedrockOptions);
  }

  return streamBedrock(model, context, {
    ...base,
    reasoning: options.reasoning,
    thinkingBudgets: options.thinkingBudgets,
  } satisfies BedrockOptions);
};
