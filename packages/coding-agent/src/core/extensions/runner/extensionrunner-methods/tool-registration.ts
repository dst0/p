import type { KeyId } from "@dst0/p-tui";
import type { ResourceDiagnostic } from "../../../diagnostics.ts";
import type { KeybindingsConfig } from "../../../keybindings.ts";
import type {
  ExtensionError,
  ExtensionShortcut,
  MessageRenderer,
  RegisteredCommand,
  ResolvedCommand,
} from "../../types.ts";
import { buildBuiltinKeybindings } from "../constants.ts";
import type { ExtensionRunner } from "../extensionrunner.ts";
import type { ExtensionErrorListener } from "../types.ts";

export function do_getShortcuts(
  self: ExtensionRunner,
  resolvedKeybindings: KeybindingsConfig,
): Map<KeyId, ExtensionShortcut> {
  self.shortcutDiagnostics = [];
  const builtinKeybindings = buildBuiltinKeybindings(resolvedKeybindings);
  const extensionShortcuts = new Map<KeyId, ExtensionShortcut>();

  const addDiagnostic = (message: string, extensionPath: string) => {
    self.shortcutDiagnostics.push({ type: "warning", message, path: extensionPath });
    if (!self.hasUI()) {
      console.warn(message);
    }
  };

  for (const ext of self.extensions) {
    for (const [key, shortcut] of ext.shortcuts) {
      const normalizedKey = key.toLowerCase() as KeyId;

      const builtInKeybinding = builtinKeybindings[normalizedKey];
      if (builtInKeybinding?.restrictOverride === true) {
        addDiagnostic(
          `Extension shortcut '${key}' from ${shortcut.extensionPath} conflicts with built-in shortcut. Skipping.`,
          shortcut.extensionPath,
        );
        continue;
      }

      if (builtInKeybinding?.restrictOverride === false) {
        addDiagnostic(
          `Extension shortcut conflict: '${key}' is built-in shortcut for ${builtInKeybinding.keybinding} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
          shortcut.extensionPath,
        );
      }

      const existingExtensionShortcut = extensionShortcuts.get(normalizedKey);
      if (existingExtensionShortcut) {
        addDiagnostic(
          `Extension shortcut conflict: '${key}' registered by both ${existingExtensionShortcut.extensionPath} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
          shortcut.extensionPath,
        );
      }
      extensionShortcuts.set(normalizedKey, shortcut);
    }
  }
  return extensionShortcuts;
}

export function do_getShortcutDiagnostics(self: ExtensionRunner): ResourceDiagnostic[] {
  return self.shortcutDiagnostics;
}

export function do_invalidate(
  self: ExtensionRunner,
  message = "This extension ctx is stale after session replacement or reload. Do not use a captured p or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
): void {
  if (!self.staleMessage) {
    self.staleMessage = message;
    self.runtime.invalidate(message);
  }
}

export function do_assertActive(self: ExtensionRunner): void {
  if (self.staleMessage) {
    throw new Error(self.staleMessage);
  }
}

export function do_onError(self: ExtensionRunner, listener: ExtensionErrorListener): () => void {
  self.errorListeners.add(listener);
  return () => self.errorListeners.delete(listener);
}

export function do_emitError(self: ExtensionRunner, error: ExtensionError): void {
  for (const listener of self.errorListeners) {
    listener(error);
  }
}

export function do_hasHandlers(self: ExtensionRunner, eventType: string): boolean {
  for (const ext of self.extensions) {
    const handlers = ext.handlers.get(eventType);
    if (handlers && handlers.length > 0) {
      return true;
    }
  }
  return false;
}

export function do_getMessageRenderer(self: ExtensionRunner, customType: string): MessageRenderer | undefined {
  for (const ext of self.extensions) {
    const renderer = ext.messageRenderers.get(customType);
    if (renderer) {
      return renderer;
    }
  }
  return undefined;
}

export function do_resolveRegisteredCommands(self: ExtensionRunner): ResolvedCommand[] {
  const commands: RegisteredCommand[] = [];
  const counts = new Map<string, number>();

  for (const ext of self.extensions) {
    for (const command of ext.commands.values()) {
      commands.push(command);
      counts.set(command.name, (counts.get(command.name) ?? 0) + 1);
    }
  }

  const seen = new Map<string, number>();
  const takenInvocationNames = new Set<string>();

  return commands.map((command) => {
    const occurrence = (seen.get(command.name) ?? 0) + 1;
    seen.set(command.name, occurrence);

    let invocationName = (counts.get(command.name) ?? 0) > 1 ? `${command.name}:${occurrence}` : command.name;

    if (takenInvocationNames.has(invocationName)) {
      let suffix = occurrence;
      do {
        suffix++;
        invocationName = `${command.name}:${suffix}`;
      } while (takenInvocationNames.has(invocationName));
    }

    takenInvocationNames.add(invocationName);
    return {
      ...command,
      invocationName,
    };
  });
}

export function do_getRegisteredCommands(self: ExtensionRunner): ResolvedCommand[] {
  self.commandDiagnostics = [];
  return self.resolveRegisteredCommands();
}

export function do_getCommandDiagnostics(self: ExtensionRunner): ResourceDiagnostic[] {
  return self.commandDiagnostics;
}

export function do_getCommand(self: ExtensionRunner, name: string): ResolvedCommand | undefined {
  return self.resolveRegisteredCommands().find((command) => command.invocationName === name);
}

export function do_shutdown(self: ExtensionRunner): void {
  self.shutdownHandler();
}
