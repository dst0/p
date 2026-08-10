import type { AutocompleteItem, AutocompleteProvider, SlashCommand } from "@dst0/p-tui";
import { CombinedAutocompleteProvider, fuzzyFilter } from "@dst0/p-tui";
import type { ExtensionRunner } from "../../../../core/extensions/index.ts";
import type { ResourceDiagnostic } from "../../../../core/resource-loader.ts";
import { BUILTIN_SLASH_COMMANDS } from "../../../../core/slash-commands.ts";
import type { SourceInfo } from "../../../../core/source-info.ts";
import { parseGitUrl } from "../../../../utils/git.ts";
import { detectTerminalBackgroundTheme, getThemePageBg, setTheme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_updateTerminalBackground(self: InteractiveMode): void {
  const pageBg = getThemePageBg();
  self.ui.setTerminalBackgroundColor(pageBg);
}

export async function do_detectThemeIfUnset(self: InteractiveMode): Promise<void> {
  if (self.settingsManager.getTheme()) {
    return;
  }

  const detection = await detectTerminalBackgroundTheme({
    ui: self.ui,
    timeoutMs: 100,
  });
  const result = setTheme(detection.theme, true);
  if (!result.success) {
    return;
  }

  if (detection.confidence === "high") {
    self.settingsManager.setTheme(detection.theme);
    await self.settingsManager.flush();
  }
  self.updateTerminalBackground();
  self.updateEditorBorderColor();
  self.ui.requestRender();
}

export function do_getAutocompleteSourceTag(_self: InteractiveMode, sourceInfo?: SourceInfo): string | undefined {
  if (!sourceInfo) {
    return undefined;
  }

  const scopePrefix = sourceInfo.scope === "user" ? "u" : sourceInfo.scope === "project" ? "p" : "t";
  const source = sourceInfo.source.trim();

  if (source === "auto" || source === "local" || source === "cli") {
    return scopePrefix;
  }

  if (source.startsWith("npm:")) {
    return `${scopePrefix}:${source}`;
  }

  const gitSource = parseGitUrl(source);
  if (gitSource) {
    const ref = gitSource.ref ? `@${gitSource.ref}` : "";
    return `${scopePrefix}:git:${gitSource.host}/${gitSource.path}${ref}`;
  }

  return scopePrefix;
}

export function do_prefixAutocompleteDescription(
  self: InteractiveMode,
  description: string | undefined,
  sourceInfo?: SourceInfo,
): string | undefined {
  const sourceTag = self.getAutocompleteSourceTag(sourceInfo);
  if (!sourceTag) {
    return description;
  }
  return description ? `[${sourceTag}] ${description}` : `[${sourceTag}]`;
}

export function do_getBuiltInCommandConflictDiagnostics(
  _self: InteractiveMode,
  extensionRunner: ExtensionRunner,
): ResourceDiagnostic[] {
  const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
  return extensionRunner
    .getRegisteredCommands()
    .filter((command) => builtinNames.has(command.name))
    .map((command) => ({
      type: "warning" as const,
      message:
        command.invocationName === command.name
          ? `Extension command '/${command.name}' conflicts with built-in interactive command. Skipping in autocomplete.`
          : `Extension command '/${command.name}' conflicts with built-in interactive command. Available as '/${command.invocationName}'.`,
      path: command.sourceInfo.path,
    }));
}

export function do_createBaseAutocompleteProvider(self: InteractiveMode): AutocompleteProvider {
  // Define commands for autocomplete
  const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
    name: command.name,
    description: command.description,
  }));

  const modelCommand = slashCommands.find((command) => command.name === "model");
  if (modelCommand) {
    modelCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
      // Get available models (scoped or from registry)
      const models =
        self.session.scopedModels.length > 0
          ? self.session.scopedModels.map((s) => s.model)
          : self.session.modelRegistry.getAvailable();

      if (models.length === 0) return null;

      // Create items with provider/id format
      const items = models.map((m) => ({
        id: m.id,
        provider: m.provider,
        label: `${m.provider}/${m.id}`,
      }));

      // Fuzzy filter by model ID + provider (allows "opus anthropic" to match)
      const filtered = fuzzyFilter(items, prefix, (item) => `${item.id} ${item.provider}`);

      if (filtered.length === 0) return null;

      return filtered.map((item) => ({
        value: item.label,
        label: item.id,
        description: item.provider,
      }));
    };
  }

  // Convert prompt templates to SlashCommand format for autocomplete
  const templateCommands: SlashCommand[] = self.session.promptTemplates.map((cmd) => ({
    name: cmd.name,
    description: self.prefixAutocompleteDescription(cmd.description, cmd.sourceInfo),
    ...(cmd.argumentHint && { argumentHint: cmd.argumentHint }),
  }));

  // Convert extension commands to SlashCommand format
  const builtinCommandNames = new Set(slashCommands.map((c) => c.name));
  const extensionCommands: SlashCommand[] = self.session.extensionRunner
    .getRegisteredCommands()
    .filter((cmd) => !builtinCommandNames.has(cmd.name))
    .map((cmd) => ({
      name: cmd.invocationName,
      description: self.prefixAutocompleteDescription(cmd.description, cmd.sourceInfo),
      getArgumentCompletions: cmd.getArgumentCompletions,
    }));

  // Build skill commands from session.skills (if enabled)
  self.skillCommands.clear();
  const skillCommandList: SlashCommand[] = [];
  if (self.settingsManager.getEnableSkillCommands()) {
    for (const skill of self.session.resourceLoader.getSkills().skills) {
      const commandName = `skill:${skill.name}`;
      self.skillCommands.set(commandName, skill.filePath);
      skillCommandList.push({
        name: commandName,
        description: self.prefixAutocompleteDescription(skill.description, skill.sourceInfo),
      });
    }
  }

  return new CombinedAutocompleteProvider(
    [...slashCommands, ...templateCommands, ...extensionCommands, ...skillCommandList],
    self.sessionManager.getCwd(),
    self.fdPath,
  );
}
