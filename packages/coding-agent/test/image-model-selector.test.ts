import { getImageModel } from "@dst0/p-ai";
import { setKeybindings } from "@dst0/p-tui";
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
  };

  it("renders image models and marks current selection", () => {
    const currentModel = getImageModel("openai", "gpt-image-2");
    const selector = new ImageModelSelectorComponent(
      mockTui as any,
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
      mockTui as any,
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
    const selector = new ImageModelSelectorComponent(mockTui as any, undefined, onSelect, () => {});

    selector.handleInput("\r");
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0]).toHaveProperty("provider");
  });

  it("cancels on cancel key", () => {
    const onCancel = vi.fn();
    const selector = new ImageModelSelectorComponent(mockTui as any, undefined, () => {}, onCancel);

    selector.handleInput("\u001b");
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
