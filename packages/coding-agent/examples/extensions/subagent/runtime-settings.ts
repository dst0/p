import type { ThinkingLevel } from "@dst0/p-agent-core";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

interface SubagentRuntimeProfile {
  model?: string;
  thinking?: ThinkingLevel;
  tools?: string[];
}

export interface SubagentRuntimeSettings {
  model?: string;
  thinking?: ThinkingLevel;
}

export function parseSubagentThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
  return value && THINKING_LEVELS.has(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;
}

export function formatParentModel(model: { provider: string; id: string } | undefined): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

export function resolveSubagentRuntimeSettings(
  profile: SubagentRuntimeProfile,
  parentModel: string | undefined,
  parentThinking: ThinkingLevel | undefined,
): SubagentRuntimeSettings {
  return {
    model: profile.model ?? parentModel,
    thinking: profile.thinking ?? parentThinking,
  };
}

export function appendSubagentRuntimeArguments(
  args: string[],
  profile: SubagentRuntimeProfile,
  parentModel: string | undefined,
  parentThinking: ThinkingLevel | undefined,
): SubagentRuntimeSettings {
  const settings = resolveSubagentRuntimeSettings(profile, parentModel, parentThinking);
  if (settings.model) args.push("--model", settings.model);
  if (profile.tools && profile.tools.length > 0) args.push("--tools", profile.tools.join(","));
  if (settings.thinking !== undefined) args.push("--thinking", settings.thinking);
  return settings;
}
