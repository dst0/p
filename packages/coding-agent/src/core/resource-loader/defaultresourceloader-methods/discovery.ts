import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME } from "../../../config.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ResourceDiagnostic } from "../../diagnostics.ts";
import type { Extension } from "../../extensions/types.ts";
import type { DefaultResourceLoader } from "../defaultresourceloader.ts";

export function do_dedupeThemes(
  _self: DefaultResourceLoader,
  themes: Theme[],
): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
  const seen = new Map<string, Theme>();
  const diagnostics: ResourceDiagnostic[] = [];

  for (const t of themes) {
    const name = t.name ?? "unnamed";
    const existing = seen.get(name);
    if (existing) {
      diagnostics.push({
        type: "collision",
        message: `name "${name}" collision`,
        path: t.sourcePath,
        collision: {
          resourceType: "theme",
          name,
          winnerPath: existing.sourcePath ?? "<builtin>",
          loserPath: t.sourcePath ?? "<builtin>",
        },
      });
    } else {
      seen.set(name, t);
    }
  }

  return { themes: Array.from(seen.values()), diagnostics };
}

export function do_discoverSystemPromptFile(self: DefaultResourceLoader): string | undefined {
  const projectPath = join(self.cwd, CONFIG_DIR_NAME, "SYSTEM.md");
  if (self.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
    return projectPath;
  }

  const globalPath = join(self.agentDir, "SYSTEM.md");
  if (existsSync(globalPath)) {
    return globalPath;
  }

  return undefined;
}

export function do_discoverAppendSystemPromptFile(self: DefaultResourceLoader): string | undefined {
  const projectPath = join(self.cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
  if (self.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
    return projectPath;
  }

  const globalPath = join(self.agentDir, "APPEND_SYSTEM.md");
  if (existsSync(globalPath)) {
    return globalPath;
  }

  return undefined;
}

export function do_isUnderPath(_self: DefaultResourceLoader, target: string, root: string): boolean {
  const normalizedRoot = resolve(root);
  if (target === normalizedRoot) {
    return true;
  }
  const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return target.startsWith(prefix);
}

export function do_detectExtensionConflicts(
  _self: DefaultResourceLoader,
  extensions: Extension[],
): Array<{ path: string; message: string }> {
  const conflicts: Array<{ path: string; message: string }> = [];

  // Track which extension registered each tool and flag
  const toolOwners = new Map<string, string>();
  const flagOwners = new Map<string, string>();

  for (const ext of extensions) {
    // Check tools
    for (const toolName of ext.tools.keys()) {
      const existingOwner = toolOwners.get(toolName);
      if (existingOwner && existingOwner !== ext.path) {
        conflicts.push({
          path: ext.path,
          message: `Tool "${toolName}" conflicts with ${existingOwner}`,
        });
      } else {
        toolOwners.set(toolName, ext.path);
      }
    }

    // Check flags
    for (const flagName of ext.flags.keys()) {
      const existingOwner = flagOwners.get(flagName);
      if (existingOwner && existingOwner !== ext.path) {
        conflicts.push({
          path: ext.path,
          message: `Flag "--${flagName}" conflicts with ${existingOwner}`,
        });
      } else {
        flagOwners.set(flagName, ext.path);
      }
    }
  }

  return conflicts;
}
