import { setCapabilities } from "@dst0/p-tui";
import { describe, expect, it } from "vitest";
import { getAvailableThemesWithPaths, getThemeByName } from "../src/modes/interactive/theme/theme.ts";

describe("holiday themes", () => {
  const holidayThemes = [
    { name: "christmas", symbol: "🎄" },
    { name: "hanukkah", symbol: "✡️" },
    { name: "diwali", symbol: "🪔" },
    { name: "lunarnewyear", symbol: "🧧" },
    { name: "holi", symbol: "🎨" },
    { name: "earthday", symbol: "🌍" },
    { name: "nowruz", symbol: "🌿" },
    { name: "solstice", symbol: "❄️" },
    { name: "halloween", symbol: "🎃" },
    { name: "thanksgiving", symbol: "🍂" },
    { name: "valentine", symbol: "❤️" },
    { name: "st-patricks-day", symbol: "☘️" },
    { name: "sakura", symbol: "🌸" },
    { name: "newyear", symbol: "✨" },
  ];

  it("all holiday themes are available with symbols", () => {
    const available = getAvailableThemesWithPaths();
    for (const holiday of holidayThemes) {
      const found = available.find((t) => t.name === holiday.name);
      expect(found, `${holiday.name} should be available`).toBeDefined();
      expect(found!.symbol).toBe(holiday.symbol);
    }
  });

  it("each holiday theme loads without error", () => {
    for (const holiday of holidayThemes) {
      const theme = getThemeByName(holiday.name);
      expect(theme, `${holiday.name} theme should load`).toBeDefined();
      expect(theme!.name).toBe(holiday.name);
    }
  });

  it("holiday themes produce valid ANSI color codes", () => {
    // Enable truecolor for consistent output
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    for (const holiday of holidayThemes) {
      const theme = getThemeByName(holiday.name);
      expect(theme, `${holiday.name} theme should load`).toBeDefined();
      const colorTokens = [
        "accent",
        "border",
        "borderAccent",
        "text",
        "muted",
        "dim",
        "success",
        "error",
        "warning",
        "thinkingText",
        "mdHeading",
        "mdLink",
        "mdCode",
        "mdCodeBlock",
        "syntaxKeyword",
        "syntaxFunction",
        "syntaxString",
        "syntaxNumber",
      ];
      for (const token of colorTokens) {
        const ansi = theme!.getFgAnsi(token as any);
        expect(ansi, `${holiday.name}.${token} should produce ANSI code`).toMatch(/\x1b\[/);
      }
    }
  });

  it("holiday themes have export colors defined", () => {
    for (const holiday of holidayThemes) {
      const theme = getThemeByName(holiday.name);
      expect(theme, `${holiday.name} theme should load`).toBeDefined();
      // Verify export-related methods work
      expect(theme!.getColorMode()).toBeDefined();
    }
  });
});
