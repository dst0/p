import type { Model } from "@dst0/p-ai";
import { getAuthPath } from "../../../../config.ts";
import { defaultModelPerProvider } from "../../../../core/model-resolver.ts";
import { OAuthSelectorComponent } from "../../components/oauth-selector.ts";
import { BEDROCK_PROVIDER_ID } from "../constants.ts";
import { hasDefaultModelProvider, isUnknownModel } from "../helpers.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_showLoginProviderSelector(self: InteractiveMode, authType: "oauth" | "api_key"): void {
  const providerOptions = self.getLoginProviderOptions(authType);
  if (providerOptions.length === 0) {
    self.showStatus(authType === "oauth" ? "No subscription providers available." : "No API key providers available.");
    return;
  }

  self.showSelector((done) => {
    const selector = new OAuthSelectorComponent(
      "login",
      self.session.modelRegistry.authStorage,
      providerOptions,
      async (providerId: string) => {
        done();

        const providerOption = providerOptions.find((provider) => provider.id === providerId);
        if (!providerOption) {
          return;
        }

        if (providerOption.authType === "oauth") {
          await self.showLoginDialog(providerOption.id, providerOption.name);
        } else if (providerOption.id === BEDROCK_PROVIDER_ID) {
          self.showBedrockSetupDialog(providerOption.id, providerOption.name);
        } else {
          await self.showApiKeyLoginDialog(providerOption.id, providerOption.name);
        }
      },
      () => {
        done();
        self.showLoginAuthTypeSelector();
      },
      (providerId) => self.session.modelRegistry.getProviderAuthStatus(providerId),
    );
    return { component: selector, focus: selector };
  });
}

export async function do_showOAuthSelector(self: InteractiveMode, mode: "login" | "logout"): Promise<void> {
  if (mode === "login") {
    self.showLoginAuthTypeSelector();
    return;
  }

  const providerOptions = self.getLogoutProviderOptions();
  if (providerOptions.length === 0) {
    self.showStatus(
      "No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
    );
    return;
  }

  self.showSelector((done) => {
    const selector = new OAuthSelectorComponent(
      mode,
      self.session.modelRegistry.authStorage,
      providerOptions,
      async (providerId: string) => {
        done();

        const providerOption = providerOptions.find((provider) => provider.id === providerId);
        if (!providerOption) {
          return;
        }

        try {
          self.session.modelRegistry.authStorage.logout(providerOption.id);
          self.session.modelRegistry.refresh();
          await self.updateAvailableProviderCount();
          const message =
            providerOption.authType === "oauth"
              ? `Logged out of ${providerOption.name}`
              : `Removed stored API key for ${providerOption.name}. Environment variables and models.json config are unchanged.`;
          self.showStatus(message);
        } catch (error: unknown) {
          self.showError(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      () => {
        done();
        self.ui.requestRender();
      },
    );
    return { component: selector, focus: selector };
  });
}

export async function do_completeProviderAuthentication(
  self: InteractiveMode,
  providerId: string,
  providerName: string,
  authType: "oauth" | "api_key",
  previousModel: Model<any> | undefined,
): Promise<void> {
  self.session.modelRegistry.refresh();

  const actionLabel = authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

  let selectedModel: Model<any> | undefined;
  let selectionError: string | undefined;
  if (isUnknownModel(previousModel)) {
    const availableModels = self.session.modelRegistry.getAvailable();
    const providerModels = availableModels.filter((model) => model.provider === providerId);
    if (!hasDefaultModelProvider(providerId)) {
      selectionError = `${actionLabel}, but no default model is configured for provider "${providerId}". Use /model to select a model.`;
    } else if (providerModels.length === 0) {
      selectionError = `${actionLabel}, but no models are available for that provider. Use /model to select a model.`;
    } else {
      const defaultModelId = defaultModelPerProvider[providerId];
      selectedModel = providerModels.find((model) => model.id === defaultModelId);
      if (!selectedModel) {
        selectionError = `${actionLabel}, but its default model "${defaultModelId}" is not available. Use /model to select a model.`;
      } else {
        try {
          await self.session.setModel(selectedModel);
          self.noteModelSwitch(previousModel, selectedModel);
        } catch (error: unknown) {
          selectedModel = undefined;
          const errorMessage = error instanceof Error ? error.message : String(error);
          selectionError = `${actionLabel}, but selecting its default model failed: ${errorMessage}. Use /model to select a model.`;
        }
      }
    }
  }

  await self.updateAvailableProviderCount();
  self.footer.invalidate();
  self.updateEditorBorderColor();
  if (selectedModel) {
    self.showStatus(`${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`);
    void self.maybeWarnAboutAnthropicSubscriptionAuth(selectedModel);
    self.checkDaxnutsEasterEgg(selectedModel);
  } else {
    self.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}`);
    if (selectionError) {
      self.showError(selectionError);
    } else {
      void self.maybeWarnAboutAnthropicSubscriptionAuth();
    }
  }
}
