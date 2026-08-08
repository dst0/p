import { beforeEach, describe, expect, it, vi } from "vitest";

const submenuState = vi.hoisted(() => ({
  selectCalls: [] as unknown[][],
  warningCalls: [] as unknown[][],
}));

vi.mock("../src/modes/interactive/components/settings-selector/selectsubmenu.ts", () => ({
  SelectSubmenu: vi.fn(function SelectSubmenu(...args: unknown[]) {
    submenuState.selectCalls.push(args);
    return {};
  }),
}));
vi.mock("../src/modes/interactive/components/settings-selector/warningsettingssubmenu.ts", () => ({
  WarningSettingsSubmenu: vi.fn(function WarningSettingsSubmenu(...args: unknown[]) {
    submenuState.warningCalls.push(args);
    return {};
  }),
}));

import { createSettingsItems } from "../src/modes/interactive/components/settings-selector/settings-items.ts";

function callback<T extends (...args: never[]) => unknown>(value: unknown): T {
  return value as T;
}

beforeEach(() => {
  submenuState.selectCalls.length = 0;
  submenuState.warningCalls.length = 0;
});

describe("settings item submenus", () => {
  it("commits warning and thinking selections", () => {
    const callbacks = {
      onThinkingLevelChange: vi.fn(),
      onWarningsChange: vi.fn(),
    };
    const items = createSettingsItems(
      {
        availableThinkingLevels: ["low", "high"],
        availableThemes: ["dark", "light"],
        currentTheme: "dark",
        thinkingLevel: "low",
        warnings: { anthropicExtraUsage: true },
      } as never,
      callbacks as never,
    );
    const done = vi.fn();

    items.find((item) => item.id === "warnings")?.submenu?.("configure", done);
    const warningArgs = submenuState.warningCalls[0] ?? [];
    callback<(warnings: { anthropicExtraUsage: boolean }) => void>(warningArgs[1])({ anthropicExtraUsage: false });
    callback<() => void>(warningArgs[2])();
    expect(callbacks.onWarningsChange).toHaveBeenCalledWith({ anthropicExtraUsage: false });
    expect(done).toHaveBeenCalledWith();

    items.find((item) => item.id === "thinking")?.submenu?.("low", done);
    const thinkingArgs = submenuState.selectCalls[0] ?? [];
    callback<(value: string) => void>(thinkingArgs[4])("high");
    callback<() => void>(thinkingArgs[5])();
    expect(callbacks.onThinkingLevelChange).toHaveBeenCalledWith("high");
    expect(done).toHaveBeenCalledWith("high");
  });

  it("previews, commits, and restores theme selections", () => {
    const callbacks = {
      onThemeChange: vi.fn(),
      onThemePreview: vi.fn(),
    };
    const items = createSettingsItems(
      {
        availableThinkingLevels: ["off"],
        availableThemes: ["dark", "light"],
        currentTheme: "dark",
        thinkingLevel: "off",
        warnings: {},
      } as never,
      callbacks as never,
    );
    const done = vi.fn();
    items.find((item) => item.id === "theme")?.submenu?.("dark", done);
    const themeArgs = submenuState.selectCalls[0] ?? [];
    callback<(value: string) => void>(themeArgs[6])("light");
    callback<(value: string) => void>(themeArgs[4])("light");
    callback<() => void>(themeArgs[5])();
    expect(callbacks.onThemePreview).toHaveBeenNthCalledWith(1, "light");
    expect(callbacks.onThemeChange).toHaveBeenCalledWith("light");
    expect(callbacks.onThemePreview).toHaveBeenNthCalledWith(2, "dark");
  });
});
