import * as path from "node:path";
import type { OAuthSelectPrompt } from "@dst0/p-ai";
import { getDocsPath } from "../../../../config.ts";
import { ExtensionSelectorComponent } from "../../components/extension-selector.ts";
import { LoginDialogComponent } from "../../components/login-dialog.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_showBedrockSetupDialog(self: InteractiveMode, providerId: string, providerName: string): void {
  const restoreEditor = () => {
    self.editorContainer.clear();
    self.editorContainer.addChild(self.editor);
    self.ui.setFocus(self.editor);
    self.ui.requestRender();
  };

  const dialog = new LoginDialogComponent(
    self.ui,
    providerId,
    () => restoreEditor(),
    providerName,
    "Amazon Bedrock setup",
  );
  dialog.showInfo([
    theme.fg("text", "Amazon Bedrock uses AWS credentials instead of a single API key."),
    theme.fg("text", "Configure an AWS profile, IAM keys, bearer token, or role-based credentials."),
    theme.fg("muted", "See:"),
    theme.fg("accent", `  ${path.join(getDocsPath(), "providers.md")}`),
  ]);

  self.editorContainer.clear();
  self.editorContainer.addChild(dialog);
  self.ui.setFocus(dialog);
  self.ui.requestRender();
}

export async function do_showApiKeyLoginDialog(
  self: InteractiveMode,
  providerId: string,
  providerName: string,
): Promise<void> {
  const previousModel = self.session.model;

  const dialog = new LoginDialogComponent(
    self.ui,
    providerId,
    (_success, _message) => {
      // Completion handled below
    },
    providerName,
  );

  self.editorContainer.clear();
  self.editorContainer.addChild(dialog);
  self.ui.setFocus(dialog);
  self.ui.requestRender();

  const restoreEditor = () => {
    self.editorContainer.clear();
    self.editorContainer.addChild(self.editor);
    self.ui.setFocus(self.editor);
    self.ui.requestRender();
  };

  try {
    const apiKey = (await dialog.showPrompt("Enter API key:")).trim();
    if (!apiKey) {
      throw new Error("API key cannot be empty.");
    }

    self.session.modelRegistry.authStorage.set(providerId, {
      type: "api_key",
      key: apiKey,
    });

    restoreEditor();
    await self.completeProviderAuthentication(providerId, providerName, "api_key", previousModel);
  } catch (error: unknown) {
    restoreEditor();
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg !== "Login cancelled") {
      self.showError(`Failed to save API key for ${providerName}: ${errorMsg}`);
    }
  }
}

export function do_showOAuthLoginSelect(
  self: InteractiveMode,
  dialog: LoginDialogComponent,
  prompt: OAuthSelectPrompt,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const restoreDialog = () => {
      self.editorContainer.clear();
      self.editorContainer.addChild(dialog);
      self.ui.setFocus(dialog);
      self.ui.requestRender();
    };
    const labels = prompt.options.map((option) => option.label);
    const selector = new ExtensionSelectorComponent(
      prompt.message,
      labels,
      (optionLabel) => {
        restoreDialog();
        resolve(prompt.options.find((option) => option.label === optionLabel)?.id);
      },
      () => {
        restoreDialog();
        resolve(undefined);
      },
    );
    self.editorContainer.clear();
    self.editorContainer.addChild(selector);
    self.ui.setFocus(selector);
    self.ui.requestRender();
  });
}
