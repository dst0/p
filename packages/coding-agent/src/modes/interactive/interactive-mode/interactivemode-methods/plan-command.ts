import type { OAuthProviderId, OAuthSelectPrompt } from "@dst0/p-ai";
import { LoginDialogComponent } from "../../components/login-dialog.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_showLoginDialog(
  self: InteractiveMode,
  providerId: string,
  providerName: string,
): Promise<void> {
  const providerInfo = self.session.modelRegistry.authStorage
    .getOAuthProviders()
    .find((provider) => provider.id === providerId);
  const previousModel = self.session.model;

  // Providers that use callback servers (can paste redirect URL)
  const usesCallbackServer = providerInfo?.usesCallbackServer ?? false;

  // Create login dialog component
  const dialog = new LoginDialogComponent(
    self.ui,
    providerId,
    (_success, _message) => {
      // Completion handled below
    },
    providerName,
  );

  // Show dialog in editor container
  self.editorContainer.clear();
  self.editorContainer.addChild(dialog);
  self.ui.setFocus(dialog);
  self.ui.requestRender();

  // Promise for manual code input (racing with callback server)
  let manualCodeResolve: ((code: string) => void) | undefined;
  let manualCodeReject: ((err: Error) => void) | undefined;
  const manualCodePromise = new Promise<string>((resolve, reject) => {
    manualCodeResolve = resolve;
    manualCodeReject = reject;
  });

  // Restore editor helper
  const restoreEditor = () => {
    self.editorContainer.clear();
    self.editorContainer.addChild(self.editor);
    self.ui.setFocus(self.editor);
    self.ui.requestRender();
  };

  try {
    await self.session.modelRegistry.authStorage.login(providerId as OAuthProviderId, {
      onAuth: (info: { url: string; instructions?: string }) => {
        dialog.showAuth(info.url, info.instructions);

        if (usesCallbackServer) {
          // Show input for manual paste, racing with callback
          dialog
            .showManualInput("Paste redirect URL below, or complete login in browser:")
            .then((value) => {
              if (value && manualCodeResolve) {
                manualCodeResolve(value);
                manualCodeResolve = undefined;
              }
            })
            .catch(() => {
              if (manualCodeReject) {
                manualCodeReject(new Error("Login cancelled"));
                manualCodeReject = undefined;
              }
            });
        }
        // For Anthropic: onPrompt is called immediately after
      },

      onDeviceCode: (info) => {
        dialog.showDeviceCode(info);
        dialog.showWaiting("Waiting for authentication...");
      },

      onPrompt: async (prompt: { message: string; placeholder?: string }) => {
        return dialog.showPrompt(prompt.message, prompt.placeholder);
      },

      onProgress: (message: string) => {
        dialog.showProgress(message);
      },

      onSelect: (prompt: OAuthSelectPrompt) => self.showOAuthLoginSelect(dialog, prompt),

      onManualCodeInput: () => manualCodePromise,

      signal: dialog.signal,
    });

    // Success
    restoreEditor();
    await self.completeProviderAuthentication(providerId, providerName, "oauth", previousModel);
  } catch (error: unknown) {
    restoreEditor();
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg !== "Login cancelled") {
      self.showError(`Failed to login to ${providerName}: ${errorMsg}`);
    }
  }
}

export async function do_handlePlanCommand(self: InteractiveMode, text: string): Promise<void> {
  const args = text.startsWith("/plan ") ? text.slice(6).trim() : "";
  if (args === "off" || args === "disable") {
    self.session.disablePlanMode();
    self.showStatus("Plan mode off");
    self.footer.invalidate();
    self.ui.requestRender();
    return;
  }
  if (args === "status") {
    self.showStatus(self.session.isPlanMode ? "Plan mode is on" : "Plan mode is off");
    return;
  }

  if (self.session.isStreaming) {
    self.showWarning("Wait for the current response to finish before switching plan mode.");
    return;
  }
  if (self.session.isCompacting) {
    self.showWarning("Wait for compaction to finish before switching plan mode.");
    return;
  }

  const result = self.session.enablePlanMode();
  if (!result.enabled) {
    self.showWarning("Plan mode needs submit_plan, but it is not available in the active tool configuration.");
    return;
  }
  self.showStatus("Plan mode on. p will ask for approval before execution.");
  self.footer.invalidate();
  self.ui.requestRender();

  if (args && args !== "on" && args !== "enable") {
    self.flushPendingBashComponents();
    self.editor.addToHistory?.(text);
    await self.session.prompt(args);
  }
}
