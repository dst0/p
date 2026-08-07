import {
  StopReason as BedrockStopReason,
  type Tool as BedrockTool,
  type ToolChoice,
  type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import type { Model, StopReason, ThinkingLevel, Tool } from "../../types.ts";
import { isAnthropicClaudeModel, mapThinkingLevelToEffort, supportsAdaptiveThinking } from "./helpers-part2.ts";
import type { BedrockOptions } from "./types.ts";

export function convertToolConfig(
  tools: Tool[] | undefined,
  toolChoice: BedrockOptions["toolChoice"],
): ToolConfiguration | undefined {
  if (!tools?.length || toolChoice === "none") return undefined;

  const bedrockTools: BedrockTool[] = tools.map((tool) => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: tool.parameters as unknown as DocumentType },
    },
  }));

  let bedrockToolChoice: ToolChoice | undefined;
  switch (toolChoice) {
    case "auto":
      bedrockToolChoice = { auto: {} };
      break;
    case "any":
      bedrockToolChoice = { any: {} };
      break;
    default:
      if (toolChoice?.type === "tool") {
        bedrockToolChoice = { tool: { name: toolChoice.name } };
      }
  }

  return { tools: bedrockTools, toolChoice: bedrockToolChoice };
}

export function mapStopReason(reason: string | undefined): StopReason {
  switch (reason) {
    case BedrockStopReason.END_TURN:
    case BedrockStopReason.STOP_SEQUENCE:
      return "stop";
    case BedrockStopReason.MAX_TOKENS:
    case BedrockStopReason.MODEL_CONTEXT_WINDOW_EXCEEDED:
      return "length";
    case BedrockStopReason.TOOL_USE:
      return "toolUse";
    default:
      return "error";
  }
}

export function getConfiguredBedrockRegion(options: BedrockOptions): string | undefined {
  if (typeof process === "undefined") {
    return options.region;
  }

  return options.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || undefined;
}

export function hasConfiguredBedrockProfile(): boolean {
  if (typeof process === "undefined") {
    return false;
  }

  return Boolean(process.env.AWS_PROFILE);
}

export function getStandardBedrockEndpointRegion(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  try {
    const { hostname } = new URL(baseUrl);
    const match = hostname.toLowerCase().match(/^bedrock-runtime(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function shouldUseExplicitBedrockEndpoint(
  baseUrl: string,
  configuredRegion: string | undefined,
  hasConfiguredProfile: boolean,
): boolean {
  const endpointRegion = getStandardBedrockEndpointRegion(baseUrl);
  if (!endpointRegion) {
    return true;
  }

  return !configuredRegion && !hasConfiguredProfile;
}

export function isGovCloudBedrockTarget(model: Model<"bedrock-converse-stream">, options: BedrockOptions): boolean {
  const region = getConfiguredBedrockRegion(options);
  if (region?.toLowerCase().startsWith("us-gov-")) {
    return true;
  }

  const modelId = model.id.toLowerCase();
  return modelId.startsWith("us-gov.") || modelId.startsWith("arn:aws-us-gov:");
}

export function buildAdditionalModelRequestFields(
  model: Model<"bedrock-converse-stream">,
  options: BedrockOptions,
): Record<string, any> | undefined {
  if (!options.reasoning || !model.reasoning) {
    return undefined;
  }

  if (isAnthropicClaudeModel(model)) {
    // GovCloud Bedrock currently rejects the Claude thinking.display field.
    // Omit it there until the GovCloud Converse schema catches up.
    const display = isGovCloudBedrockTarget(model, options) ? undefined : (options.thinkingDisplay ?? "summarized");
    const result: Record<string, any> = supportsAdaptiveThinking(model.id, model.name)
      ? {
          thinking: { type: "adaptive", ...(display !== undefined ? { display } : {}) },
          output_config: { effort: mapThinkingLevelToEffort(model, options.reasoning) },
        }
      : (() => {
          const defaultBudgets: Record<ThinkingLevel, number> = {
            minimal: 1024,
            low: 2048,
            medium: 8192,
            high: 16384,
            xhigh: 16384, // Claude doesn't support xhigh, clamp to high
          };

          // Custom budgets override defaults (xhigh not in ThinkingBudgets, use high)
          const level = options.reasoning === "xhigh" ? "high" : options.reasoning;
          const budget = options.thinkingBudgets?.[level] ?? defaultBudgets[options.reasoning];

          return {
            thinking: {
              type: "enabled",
              budget_tokens: budget,
              ...(display !== undefined ? { display } : {}),
            },
          };
        })();

    if (!supportsAdaptiveThinking(model.id, model.name) && (options.interleavedThinking ?? true)) {
      result.anthropic_beta = ["interleaved-thinking-2025-05-14"];
    }

    return result;
  }

  return undefined;
}
