import { describe, expect, it } from "vitest";
import {
  getAvailableThemes,
  getThemePageBg,
  initTheme,
  isLightTheme,
} from "../../../src/modes/interactive/theme/theme.ts";

describe("regression #5740: theme terminal background export", () => {
  it("returns explicit pageBg hex for built-in themes", () => {
    initTheme("dark");
    expect(getThemePageBg("dark")).toBe("#18181e");
    expect(getThemePageBg("light")).toBe("#f8f8f8");
    expect(getThemePageBg("dracula")).toBe("#21222c");
    expect(getThemePageBg("catppuccin")).toBe("#11111b");
    expect(getThemePageBg("catppuccin-latte")).toBe("#dce0e8");
  });

  it("correctly identifies light themes", () => {
    expect(isLightTheme("light")).toBe(true);
    expect(isLightTheme("github-light")).toBe(true);
    expect(isLightTheme("catppuccin-latte")).toBe(true);
    expect(isLightTheme("dark")).toBe(false);
    expect(isLightTheme("dracula")).toBe(false);
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
});
