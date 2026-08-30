import { getImageModel, type ImagesApi, type ImagesModel, type Model } from "@dst0/p-ai";
import { findExactModelReferenceMatch } from "../../../../core/model-resolver.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../../../../core/trust-manager.ts";
import { ImageModelSelectorComponent } from "../../components/image-model-selector.ts";
import { ToolExecutionComponent } from "../../components/tool-execution.ts";
import { TrustSelectorComponent } from "../../components/trust-selector.ts";
import { ANTHROPIC_SUBSCRIPTION_AUTH_WARNING } from "../constants.ts";
import { isAnthropicSubscriptionAuthKey } from "../helpers.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_setShowHarnessMessages(self: InteractiveMode, enabled: boolean): void {
  self.settingsManager.setShowHarnessMessages(enabled);
  for (const child of self.chatContainer.children) {
    if (child instanceof ToolExecutionComponent) {
      child.setShowHarnessMessages(enabled);
    }
  }
  self.rebuildChatFromMessages();
  self.ui.requestRender();
}

export async function do_handleModelCommand(self: InteractiveMode, searchTerm?: string): Promise<void> {
  if (!searchTerm) {
    self.showModelSelector();
    return;
  }

  const model = await self.findExactModelMatch(searchTerm);
  if (model) {
    try {
      const previousModel = self.session.model;
      await self.session.setModel(model);
      self.noteModelSwitch(previousModel, model);
      self.footer.invalidate();
      self.updateEditorBorderColor();
      self.showStatus(`Model: ${model.id}`);
      void self.maybeWarnAboutAnthropicSubscriptionAuth(model);
      self.checkDaxnutsEasterEgg(model);
    } catch (error) {
      self.showError(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  self.showModelSelector(searchTerm);
}

export async function do_findExactModelMatch(
  self: InteractiveMode,
  searchTerm: string,
): Promise<Model<any> | undefined> {
  const models = await self.getModelCandidates();
  return findExactModelReferenceMatch(searchTerm, models);
}

export async function do_getModelCandidates(self: InteractiveMode): Promise<Model<any>[]> {
  if (self.session.scopedModels.length > 0) {
    return self.session.scopedModels.map((scoped) => scoped.model);
  }

  self.session.modelRegistry.refresh();
  try {
    return await self.session.modelRegistry.getAvailable();
  } catch {
    return [];
  }
}

export async function do_updateAvailableProviderCount(self: InteractiveMode): Promise<void> {
  const models = await self.getModelCandidates();
  const uniqueProviders = new Set(models.map((m) => m.provider));
  self.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
}

export async function do_maybeWarnAboutAnthropicSubscriptionAuth(
  self: InteractiveMode,
  model: Model<any> | undefined = self.session.model,
): Promise<void> {
  if (self.settingsManager.getWarnings().anthropicExtraUsage === false) {
    return;
  }
  if (self.anthropicSubscriptionWarningShown) {
    return;
  }
  if (!model || model.provider !== "anthropic") {
    return;
  }

  const storedCredential = self.session.modelRegistry.authStorage.get("anthropic");
  if (storedCredential?.type === "oauth") {
    self.anthropicSubscriptionWarningShown = true;
    self.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
    return;
  }

  try {
    const apiKey = await self.session.modelRegistry.getApiKeyForProvider(model.provider);
    if (!isAnthropicSubscriptionAuthKey(apiKey)) {
      return;
    }
    self.anthropicSubscriptionWarningShown = true;
    self.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
  } catch {
    // Ignore auth lookup failures for warning-only checks.
  }
}

export function do_maybeSaveImplicitProjectTrustAfterReload(self: InteractiveMode): boolean {
  const cwd = self.sessionManager.getCwd();
  if (self.autoTrustOnReloadCwd !== cwd) {
    return false;
  }
  if (!self.settingsManager.isProjectTrusted() || !hasTrustRequiringProjectResources(cwd)) {
    return false;
  }

  const trustStore = new ProjectTrustStore(self.runtimeHost.services.agentDir);
  try {
    if (trustStore.get(cwd) !== null) {
      self.autoTrustOnReloadCwd = undefined;
      return false;
    }
    trustStore.set(cwd, true);
    self.autoTrustOnReloadCwd = undefined;
    return true;
  } catch (error) {
    self.showWarning(
      `Could not save project trust after reload: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

export function do_showTrustSelector(self: InteractiveMode): void {
  const cwd = self.sessionManager.getCwd();
  const trustStore = new ProjectTrustStore(self.runtimeHost.services.agentDir);
  const savedDecision = trustStore.getEntry(cwd);
  self.showSelector((done) => {
    const selector = new TrustSelectorComponent({
      cwd,
      savedDecision,
      projectTrusted: self.settingsManager.isProjectTrusted(),
      onSelect: (selection) => {
        trustStore.setMany(selection.updates);
        done();
        self.showStatus(
          `Saved trust decision: ${selection.trusted ? "trusted" : "untrusted"}. Restart p for this to take effect.`,
        );
      },
      onCancel: () => {
        done();
        self.ui.requestRender();
      },
    });
    return { component: selector, focus: selector };
  });
}

export async function do_handleImageModelCommand(self: InteractiveMode, searchTerm?: string): Promise<void> {
  self.showImageModelSelector(searchTerm);
}

function configuredDefaultImageModel(self: InteractiveMode): ImagesModel<ImagesApi> | undefined {
  const provider = self.settingsManager.getDefaultImageProvider();
  const modelId = self.settingsManager.getDefaultImageModel();
  if (!provider || !modelId) return undefined;
  const configuredProviderModel = self.session.modelRegistry
    .getAll()
    .find((candidate) => candidate.provider === provider);
  return getImageModel(provider, modelId, {
    ...(configuredProviderModel?.baseUrl ? { baseUrl: configuredProviderModel.baseUrl } : {}),
    ...(configuredProviderModel?.headers ? { headers: configuredProviderModel.headers } : {}),
  });
}

export function do_showImageModelSelector(self: InteractiveMode, searchTerm?: string): void {
  self.showSelector((done) => {
    const selector = new ImageModelSelectorComponent(
      self.ui,
      self.session.getImageModel() ?? configuredDefaultImageModel(self),
      (model) => {
        self.session.setImageModel(model);
        self.settingsManager.setDefaultImageModelAndProvider(model.provider, model.id);
        done();
        self.showStatus(`Image Model: ${model.provider}/${model.id}`);
      },
      () => {
        done();
        self.ui.requestRender();
      },
      searchTerm,
    );
    return { component: selector, focus: selector };
  });
}
