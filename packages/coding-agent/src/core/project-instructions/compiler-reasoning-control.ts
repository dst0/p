import { createHash } from "node:crypto";
import type { Api, Model, ModelThinkingLevel } from "@dst0/p-ai";

export function getProjectInstructionCompilerReasoningControlIdentity<TApi extends Api>(
  model: Model<TApi>,
  requestedThinkingLevel?: ModelThinkingLevel,
): string {
  const openAIModel = model as Model<"openai-completions">;
  const thinkingLevelMap = model.thinkingLevelMap;
  const mapping = (level: ModelThinkingLevel | undefined): string | null | "unset" => {
    if (!level) return null;
    if (!thinkingLevelMap || !Object.hasOwn(thinkingLevelMap, level)) return "unset";
    return thinkingLevelMap[level] ?? null;
  };
  const control = {
    api: model.api,
    reasoning: model.reasoning === true,
    requestedThinkingLevel: requestedThinkingLevel ?? null,
    requestedMapping: mapping(requestedThinkingLevel),
    offMapping: mapping("off"),
    format: model.api === "openai-completions" ? (openAIModel.compat?.thinkingFormat ?? null) : null,
    supportsReasoningEffort:
      model.api === "openai-completions" ? (openAIModel.compat?.supportsReasoningEffort ?? null) : null,
  };
  return `reasoning-control-sha256=${createHash("sha256").update(JSON.stringify(control)).digest("hex")}`;
}

/**
 * Keep compiler model selection permissive. The compiler validates the final text
 * envelope and never persists thinking blocks, so missing provider-specific
 * thinking metadata must not make compiled delivery unavailable.
 */
export function enforceProjectInstructionCompilerReasoningControl<TApi extends Api>(model: Model<TApi>): Model<TApi> {
  return model;
}
