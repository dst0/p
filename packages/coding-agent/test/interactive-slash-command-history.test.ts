import { Editor } from "@dst0/p-tui";
import { describe, expect, it, vi } from "vitest";
import { createTestTUI } from "../../tui/test/editor-test-helpers.ts";
import { defaultEditorTheme } from "../../tui/test/test-themes.ts";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type InteractiveModePrivate = {
  setupEditorSubmitHandler(): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

function createInteractiveModeContext(): { editor: Editor; mode: InteractiveMode } {
  const editor = new Editor(createTestTUI(), defaultEditorTheme);
  const mode = {
    defaultEditor: editor,
    editor,
    session: {
      isCompacting: false,
      isStreaming: false,
      isBashRunning: false,
      prompt: vi.fn(async () => {}),
    },
    flushPendingBashComponents: vi.fn(),
    pendingUserInputs: [],
    showSettingsSelector: vi.fn(),
    handlePlanCommand: vi.fn(async () => {}),
    showModelsSelector: vi.fn(async () => {}),
    handleModelCommand: vi.fn(async () => {}),
    handleExportCommand: vi.fn(async () => {}),
    handleImportCommand: vi.fn(async () => {}),
    handleShareCommand: vi.fn(async () => {}),
    handleCopyCommand: vi.fn(async () => {}),
    handleNameCommand: vi.fn(),
    handleSessionCommand: vi.fn(),
    handleChangelogCommand: vi.fn(),
    handleHotkeysCommand: vi.fn(),
    showUserMessageSelector: vi.fn(),
    handleCloneCommand: vi.fn(async () => {}),
    showTreeSelector: vi.fn(),
    showTrustSelector: vi.fn(),
    showOAuthSelector: vi.fn(async () => {}),
    handleClearCommand: vi.fn(async () => {}),
    handleCompactCommand: vi.fn(async () => {}),
    handleStateCommand: vi.fn(),
    handleMemoryCommand: vi.fn(),
    handleRulesCommand: vi.fn(),
    handleLearnCommand: vi.fn(),
    handleReloadCommand: vi.fn(async () => {}),
    handleIndexCommand: vi.fn(async () => {}),
    handleDebugCommand: vi.fn(),
    handleArminSaysHi: vi.fn(),
    handleDementedDelves: vi.fn(),
    showSessionSelector: vi.fn(),
    shutdown: vi.fn(async () => {}),
    isExtensionCommand: vi.fn(() => false),
    queueCompactionMessage: vi.fn(),
    handleBashCommand: vi.fn(async () => {}),
  } as unknown as InteractiveMode;
  interactiveModePrototype.setupEditorSubmitHandler.call(mode);
  return { editor, mode };
}

async function submitAndRecall(command: string): Promise<string> {
  const { editor } = createInteractiveModeContext();
  await editor.onSubmit?.(command);
  editor.handleInput("\x1b[A");
  return editor.getText();
}

describe("Interactive slash command prompt history", () => {
  for (const { name } of BUILTIN_SLASH_COMMANDS) {
    it(`recalls /${name} with Up arrow`, async () => {
      await expect(submitAndRecall(`/${name}`)).resolves.toBe(`/${name}`);
    });
  }

  it.each([
    "/plan include risks",
    "/model provider/model",
    "/export /tmp/session.html",
    "/import /tmp/session.jsonl",
    "/name focused session",
    "/compact --dry-run retain decisions",
    "/memory status",
    "/rules lint",
    "/index status",
  ])("recalls the complete argument-bearing command %s", async (command) => {
    await expect(submitAndRecall(command)).resolves.toBe(command);
  });

  it.each(["/debug", "/arminsayshi", "/dementedelves"])("recalls hidden command %s", async (command) => {
    await expect(submitAndRecall(command)).resolves.toBe(command);
  });

  it("recalls dynamically registered slash commands through the normal prompt path", async () => {
    await expect(submitAndRecall("/extension-command argument")).resolves.toBe("/extension-command argument");
  });

  it("traverses built-in, dynamic, and normal prompts in submission order", async () => {
    const { editor } = createInteractiveModeContext();
    await editor.onSubmit?.("normal prompt");
    await editor.onSubmit?.("/extension-command argument");
    await editor.onSubmit?.("/model provider/model");

    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("/model provider/model");
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("/extension-command argument");
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("normal prompt");
  });
});
