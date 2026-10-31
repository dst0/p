import { stripVTControlCharacters } from "node:util";
import { setKeybindings } from "@dst0/p-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { WarningSettingsSubmenu } from "../src/modes/interactive/components/settings-selector/warningsettingssubmenu.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const DOWN = "\x1b[B";
const ENTER = "\r";

beforeAll(() => {
  initTheme("dark");
});

beforeEach(() => {
  setKeybindings(new KeybindingsManager());
});

describe("WarningSettingsSubmenu", () => {
  it("lists both warnings as enabled by default", () => {
    const submenu = new WarningSettingsSubmenu({}, vi.fn(), vi.fn());

    const text = stripVTControlCharacters(submenu.render(100).join("\n"));

    expect(text).toMatch(/Anthropic extra usage\s+true/);
    expect(text).toMatch(/Terminal new-line hint\s+true/);
  });

  it("toggles the terminal new-line hint without touching the other warning", () => {
    const onChange = vi.fn();
    const submenu = new WarningSettingsSubmenu({ anthropicExtraUsage: false }, onChange, vi.fn());

    submenu.handleInput(DOWN);
    submenu.handleInput(ENTER);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ anthropicExtraUsage: false, terminalNewLine: false });
    expect(stripVTControlCharacters(submenu.render(100).join("\n"))).toMatch(/Terminal new-line hint\s+false/);
  });

  it("turns a disabled terminal new-line hint back on", () => {
    const onChange = vi.fn();
    const submenu = new WarningSettingsSubmenu({ terminalNewLine: false }, onChange, vi.fn());

    submenu.handleInput(DOWN);
    submenu.handleInput(ENTER);

    expect(onChange).toHaveBeenCalledWith({ terminalNewLine: true });
  });

  it("still toggles the Anthropic warning independently", () => {
    const onChange = vi.fn();
    const submenu = new WarningSettingsSubmenu({ terminalNewLine: false }, onChange, vi.fn());

    submenu.handleInput(ENTER);

    expect(onChange).toHaveBeenCalledWith({ anthropicExtraUsage: false, terminalNewLine: false });
  });
});
