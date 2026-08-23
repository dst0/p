import type { Api, Model } from "@dst0/p-ai";
import type { ModelRegistry } from "../model-registry.ts";
import type { SessionManager } from "../session-manager.ts";
import type { ProjectInstructionCompiler, ProjectInstructionDeliveryMode } from "./types.ts";

const COMPILER_MODEL_ENTRY_TYPE = "project_instruction_compiler_model";

export function resolveProjectInstructionCompilerModel(reference: string, modelRegistry: ModelRegistry): Model<Api> {
  const normalized = reference.trim();
  const separator = normalized.indexOf("/");
  if (separator < 1 || separator === normalized.length - 1) {
    throw new Error("Project instruction compiler model must use exact provider/id syntax");
  }
  const provider = normalized.slice(0, separator);
  const modelId = normalized.slice(separator + 1);
  const model = modelRegistry.find(provider, modelId);
  if (!model) {
    throw new Error(
      `Project instruction compiler model "${normalized}" is unavailable; use provider/id from --list-models`,
    );
  }
  if (!modelRegistry.hasConfiguredAuth(model)) {
    throw new Error(`Project instruction compiler model "${normalized}" has no configured authentication`);
  }
  return model;
}

export function resolveSessionProjectInstructionCompilerModel(options: {
  reference?: string;
  customCompiler?: ProjectInstructionCompiler;
  mode: ProjectInstructionDeliveryMode;
  modelRegistry: ModelRegistry;
  sessionManager: SessionManager;
}): Model<Api> | undefined {
  if (options.reference && options.customCompiler) {
    throw new Error("projectInstructionCompilerModel cannot be combined with projectInstructionCompiler");
  }
  if (options.reference && options.mode !== "compiled") {
    throw new Error("projectInstructionCompilerModel requires compiled project-instruction mode");
  }
  const reference =
    options.reference ??
    (options.mode === "compiled" && !options.customCompiler
      ? getPersistedProjectInstructionCompilerModel(options.sessionManager)
      : undefined);
  if (!reference) return undefined;
  const model = resolveProjectInstructionCompilerModel(reference, options.modelRegistry);
  persistProjectInstructionCompilerModel(options.sessionManager, `${model.provider}/${model.id}`);
  return model;
}

export function getPersistedProjectInstructionCompilerModel(sessionManager: SessionManager): string | undefined {
  const branch = sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index]!;
    if (
      entry.type === "custom" &&
      entry.customType === COMPILER_MODEL_ENTRY_TYPE &&
      isRecord(entry.data) &&
      typeof entry.data.reference === "string"
    ) {
      return entry.data.reference;
    }
  }
  return undefined;
}

export function persistProjectInstructionCompilerModel(sessionManager: SessionManager, reference: string): void {
  if (getPersistedProjectInstructionCompilerModel(sessionManager) === reference) return;
  sessionManager.appendCustomEntry(COMPILER_MODEL_ENTRY_TYPE, { reference });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
