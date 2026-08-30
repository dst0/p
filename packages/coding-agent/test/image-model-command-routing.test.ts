import { setKeybindings } from "@dst0/p-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";
import { do_setupEditorSubmitHandler } from "../src/modes/interactive/interactive-mode/interactivemode-methods/editor-submit.ts";
import {
  do_handleImageModelCommand,
  do_showImageModelSelector,
} from "../src/modes/interactive/interactive-mode/interactivemode-methods/model-command.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("image model command routing", () => {
  beforeAll(() => {
    initTheme("dark");
    setKeybindings(new KeybindingsManager());
  });

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

  it("forwards direct image-model handling to the selector", async () => {
    const showImageModelSelector = vi.fn();
    await do_handleImageModelCommand({ showImageModelSelector } as unknown as InteractiveMode, "flux2");
    expect(showImageModelSelector).toHaveBeenCalledWith("flux2");
  });

  it("completes selector cancellation and requests a render", () => {
    const done = vi.fn();
    const requestRender = vi.fn();
    let selector: { handleInput(key: string): void } | undefined;
    const mode = {
      ui: { requestRender },
      session: { getImageModel: () => undefined, modelRegistry: { getAll: () => [] } },
      settingsManager: {
        getDefaultImageProvider: () => undefined,
        getDefaultImageModel: () => undefined,
      },
      showSelector: (factory: (doneCallback: () => void) => { component: { handleInput(key: string): void } }) => {
        selector = factory(done).component;
      },
    } as unknown as InteractiveMode;
    do_showImageModelSelector(mode);
    selector?.handleInput("\u001b");
    expect(done).toHaveBeenCalledOnce();
    expect(requestRender).toHaveBeenCalledOnce();
  });
});
