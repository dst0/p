import type { ExtensionCommandContext } from "../../../../core/extensions/index.ts";
import { MissingSessionCwdError } from "../../../../core/session-cwd.ts";
import { SessionManager } from "../../../../core/session-manager.ts";
import { ExtensionSelectorComponent } from "../../components/extension-selector.ts";
import type { AuthSelectorProvider } from "../../components/oauth-selector.ts";
import { SessionSelectorComponent } from "../../components/session-selector.ts";
import { isApiKeyLoginProvider } from "../helpers.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_showSessionSelector(self: InteractiveMode): void {
  self.showSelector((done) => {
    const selector = new SessionSelectorComponent(
      (onProgress) =>
        SessionManager.list(self.sessionManager.getCwd(), self.sessionManager.getSessionDir(), onProgress),
      (onProgress) =>
        self.sessionManager.usesDefaultSessionDir()
          ? SessionManager.listAll(onProgress)
          : SessionManager.listAll(self.sessionManager.getSessionDir(), onProgress),
      async (sessionPath) => {
        done();
        await self.handleResumeSession(sessionPath);
      },
      () => {
        done();
        self.ui.requestRender();
      },
      () => {
        void self.shutdown();
      },
      () => self.ui.requestRender(),
      {
        renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
          const next = (nextName ?? "").trim();
          if (!next) return;
          const mgr = SessionManager.open(sessionFilePath);
          mgr.appendSessionInfo(next);
        },
        showRenameHint: true,
        keybindings: self.keybindings,
      },

      self.sessionManager.getSessionFile(),
    );
    return { component: selector, focus: selector };
  });
}

export async function do_handleResumeSession(
  self: InteractiveMode,
  sessionPath: string,
  options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
): Promise<{ cancelled: boolean }> {
  if (self.loadingAnimation) {
    self.loadingAnimation.stop();
    self.loadingAnimation = undefined;
  }
  self.statusContainer.clear();
  try {
    const result = await self.runtimeHost.switchSession(sessionPath, {
      withSession: options?.withSession,
      projectTrustContextFactory: (cwd) => self.createProjectTrustContext(cwd),
    });
    if (result.cancelled) {
      return result;
    }
    self.renderCurrentSessionState();
    self.showStatus("Resumed session");
    return result;
  } catch (error: unknown) {
    if (error instanceof MissingSessionCwdError) {
      const selectedCwd = await self.promptForMissingSessionCwd(error);
      if (!selectedCwd) {
        self.showStatus("Resume cancelled");
        return { cancelled: true };
      }
      const result = await self.runtimeHost.switchSession(sessionPath, {
        cwdOverride: selectedCwd,
        withSession: options?.withSession,
        projectTrustContextFactory: (cwd) => self.createProjectTrustContext(cwd),
      });
      if (result.cancelled) {
        return result;
      }
      self.renderCurrentSessionState();
      self.showStatus("Resumed session in current cwd");
      return result;
    }
    return self.handleFatalRuntimeError("Failed to resume session", error);
  }
}

export function do_getLoginProviderOptions(
  self: InteractiveMode,
  authType?: "oauth" | "api_key",
): AuthSelectorProvider[] {
  const authStorage = self.session.modelRegistry.authStorage;
  const oauthProviders = authStorage.getOAuthProviders();
  const oauthProviderIds = new Set(oauthProviders.map((provider) => provider.id));
  const options: AuthSelectorProvider[] = oauthProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    authType: "oauth",
  }));

  const modelProviders = new Set(self.session.modelRegistry.getAll().map((model) => model.provider));
  for (const providerId of modelProviders) {
    if (!isApiKeyLoginProvider(providerId, oauthProviderIds)) {
      continue;
    }
    options.push({
      id: providerId,
      name: self.session.modelRegistry.getProviderDisplayName(providerId),
      authType: "api_key",
    });
  }

  const filteredOptions = authType ? options.filter((option) => option.authType === authType) : options;
  return filteredOptions.sort((a, b) => a.name.localeCompare(b.name));
}

export function do_getLogoutProviderOptions(self: InteractiveMode): AuthSelectorProvider[] {
  const authStorage = self.session.modelRegistry.authStorage;
  const options: AuthSelectorProvider[] = [];

  for (const providerId of authStorage.list()) {
    const credential = authStorage.get(providerId);
    if (!credential) {
      continue;
    }
    options.push({
      id: providerId,
      name: self.session.modelRegistry.getProviderDisplayName(providerId),
      authType: credential.type,
    });
  }

  return options.sort((a, b) => a.name.localeCompare(b.name));
}

export function do_showLoginAuthTypeSelector(self: InteractiveMode): void {
  const subscriptionLabel = "Use a subscription";
  const apiKeyLabel = "Use an API key";
  self.showSelector((done) => {
    const selector = new ExtensionSelectorComponent(
      "Select authentication method:",
      [subscriptionLabel, apiKeyLabel],
      (option) => {
        done();
        const authType = option === subscriptionLabel ? "oauth" : "api_key";
        self.showLoginProviderSelector(authType);
      },
      () => {
        done();
        self.ui.requestRender();
      },
    );
    return { component: selector, focus: selector };
  });
}
