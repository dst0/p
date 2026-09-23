import { Container, resetCapabilitiesCache, setCapabilities } from "@dst0/p-tui";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";
import { do_showNewVersionNotification } from "../src/modes/interactive/interactive-mode/interactivemode-methods/ui-utilities.ts";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

function renderNotification(release: { version: string; note?: string }): { text: string; requestRender: unknown } {
  const chatContainer = new Container();
  const requestRender = vi.fn();
  const mode = {
    chatContainer,
    ui: { requestRender },
    getMarkdownThemeWithSettings: getMarkdownTheme,
  } as unknown as InteractiveMode;

  do_showNewVersionNotification(mode, release);

  return { text: chatContainer.render(120).join("\n"), requestRender };
}

const originalPackageDir = process.env.P_PACKAGE_DIR;

beforeAll(() => {
  // Built-in themes resolve from the package directory, so an inherited override must not redirect them.
  delete process.env.P_PACKAGE_DIR;
  initTheme("dark");
});

afterAll(() => {
  if (originalPackageDir !== undefined) process.env.P_PACKAGE_DIR = originalPackageDir;
});

afterEach(() => {
  resetCapabilitiesCache();
});

describe("update available notification", () => {
  it("links to the fork's GitHub release for the new version and shows its notes", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });

    const { text, requestRender } = renderNotification({ version: "1.2.4", note: "### Fixed\n\n- Registry update" });

    expect(text).toContain("New version 1.2.4 is available");
    expect(text).toContain("https://github.com/dst0/p/releases/tag/v1.2.4");
    expect(text).toContain("Registry update");
    expect(requestRender).toHaveBeenCalledOnce();
  });

  it("uses an OSC 8 hyperlink to the same release when the terminal supports it", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: true });

    const { text } = renderNotification({ version: "1.2.4" });

    expect(text).toContain("\x1b]8;;https://github.com/dst0/p/releases/tag/v1.2.4\x1b\\");
    expect(text).toContain("open changelog");
  });

  it("omits the notes block when no release notes are available", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });

    const withoutNote = renderNotification({ version: "1.2.4" }).text;
    const withBlankNote = renderNotification({ version: "1.2.4", note: "   " }).text;
    const withNote = renderNotification({ version: "1.2.4", note: "- Registry update" }).text;

    expect(withBlankNote).toBe(withoutNote);
    expect(withoutNote).toContain("https://github.com/dst0/p/releases/tag/v1.2.4");
    expect(withNote.split("\n").length).toBeGreaterThan(withoutNote.split("\n").length);
    expect(withoutNote).not.toContain("Registry update");
  });
});
