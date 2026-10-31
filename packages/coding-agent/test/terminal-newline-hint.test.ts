import { describe, expect, it } from "vitest";
import {
  getTerminalNewLineHint,
  type TerminalNewLineHintInput,
} from "../src/modes/interactive/interactive-mode/interactivemode-methods/terminal-newline-hint.ts";

const GENERIC =
  "Shift+Enter may submit in this terminal (no kitty keyboard protocol). Use Ctrl+J or \\ then Enter for a new line.";

function hintInput(overrides: Partial<TerminalNewLineHintInput> = {}): TerminalNewLineHintInput {
  return {
    kittyProtocolActive: false,
    newLineKeys: ["shift+enter"],
    env: {},
    appleTerminalShiftEnterFallback: false,
    ...overrides,
  };
}

describe("getTerminalNewLineHint", () => {
  it("stays silent when the kitty keyboard protocol is active", () => {
    expect(getTerminalNewLineHint(hintInput({ kittyProtocolActive: true }))).toBeUndefined();
    expect(
      getTerminalNewLineHint(hintInput({ kittyProtocolActive: true, env: { TERM_PROGRAM: "WezTerm" } })),
    ).toBeUndefined();
  });

  it("leaves tmux to its own extended-keys warning", () => {
    expect(getTerminalNewLineHint(hintInput({ env: { TMUX: "/tmp/tmux-501/default,123,0" } }))).toBeUndefined();
    expect(
      getTerminalNewLineHint(hintInput({ env: { TMUX: "/tmp/tmux-501/default,123,0", TERM_PROGRAM: "WezTerm" } })),
    ).toBeUndefined();
  });

  it("gives the generic notice for an unknown terminal", () => {
    expect(getTerminalNewLineHint(hintInput())).toBe(GENERIC);
    expect(getTerminalNewLineHint(hintInput({ env: { TERM_PROGRAM: "SomeOtherTerm" } }))).toBe(GENERIC);
  });

  it("adds the kitty keyboard config line for WezTerm", () => {
    expect(getTerminalNewLineHint(hintInput({ env: { TERM_PROGRAM: "WezTerm" } }))).toBe(
      `${GENERIC}\nAdd \`config.enable_kitty_keyboard = true\` to ~/.wezterm.lua to enable it.`,
    );
  });

  it("adds the CSI u profile setting for iTerm2", () => {
    expect(getTerminalNewLineHint(hintInput({ env: { TERM_PROGRAM: "iTerm.app" } }))).toBe(
      `${GENERIC}\nIn iTerm2, enable "Report keys using CSI u" under Profiles > Keys.`,
    );
  });

  it("says Apple Terminal cannot report the key when the local modifier fallback is unavailable", () => {
    expect(getTerminalNewLineHint(hintInput({ env: { TERM_PROGRAM: "Apple_Terminal" } }))).toBe(
      "Shift+Enter may submit in Apple Terminal, which cannot report it here. Use Ctrl+J or \\ then Enter for a new line.",
    );
  });

  it("stays silent in Apple Terminal when p's local macOS modifier fallback recovers Shift+Enter", () => {
    expect(
      getTerminalNewLineHint(
        hintInput({ env: { TERM_PROGRAM: "Apple_Terminal" }, appleTerminalShiftEnterFallback: true }),
      ),
    ).toBeUndefined();
  });

  it("names the configured new-line key instead of hardcoding Shift+Enter", () => {
    expect(getTerminalNewLineHint(hintInput({ newLineKeys: ["ctrl+enter"] }))).toBe(
      "Ctrl+Enter may submit in this terminal (no kitty keyboard protocol). Use Ctrl+J or \\ then Enter for a new line.",
    );
    expect(getTerminalNewLineHint(hintInput({ newLineKeys: ["ctrl+shift+enter"] }))).toContain("Ctrl+Shift+Enter may");
    expect(getTerminalNewLineHint(hintInput({ newLineKeys: ["shift+return"] }))).toContain("Shift+Return may");
    expect(getTerminalNewLineHint(hintInput({ newLineKeys: ["super+enter"] }))).toContain("Super+Enter may");
    expect(getTerminalNewLineHint(hintInput({ newLineKeys: ["alt+shift+enter"] }))).toMatch(
      /^(Alt|Option)\+Shift\+Enter may submit/,
    );
  });

  it("lists every configured key that needs modified-key reporting and skips the rest", () => {
    expect(getTerminalNewLineHint(hintInput({ newLineKeys: ["shift+enter", "ctrl+j", "ctrl+enter"] }))).toContain(
      "Shift+Enter/Ctrl+Enter may submit",
    );
  });

  it("stays silent when no configured new-line key depends on modified-key reporting", () => {
    expect(getTerminalNewLineHint(hintInput({ newLineKeys: ["ctrl+j"] }))).toBeUndefined();
    expect(getTerminalNewLineHint(hintInput({ newLineKeys: ["alt+enter"] }))).toBeUndefined();
    expect(getTerminalNewLineHint(hintInput({ newLineKeys: ["shift+tab", "f2"] }))).toBeUndefined();
    expect(getTerminalNewLineHint(hintInput({ newLineKeys: [] }))).toBeUndefined();
  });
});
