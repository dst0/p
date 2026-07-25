import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import {
  getAvailableThemes,
  getThemePageBg,
  initTheme,
  isLightTheme,
  setTheme,
} from "../../../src/modes/interactive/theme/theme.ts";
import { createHarness, type Harness } from "../harness.ts";

describe("regression #5740: theme terminal background export", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("returns explicit pageBg hex for built-in themes and handles undefined/missing themes", () => {
    initTheme("dark");
    expect(getThemePageBg("dark")).toBe("#18181e");
    expect(getThemePageBg("light")).toBe("#f8f8f8");
    expect(getThemePageBg("dracula")).toBe("#21222c");
    expect(getThemePageBg("catppuccin")).toBe("#11111b");
    expect(getThemePageBg("catppuccin-latte")).toBe("#dce0e8");

    // Default parameter (undefined) uses current theme ("dark")
    expect(getThemePageBg()).toBe("#18181e");

    // Line 989 coverage: missing theme or no pageBg returns undefined
    expect(getThemePageBg("nonexistent-theme-xyz")).toBeUndefined();
  });

  it("correctly identifies light themes and handles fallback for unknown themes", () => {
    expect(isLightTheme("light")).toBe(true);
    expect(isLightTheme("github-light")).toBe(true);
    expect(isLightTheme("catppuccin-latte")).toBe(true);
    expect(isLightTheme("dark")).toBe(false);
    expect(isLightTheme("dracula")).toBe(false);

    // Line 1005 coverage: unknown theme fallback
    expect(isLightTheme("unknown-theme-dark")).toBe(false);
    expect(isLightTheme("unknown-theme-light")).toBe(true);

    // Default parameter (undefined) uses current theme
    expect(isLightTheme()).toBe(false);
  });

  it("returns all available built-in themes including light and Japanese aesthetics", () => {
    const available = getAvailableThemes();
    expect(available).toContain("dark");
    expect(available).toContain("light");
    expect(available).toContain("dracula");
    expect(available).toContain("sakura");
    expect(available).toContain("kanagawa");
    expect(available).toContain("matcha");
    expect(available).toContain("cyberpunk-tokyo");
  });

  it("exercises updateTerminalBackground, detectThemeIfUnset, and showSettingsSelector in InteractiveMode", async () => {
    const harness = await createHarness();
    harnesses.push(harness);

    const runtimeHost = {
      session: harness.session,
      setBeforeSessionInvalidate: vi.fn(),
      setRebindSession: vi.fn(),
      dispose: async () => {},
    } as any;
    const mode = new InteractiveMode(runtimeHost);
    const setTerminalBackgroundColor = vi.spyOn((mode as any).ui, "setTerminalBackgroundColor");

    // Line 460 / 464 / 465 coverage
    (mode as any).updateTerminalBackground();
    expect(setTerminalBackgroundColor).toHaveBeenCalledWith("#18181e");

    // Line 486 coverage (detectThemeIfUnset)
    harness.settingsManager.setTheme("");
    vi.spyOn((mode as any).ui, "queryTerminalBackgroundColor").mockResolvedValue({ r: 0, g: 0, b: 0 });
    await (mode as any).detectThemeIfUnset();
    expect(setTerminalBackgroundColor).toHaveBeenCalled();

    // Lines 4456 and 4465 coverage (showSettingsSelector callbacks)
    let selectorComponent: any;
    (mode as any).showSelector = (fn: any) => {
      const res = fn(() => {});
      selectorComponent = res.component || res;
    };
    (mode as any).showSettingsSelector();

    const settingsList = selectorComponent.getSettingsList();
    expect(settingsList).toBeDefined();

    const items = (settingsList as any).items;
    const themeItem = items.find((item: any) => item.label === "Theme");
    expect(themeItem).toBeDefined();

    const submenu = themeItem.submenu("dark", () => {});
    // Test onThemeChange callback in interactive-mode.ts (line 4456)
    (submenu as any).selectList.onSelect({ value: "light" });
    expect(setTerminalBackgroundColor).toHaveBeenCalledWith("#f8f8f8");

    // Test onThemePreview callback in interactive-mode.ts (line 4465)
    (submenu as any).selectList.onSelectionChange?.({ value: "dracula" });
    expect(setTerminalBackgroundColor).toHaveBeenCalledWith("#21222c");

    (submenu as any).selectList.onCancel?.();
  });

  it("triggers updateTerminalBackground via onThemeChange watcher registered in mode.init()", async () => {
    const harness = await createHarness();
    harnesses.push(harness);

    const runtimeHost = {
      session: harness.session,
      setBeforeSessionInvalidate: vi.fn(),
      setRebindSession: vi.fn(),
      dispose: async () => {},
    } as any;
    const mode = new InteractiveMode(runtimeHost);
    const setTerminalBackgroundColor = vi.spyOn((mode as any).ui, "setTerminalBackgroundColor");

    vi.spyOn(mode as any, "rebindCurrentSession").mockResolvedValue(undefined);
    vi.spyOn((mode as any).ui, "requestRender").mockImplementation(() => {});

    await mode.init();

    // Trigger theme change which executes line 799 in interactive-mode.ts
    setTheme("catppuccin", true);
    expect(setTerminalBackgroundColor).toHaveBeenCalledWith("#11111b");
  });
});
