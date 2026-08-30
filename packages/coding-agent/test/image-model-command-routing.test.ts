import { describe, expect, it, vi } from "vitest";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";
import { do_setupEditorSubmitHandler } from "../src/modes/interactive/interactive-mode/interactivemode-methods/editor-submit.ts";

describe("image model command routing", () => {
  it.each([
    ["/model:image", undefined],
    ["/model:image flux2", "flux2"],
    ["/image-model gpt-image", "gpt-image"],
  ])("routes %s to the image model selector", async (command, expectedSearch) => {
    const defaultEditor: { onSubmit?: (text: string) => Promise<void> } = {};
    const setText = vi.fn();
    const addToHistory = vi.fn();
    const handleImageModelCommand = vi.fn(async () => {});
    const mode = {
      defaultEditor,
      editor: { setText, addToHistory },
      handleImageModelCommand,
    } as unknown as InteractiveMode;
    do_setupEditorSubmitHandler(mode);

    await defaultEditor.onSubmit?.(command);

    expect(addToHistory).toHaveBeenCalledWith(command);
    expect(setText).toHaveBeenCalledWith("");
    expect(handleImageModelCommand).toHaveBeenCalledWith(expectedSearch);
  });
});
