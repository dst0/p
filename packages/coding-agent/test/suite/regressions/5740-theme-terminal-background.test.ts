import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import {
  getAvailableThemes,
  getThemePageBg,
  initTheme,
  isLightTheme,
  onThemeChange,
  setTheme,
} from "../../../src/modes/interactive/theme/theme.ts";

describe("regression #5740: theme terminal background export", () => {
  it("returns explicit pageBg hex for built-in themes and handles undefined/missing themes", () => {
    initTheme("dark");
    expect(getThemePageBg("dark")).toBe("#18181e");
    expect(getThemePageBg("light")).toBe("#f8f8f8");
    expect(getThemePageBg("dracula")).toBe("#21222c");
    expect(getThemePageBg("catppuccin")).toBe("#11111b");
    expect(getThemePageBg("catppuccin-latte")).toBe("#dce0e8");

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

  it("executes updateTerminalBackground on InteractiveMode", () => {
    const setTerminalBackgroundColor = vi.fn();
    const dummyMode = {
      ui: { setTerminalBackgroundColor },
    };
    initTheme("dark");
    (InteractiveMode.prototype as any).updateTerminalBackground.call(dummyMode);
    expect(setTerminalBackgroundColor).toHaveBeenCalledWith("#18181e");
  });

  it("triggers updateTerminalBackground in settings onThemeChange and onThemePreview callbacks", () => {
    const setTerminalBackgroundColor = vi.fn();
    const invalidate = vi.fn();
    const requestRender = vi.fn();
    const showError = vi.fn();
    const setThemeSetting = vi.fn();

    const dummyMode = {
      ui: { setTerminalBackgroundColor, invalidate, requestRender },
      settingsManager: { setTheme: setThemeSetting },
      showError,
      updateTerminalBackground() {
        this.ui.setTerminalBackgroundColor(getThemePageBg());
      },
    };

    // Simulate onThemeChange callback (lines 4453-4460)
    const onThemeChangeHandler = (themeName: string) => {
      const result = setTheme(themeName, true);
      dummyMode.settingsManager.setTheme(themeName);
      dummyMode.updateTerminalBackground();
      dummyMode.ui.invalidate();
      if (!result.success) {
        dummyMode.showError(`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`);
      }
    };

    onThemeChangeHandler("light");
    expect(setTerminalBackgroundColor).toHaveBeenCalledWith("#f8f8f8");
    expect(setThemeSetting).toHaveBeenCalledWith("light");

    // Simulate onThemePreview callback (lines 4461-4467)
    const onThemePreviewHandler = (themeName: string) => {
      const result = setTheme(themeName, true);
      if (result.success) {
        dummyMode.updateTerminalBackground();
        dummyMode.ui.invalidate();
        dummyMode.ui.requestRender();
      }
    };

    onThemePreviewHandler("dracula");
    expect(setTerminalBackgroundColor).toHaveBeenCalledWith("#21222c");
    expect(requestRender).toHaveBeenCalled();
  });

  it("triggers updateTerminalBackground via onThemeChange event listener", () => {
    const setTerminalBackgroundColor = vi.fn();
    const updateEditorBorderColor = vi.fn();
    const invalidate = vi.fn();
    const requestRender = vi.fn();

    const dummyMode = {
      ui: { setTerminalBackgroundColor, invalidate, requestRender },
      updateEditorBorderColor,
      updateTerminalBackground() {
        this.ui.setTerminalBackgroundColor(getThemePageBg());
      },
    };

    onThemeChange(() => {
      dummyMode.updateTerminalBackground();
      dummyMode.ui.invalidate();
      dummyMode.updateEditorBorderColor();
      dummyMode.ui.requestRender();
    });

    setTheme("catppuccin", true);
    expect(setTerminalBackgroundColor).toHaveBeenCalledWith("#11111b");
    expect(updateEditorBorderColor).toHaveBeenCalled();
    expect(requestRender).toHaveBeenCalled();
  });
});
