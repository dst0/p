import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "../../../config.ts";
import { loadThemeFromPath, type Theme } from "../../../modes/interactive/theme/theme.ts";
import { canonicalizePath, resolvePath } from "../../../utils/paths.ts";
import type { ResourceDiagnostic } from "../../diagnostics.ts";
import { loadExtensionFromFactory } from "../../extensions/loader.ts";
import type { Extension, ExtensionRuntime } from "../../extensions/types.ts";
import type { PromptTemplate } from "../../prompt-templates.ts";
import type { DefaultResourceLoader } from "../defaultresourceloader.ts";

export function do_mergePaths(self: DefaultResourceLoader, primary: string[], additional: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const p of [...primary, ...additional]) {
    const resolved = self.resolveResourcePath(p);
    const canonicalPath = canonicalizePath(resolved);
    if (seen.has(canonicalPath)) continue;
    seen.add(canonicalPath);
    merged.push(resolved);
  }

  return merged;
}

export function do_resolveResourcePath(self: DefaultResourceLoader, p: string): string {
  return resolvePath(p, self.cwd, { trim: true });
}

export function do_loadThemes(
  self: DefaultResourceLoader,
  paths: string[],
  includeDefaults: boolean = true,
): {
  themes: Theme[];
  diagnostics: ResourceDiagnostic[];
} {
  const themes: Theme[] = [];
  const diagnostics: ResourceDiagnostic[] = [];
  if (includeDefaults) {
    const defaultDirs = [join(self.agentDir, "themes"), join(self.cwd, CONFIG_DIR_NAME, "themes")];

    for (const dir of defaultDirs) {
      self.loadThemesFromDir(dir, themes, diagnostics);
    }
  }

  for (const p of paths) {
    const resolved = self.resolveResourcePath(p);
    if (!existsSync(resolved)) {
      diagnostics.push({ type: "warning", message: "theme path does not exist", path: resolved });
      continue;
    }

    try {
      const stats = statSync(resolved);
      if (stats.isDirectory()) {
        self.loadThemesFromDir(resolved, themes, diagnostics);
      } else if (stats.isFile() && resolved.endsWith(".json")) {
        self.loadThemeFromFile(resolved, themes, diagnostics);
      } else {
        diagnostics.push({ type: "warning", message: "theme path is not a json file", path: resolved });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to read theme path";
      diagnostics.push({ type: "warning", message, path: resolved });
    }
  }

  return { themes, diagnostics };
}

export function do_loadThemesFromDir(
  self: DefaultResourceLoader,
  dir: string,
  themes: Theme[],
  diagnostics: ResourceDiagnostic[],
): void {
  if (!existsSync(dir)) {
    return;
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(join(dir, entry.name)).isFile();
        } catch {
          continue;
        }
      }
      if (!isFile) {
        continue;
      }
      if (!entry.name.endsWith(".json")) {
        continue;
      }
      self.loadThemeFromFile(join(dir, entry.name), themes, diagnostics);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to read theme directory";
    diagnostics.push({ type: "warning", message, path: dir });
  }
}

export function do_loadThemeFromFile(
  _self: DefaultResourceLoader,
  filePath: string,
  themes: Theme[],
  diagnostics: ResourceDiagnostic[],
): void {
  try {
    themes.push(loadThemeFromPath(filePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load theme";
    diagnostics.push({ type: "warning", message, path: filePath });
  }
}

export async function do_loadExtensionFactories(
  self: DefaultResourceLoader,
  runtime: ExtensionRuntime,
): Promise<{
  extensions: Extension[];
  errors: Array<{ path: string; error: string }>;
}> {
  const extensions: Extension[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const [index, factory] of self.extensionFactories.entries()) {
    const extensionPath = `<inline:${index + 1}>`;
    try {
      const extension = await loadExtensionFromFactory(factory, self.cwd, self.eventBus, runtime, extensionPath);
      extensions.push(extension);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to load extension";
      errors.push({ path: extensionPath, error: message });
    }
  }

  return { extensions, errors };
}

export function do_dedupePrompts(
  _self: DefaultResourceLoader,
  prompts: PromptTemplate[],
): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
  const seen = new Map<string, PromptTemplate>();
  const diagnostics: ResourceDiagnostic[] = [];

  for (const prompt of prompts) {
    const existing = seen.get(prompt.name);
    if (existing) {
      diagnostics.push({
        type: "collision",
        message: `name "/${prompt.name}" collision`,
        path: prompt.filePath,
        collision: {
          resourceType: "prompt",
          name: prompt.name,
          winnerPath: existing.filePath,
          loserPath: prompt.filePath,
        },
      });
    } else {
      seen.set(prompt.name, prompt);
    }
  }

  return { prompts: Array.from(seen.values()), diagnostics };
}
