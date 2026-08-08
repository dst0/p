import type { KeyId } from "@dst0/p-tui";
import { type Theme, theme } from "../../../modes/interactive/theme/theme.ts";
import type { KeybindingsConfig } from "../../keybindings.ts";
import type { ExtensionUIContext } from "../types.ts";
import type { BuiltInKeyBindings } from "./types.ts";

export const RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS = [
  "app.interrupt",
  "app.clear",
  "app.exit",
  "app.suspend",
  "app.thinking.cycle",
  "app.model.cycleForward",
  "app.model.cycleBackward",
  "app.model.select",
  "app.tools.expand",
  "app.thinking.toggle",
  "app.editor.external",
  "app.message.followUp",
  "tui.input.submit",
  "tui.select.confirm",
  "tui.select.cancel",
  "tui.input.copy",
  "tui.editor.deleteToLineEnd",
] as const;

export const buildBuiltinKeybindings = (resolvedKeybindings: KeybindingsConfig): BuiltInKeyBindings => {
  const builtinKeybindings = {} as BuiltInKeyBindings;
  for (const [keybinding, keys] of Object.entries(resolvedKeybindings)) {
    if (keys === undefined) continue;
    const keyList = Array.isArray(keys) ? keys : [keys];
    const restrictOverride = (RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS as readonly string[]).includes(keybinding);
    for (const key of keyList) {
      const normalizedKey = key.toLowerCase() as KeyId;
      // If multiple actions bind the same key, the reserved action wins so extensions
      // remain blocked by reserved shortcuts regardless of iteration order.
      const existing = builtinKeybindings[normalizedKey];
      if (existing?.restrictOverride && !restrictOverride) continue;
      builtinKeybindings[normalizedKey] = {
        keybinding,
        restrictOverride,
      };
    }
  }
  return builtinKeybindings;
};

export const noOpUIContext: ExtensionUIContext = {
  select: async () => undefined,
  confirm: async () => false,
  input: async () => undefined,
  notify: () => {},
  onTerminalInput: () => () => {},
  setStatus: () => {},
  setWorkingMessage: () => {},
  setWorkingVisible: () => {},
  setWorkingIndicator: () => {},
  setHiddenThinkingLabel: () => {},
  setWidget: () => {},
  setFooter: () => {},
  setHeader: () => {},
  setTitle: () => {},
  custom: async () => undefined as never,
  pasteToEditor: () => {},
  setEditorText: () => {},
  getEditorText: () => "",
  editor: async () => undefined,
  addAutocompleteProvider: () => {},
  setEditorComponent: () => {},
  getEditorComponent: () => undefined,
  get theme() {
    return theme;
  },
  getAllThemes: () => [],
  getTheme: () => undefined,
  setTheme: (_theme: string | Theme) => ({ success: false, error: "UI not available" }),
  getToolsExpanded: () => false,
  setToolsExpanded: () => {},
};
