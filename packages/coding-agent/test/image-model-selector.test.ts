import { getImageModel } from "@dst0/p-ai";
import { Input, setKeybindings, type TUI } from "@dst0/p-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ImageModelSelectorComponent } from "../src/modes/interactive/components/image-model-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("ImageModelSelectorComponent", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  const mockTui = {
    requestRender: vi.fn(),
  } as unknown as TUI;

  it("renders image models and marks current selection", () => {
    const currentModel = getImageModel("openai", "gpt-image-2");
    const selector = new ImageModelSelectorComponent(
      mockTui,
      currentModel,
      () => {},
      () => {},
    );

    const output = stripAnsi(selector.render(120).join("\n"));
    expect(output).toContain("Select Image Generation Model");
    expect(output).toContain("[openai]");
    expect(output).toContain("(current)");
  });

  it("filters image models on search input for openai and llm-orchestrator", () => {
    const selector = new ImageModelSelectorComponent(
      mockTui,
      undefined,
      () => {},
      () => {},
      "flux2",
    );

    const output = stripAnsi(selector.render(120).join("\n"));
    expect(output).toContain("FLUX.2 Klein 4B");
    expect(output).toContain("[llm-orchestrator]");
  });

  it("selects model on confirm key", () => {
    const onSelect = vi.fn();
    const selector = new ImageModelSelectorComponent(mockTui, undefined, onSelect, () => {});

    selector.handleInput("\r");
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0]).toHaveProperty("provider");
  });

  it("cancels on cancel key", () => {
    const onCancel = vi.fn();
    const selector = new ImageModelSelectorComponent(mockTui, undefined, () => {}, onCancel);

    selector.handleInput("\u001b");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps focus synchronized with its search input and submits from that input", () => {
    const onSelect = vi.fn();
    const selector = new ImageModelSelectorComponent(mockTui, undefined, onSelect, () => {});
    selector.focused = true;
    expect(selector.focused).toBe(true);
    const input = selector.children.find((child) => child instanceof Input);
    expect(input).toBeInstanceOf(Input);
    input?.handleInput("\r");
    expect(onSelect).toHaveBeenCalledOnce();
    selector.focused = false;
    expect(selector.focused).toBe(false);
  });

  it("renders empty search results and safely ignores navigation and submit", () => {
    const onSelect = vi.fn();
    const selector = new ImageModelSelectorComponent(mockTui, undefined, onSelect, () => {}, "no-such-image-model");
    expect(stripAnsi(selector.render(120).join("\n"))).toContain("No image models found");
    selector.handleInput("\u001b[A");
    selector.handleInput("\u001b[B");
    selector.handleInput("\r");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("wraps keyboard navigation and refilters after ordinary input", () => {
    const selector = new ImageModelSelectorComponent(
      mockTui,
      undefined,
      () => {},
      () => {},
    );
    const selectedLine = (): string | undefined =>
      stripAnsi(selector.render(120).join("\n"))
        .split("\n")
        .find((line) => line.includes("▶"));
    const initialSelection = selectedLine();
    selector.handleInput("\u001b[A");
    expect(selectedLine()).not.toBe(initialSelection);
    selector.handleInput("\u001b[B");
    expect(selectedLine()).toBe(initialSelection);
    for (const character of "flux2") selector.handleInput(character);
    expect(mockTui.requestRender).toHaveBeenCalled();
    const filtered = stripAnsi(selector.render(120).join("\n"));
    expect(filtered).toContain("FLUX.2 Klein 4B");
    expect(filtered).not.toContain("[openai]");
  });
});
