import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import type { Api, Model } from "@dst0/p-ai";
import type { ModelRegistry } from "../model-registry.ts";
import { buildRuleIndex } from "../project-rules.ts";
import { mergeProviderAttributionHeaders } from "../provider-attribution.ts";
import type { ResourceLoader } from "../resource-loader.ts";
import type { SettingsManager } from "../settings-manager.ts";
import { buildProjectInstructionCompilerModelIdentity } from "./compiler-reasoning-control.ts";
import { createProjectInstructionController } from "./controller.ts";
import { compileProjectInstructionsWithModel } from "./model-compiler.ts";
import type { ProjectInstructionCompiler, ProjectInstructionController } from "./types.ts";

interface CreateSessionProjectInstructionControllerOptions {
  cwd: string;
  resourceLoader: ResourceLoader;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  getModel(): Model<Api> | undefined;
  compilerModel?: Model<Api>;
  compiler?: ProjectInstructionCompiler;
  compilerIdentity?: string;
}

const DEFAULT_COMPILER_FAILURE_BACKOFF_MS = 5 * 60_000;
export const DEFAULT_MODEL_COMPILER_CONTRACT_REVISION = "exact-source-v10-sparse-scope-calibration";

export async function createSessionProjectInstructionController(
  options: CreateSessionProjectInstructionControllerOptions,
): Promise<ProjectInstructionController> {
  const compiler =
    options.compiler ??
    (async (request) => {
      const model = options.compilerModel ?? options.getModel();
      if (!model) throw new Error("No model is available to compile project instructions");
      const auth = await options.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) throw new Error(auth.error);
      const configuredTimeout = options.settingsManager.getHttpIdleTimeoutMs();
      return compileProjectInstructionsWithModel(request, {
        model,
        apiKey: auth.apiKey,
        headers: mergeProviderAttributionHeaders(model, options.settingsManager, undefined, auth.headers),
        timeoutMs: configuredTimeout === 0 ? 60_000 : configuredTimeout,
      });
    });
  const customCompilerIdentity = options.compilerIdentity?.trim() || `sdk-custom-ephemeral:${randomUUID()}`;
  const controller = createProjectInstructionController({
    cwd: options.cwd,
    getContextFiles: () => collectProjectInstructionSources(options.cwd, options.resourceLoader),
    getSkills: () => options.resourceLoader.getSkills().skills,
    compiler,
    getCompilerIdentity: () => {
      if (options.compiler) return customCompilerIdentity;
      const model = options.compilerModel ?? options.getModel();
      return model
        ? buildProjectInstructionCompilerModelIdentity(model, DEFAULT_MODEL_COMPILER_CONTRACT_REVISION)
        : "no-model";
    },
    compilerFailureBackoffMs: options.compiler ? undefined : DEFAULT_COMPILER_FAILURE_BACKOFF_MS,
  });
  await controller.refresh();
  return controller;
}

function collectProjectInstructionSources(
  cwd: string,
  resourceLoader: ResourceLoader,
): Array<{ path: string; content: string }> {
  const sources = resourceLoader.getAgentsFiles().agentsFiles.map((source) => ({ ...source }));
  const seen = new Set(sources.map((source) => canonicalPath(source.path)));
  for (const file of buildRuleIndex(cwd).files) {
    const canonical = canonicalPath(file.path);
    if (seen.has(canonical)) continue;
    sources.push({ path: canonical, content: readFileSync(canonical, "utf8") });
    seen.add(canonical);
  }
  return sources;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
