import { createHash } from "node:crypto";
import type { Api, Model } from "@dst0/p-ai";

const EXPLICIT_DISABLE_FORMATS = new Set([
  "deepseek",
  "openrouter",
  "qwen",
  "qwen-chat-template",
  "string-thinking",
  "together",
  "zai",
]);

export function getProjectInstructionCompilerReasoningControlIdentity<TApi extends Api>(model: Model<TApi>): string {
  const openAIModel = model as Model<"openai-completions">;
  const control =
    model.reasoning && model.api === "openai-completions"
      ? {
          api: model.api,
          reasoning: true,
          format: openAIModel.compat?.thinkingFormat,
          off: model.thinkingLevelMap?.off,
        }
      : { api: model.api, reasoning: model.reasoning === true };
  return `reasoning-control-sha256=${createHash("sha256").update(JSON.stringify(control)).digest("hex")}`;
}

export function enforceProjectInstructionCompilerReasoningControl<TApi extends Api>(model: Model<TApi>): Model<TApi> {
  if (!model.reasoning || model.api !== "openai-completions") return model;
  const openAIModel = model as Model<"openai-completions">;
  if (model.thinkingLevelMap?.off === null) {
    throw new Error("Project instruction compiler model does not support thinking off");
  }
  const format = openAIModel.compat?.thinkingFormat;
  if (format && EXPLICIT_DISABLE_FORMATS.has(format)) return model;
  if (format === "openai" && typeof model.thinkingLevelMap?.off === "string") {
    return model;
  }
  throw new Error("Project instruction compiler model lacks explicit thinking-disable compatibility");
}
