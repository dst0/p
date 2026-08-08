import * as path from "node:path";
import { spawn } from "child_process";
import { APP_TITLE, getAgentDir } from "../../../../config.ts";
import { DefaultPackageManager } from "../../../../core/package-manager.ts";
import { checkForNewPiVersion } from "../../../../utils/version-check.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_updateTerminalTitle(self: InteractiveMode): void {
  const cwdBasename = path.basename(self.sessionManager.getCwd());
  const sessionName = self.sessionManager.getSessionName();
  if (sessionName) {
    self.ui.terminal.setTitle(`${APP_TITLE} - ${sessionName} - ${cwdBasename}`);
  } else {
    self.ui.terminal.setTitle(`${APP_TITLE} - ${cwdBasename}`);
  }
}

export async function do_run(self: InteractiveMode): Promise<void> {
  await self.init();

  // Start version check asynchronously (disabled by default after rebrand)
  if (self.settingsManager.getStartupNotices()) {
    checkForNewPiVersion(self.version).then((newRelease) => {
      if (newRelease) {
        self.showNewVersionNotification(newRelease);
      }
    });
  }

  // Start package update check asynchronously (disabled by default after rebrand)
  if (self.settingsManager.getStartupNotices()) {
    self.checkForPackageUpdates().then((updates) => {
      if (updates.length > 0) {
        self.showPackageUpdateNotification(updates);
      }
    });
  }

  // Check tmux keyboard setup asynchronously
  self.checkTmuxKeyboardSetup().then((warning) => {
    if (warning) {
      self.showWarning(warning);
    }
  });

  // Show startup warnings
  const { migratedProviders, modelFallbackMessage, initialMessage, initialImages, initialMessages } = self.options;

  if (migratedProviders && migratedProviders.length > 0) {
    self.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
  }

  const modelsJsonError = self.session.modelRegistry.getError();
  if (modelsJsonError) {
    self.showError(`models.json error: ${modelsJsonError}`);
  }

  if (modelFallbackMessage) {
    self.showWarning(modelFallbackMessage);
  }

  void self.maybeWarnAboutAnthropicSubscriptionAuth();

  // Process initial messages
  if (initialMessage) {
    try {
      await self.session.prompt(initialMessage, { images: initialImages });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      self.showError(errorMessage);
    }
  }

  if (initialMessages) {
    for (const message of initialMessages) {
      try {
        await self.session.prompt(message);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        self.showError(errorMessage);
      }
    }
  }

  // Main interactive loop
  while (true) {
    const userInput = await self.getUserInput();
    try {
      await self.session.prompt(userInput);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      self.showError(errorMessage);
    }
  }
}

export async function do_checkForPackageUpdates(self: InteractiveMode): Promise<string[]> {
  if (process.env.P_OFFLINE) {
    return [];
  }

  try {
    const packageManager = new DefaultPackageManager({
      cwd: self.sessionManager.getCwd(),
      agentDir: getAgentDir(),
      settingsManager: self.settingsManager,
    });
    const updates = await packageManager.checkForAvailableUpdates();
    return updates.map((update) => update.displayName);
  } catch {
    return [];
  }
}

export async function do_checkTmuxKeyboardSetup(_self: InteractiveMode): Promise<string | undefined> {
  if (!process.env.TMUX) return undefined;

  const runTmuxShow = (option: string): Promise<string | undefined> => {
    return new Promise((resolve) => {
      const proc = spawn("tmux", ["show", "-gv", option], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let stdout = "";
      const timer = setTimeout(() => {
        proc.kill();
        resolve(undefined);
      }, 2000);

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      proc.on("error", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? stdout.trim() : undefined);
      });
    });
  };

  const [extendedKeys, extendedKeysFormat] = await Promise.all([
    runTmuxShow("extended-keys"),
    runTmuxShow("extended-keys-format"),
  ]);

  // If we couldn't query tmux (timeout, sandbox, etc.), don't warn
  if (extendedKeys === undefined) return undefined;

  if (extendedKeys !== "on" && extendedKeys !== "always") {
    return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
  }

  if (extendedKeysFormat === "xterm") {
    return "tmux extended-keys-format is xterm. p works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
  }

  return undefined;
}
