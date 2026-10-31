import { getKeybindings, hasAppleTerminalShiftEnterFallback } from "@dst0/p-tui";
import { formatKeyText } from "../../components/keybinding-hints.ts";
import type { InteractiveMode } from "../interactivemode.ts";

/** Upper bound for the keyboard protocol query reply; the wait is asynchronous and never delays startup. */
export const TERMINAL_NEWLINE_HINT_TIMEOUT_MS = 2000;

const NEW_LINE_FALLBACK = "Use Ctrl+J or \\ then Enter for a new line.";

export interface TerminalNewLineHintInput {
  kittyProtocolActive: boolean;
  /** Keys currently bound to `tui.input.newLine`. */
  newLineKeys: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  /** Apple Terminal's plain Return can still be recognised as Shift+Enter through the local macOS modifier helper. */
  appleTerminalShiftEnterFallback: boolean;
}

/** Enter chords other than Alt+Enter collapse to plain Enter unless the terminal reports modified keys. */
function needsModifiedKeyReporting(key: string): boolean {
  const parts = key.toLowerCase().split("+");
  const base = parts.pop();
  return (base === "enter" || base === "return") && parts.some((modifier) => modifier !== "alt");
}

export function getTerminalNewLineHint(input: TerminalNewLineHintInput): string | undefined {
  // tmux has its own extended-keys warning.
  if (input.kittyProtocolActive || input.env.TMUX) return undefined;

  const keys = input.newLineKeys.filter(needsModifiedKeyReporting);
  if (keys.length === 0) return undefined;
  const label = formatKeyText(keys.join("/"), { capitalize: true });
  const generic = `${label} may submit in this terminal (no kitty keyboard protocol). ${NEW_LINE_FALLBACK}`;

  switch (input.env.TERM_PROGRAM) {
    case "Apple_Terminal":
      if (input.appleTerminalShiftEnterFallback) return undefined;
      return `${label} may submit in Apple Terminal, which cannot report it here. ${NEW_LINE_FALLBACK}`;
    case "WezTerm":
      return `${generic}\nAdd \`config.enable_kitty_keyboard = true\` to ~/.wezterm.lua to enable it.`;
    case "iTerm.app":
      return `${generic}\nIn iTerm2, enable "Report keys using CSI u" under Profiles > Keys.`;
    default:
      return generic;
  }
}

/**
 * Warns once per process start, after the terminal answered (or ignored) the keyboard protocol query.
 * Runs fire-and-forget from `run()`, so a failure of this cosmetic hint must not become an unhandled rejection.
 */
export async function showTerminalNewLineHint(self: InteractiveMode): Promise<void> {
  try {
    if (self.settingsManager.getWarnings().terminalNewLine === false) return;
    const terminal = self.ui.terminal;
    if (!terminal.waitForKeyboardProtocolNegotiation) return;

    await terminal.waitForKeyboardProtocolNegotiation(TERMINAL_NEWLINE_HINT_TIMEOUT_MS);

    const hint = getTerminalNewLineHint({
      kittyProtocolActive: terminal.kittyProtocolActive,
      newLineKeys: getKeybindings().getKeys("tui.input.newLine"),
      env: process.env,
      appleTerminalShiftEnterFallback: hasAppleTerminalShiftEnterFallback(),
    });
    if (hint) self.showWarning(hint);
  } catch {
    // Warning-only check: ignore terminal or rendering failures.
  }
}
