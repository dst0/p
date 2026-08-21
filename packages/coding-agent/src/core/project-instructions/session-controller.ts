import type { Api, Model } from "@dst0/p-ai";
import type { ModelRegistry } from "../model-registry.ts";
import { mergeProviderAttributionHeaders } from "../provider-attribution.ts";
import type { ResourceLoader } from "../resource-loader.ts";
import type { SettingsManager } from "../settings-manager.ts";
import { createProjectInstructionController } from "./controller.ts";
import { compileProjectInstructionsWithModel } from "./model-compiler.ts";
import type { ProjectInstructionCompiler, ProjectInstructionController } from "./types.ts";

interface CreateSessionProjectInstructionControllerOptions {
  cwd: string;
  resourceLoader: ResourceLoader;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  getModel(): Model<Api> | undefined;
  compiler?: ProjectInstructionCompiler;
}

const DEFAULT_COMPILER_FAILURE_BACKOFF_MS = 5 * 60_000;

export async function createSessionProjectInstructionController(
  options: CreateSessionProjectInstructionControllerOptions,
): Promise<ProjectInstructionController> {
  const compiler =
    options.compiler ??
    (async (request) => {
      const model = options.getModel();
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
  const controller = createProjectInstructionController({
    cwd: options.cwd,
    getContextFiles: () => options.resourceLoader.getAgentsFiles().agentsFiles,
    getSkills: () => options.resourceLoader.getSkills().skills,
    compiler,
    getCompilerIdentity: () => {
      if (options.compiler) return "sdk-custom";
      const model = options.getModel();
      return model ? `${model.provider}/${model.id}` : "no-model";
    },
    compilerFailureBackoffMs: options.compiler ? undefined : DEFAULT_COMPILER_FAILURE_BACKOFF_MS,
  });
  await controller.refresh();
  return controller;
}
