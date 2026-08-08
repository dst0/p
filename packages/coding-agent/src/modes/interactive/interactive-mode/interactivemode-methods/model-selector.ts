import { resolveModelScope } from "../../../../core/model-resolver.ts";
import { ModelSelectorComponent } from "../../components/model-selector.ts";
import { ScopedModelsSelectorComponent } from "../../components/scoped-models-selector.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_showModelSelector(self: InteractiveMode, initialSearchInput?: string): void {
  self.showSelector((done) => {
    const selector = new ModelSelectorComponent(
      self.ui,
      self.session.model,
      self.settingsManager,
      self.session.modelRegistry,
      self.session.scopedModels,
      async (model) => {
        try {
          const previousModel = self.session.model;
          await self.session.setModel(model);
          self.noteModelSwitch(previousModel, model);
          self.footer.invalidate();
          self.updateEditorBorderColor();
          done();
          self.showStatus(`Model: ${model.id}`);
          void self.maybeWarnAboutAnthropicSubscriptionAuth(model);
          self.checkDaxnutsEasterEgg(model);
        } catch (error) {
          done();
          self.showError(error instanceof Error ? error.message : String(error));
        }
      },
      () => {
        done();
        self.ui.requestRender();
      },
      initialSearchInput,
    );
    return { component: selector, focus: selector };
  });
}

export async function do_showModelsSelector(self: InteractiveMode): Promise<void> {
  // Get all available models
  self.session.modelRegistry.refresh();
  const allModels = self.session.modelRegistry.getAvailable();

  if (allModels.length === 0) {
    self.showStatus("No models available");
    return;
  }

  // Check if session has scoped models (from previous session-only changes or CLI --models)
  const sessionScopedModels = self.session.scopedModels;
  const hasSessionScope = sessionScopedModels.length > 0;

  // Build enabled model IDs from session state or settings
  let currentEnabledIds: string[] | null = null;

  if (hasSessionScope) {
    // Use current session's scoped models
    currentEnabledIds = sessionScopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
  } else {
    // Fall back to settings
    const patterns = self.settingsManager.getEnabledModels();
    if (patterns !== undefined && patterns.length > 0) {
      const scopedModels = await resolveModelScope(patterns, self.session.modelRegistry);
      currentEnabledIds = scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
    }
  }

  // Helper to update session's scoped models (session-only, no persist)
  const updateSessionModels = async (enabledIds: string[] | null) => {
    currentEnabledIds = enabledIds === null ? null : [...enabledIds];
    if (enabledIds && enabledIds.length > 0 && enabledIds.length < allModels.length) {
      const newScopedModels = await resolveModelScope(enabledIds, self.session.modelRegistry);
      self.session.setScopedModels(
        newScopedModels.map((sm) => ({
          model: sm.model,
          thinkingLevel: sm.thinkingLevel,
        })),
      );
    } else {
      // All enabled or none enabled = no filter
      self.session.setScopedModels([]);
    }
    await self.updateAvailableProviderCount();
    self.ui.requestRender();
  };

  const activeModelId = self.session.model ? `${self.session.model.provider}/${self.session.model.id}` : undefined;

  self.showSelector((done) => {
    const selector = new ScopedModelsSelectorComponent(
      {
        allModels,
        enabledModelIds: currentEnabledIds,
        activeModelId,
      },
      {
        onChange: async (enabledIds) => {
          await updateSessionModels(enabledIds);
        },
        onPersist: (enabledIds) => {
          // Persist to settings
          const newPatterns =
            enabledIds === null || enabledIds.length === allModels.length
              ? undefined // All enabled = clear filter
              : enabledIds;
          self.settingsManager.setEnabledModels(newPatterns ? [...newPatterns] : undefined);
          self.showStatus("Model selection saved to settings");
        },
        onCancel: () => {
          done();
          self.ui.requestRender();
        },
      },
    );
    return { component: selector, focus: selector };
  });
}
