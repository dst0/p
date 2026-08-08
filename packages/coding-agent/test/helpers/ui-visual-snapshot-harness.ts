import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { createHarness, type Harness, type HarnessOptions } from "../suite/harness.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = path.join(__dirname, "..", "snapshots", "ui-regression");

export interface UISnapshotHarnessOptions extends HarnessOptions {
  width?: number;
  height?: number;
}

export interface UIRegressionHarness {
  harness: Harness;
  terminal: VirtualTerminal;
  mode: InteractiveMode;
  flush: () => Promise<void>;
  getViewport: () => string[];
  typeText: (text: string) => Promise<void>;
  sendKey: (key: string) => Promise<void>;
  assertSnapshot: (snapshotName: string) => Promise<void>;
  cleanup: () => void;
}

export function sanitizeUIOutput(text: string): string {
  return text
    .replace(/p v\d+\.\d+\.\d+/g, "p v0.4.169")
    .replace(/ \(([^)\n]+)\)/g, (match, inner) =>
      inner.includes("/") && !/^\d+\/\d+$/.test(inner) ? " (main)" : match,
    )
    .replace(/faux:\d+:[a-z0-9]+/g, "faux:static-id")
    .replace(/🔎[^\n]*/g, "🔎 static-indexing-status");
}

export async function createUIRegressionHarness(options: UISnapshotHarnessOptions = {}): Promise<UIRegressionHarness> {
  const width = options.width ?? 80;
  const height = options.height ?? 24;

  const harness = await createHarness(options);
  const terminal = new VirtualTerminal(width, height);

  const runtimeHost = new AgentSessionRuntime(
    harness.session,
    {
      cwd: "/Users/dst/dev/p/packages/coding-agent",
      agentDir: harness.tempDir,
      authStorage: harness.authStorage,
      modelRegistry: harness.session.modelRegistry,
      settingsManager: harness.settingsManager,
      resourceLoader: harness.session.resourceLoader,
      diagnostics: [],
    },
    async () => ({}) as any,
  );

  const mode = new InteractiveMode(runtimeHost, {});
  // Intercept TUI creation to use VirtualTerminal instead of ProcessTerminal
  (mode as any).ui.terminal = terminal;

  await mode.init();
  terminal.start(
    (data: string) => (mode as any).ui.handleInput(data),
    () => (mode as any).ui.handleResize(),
  );

  const flush = async () => {
    await terminal.flush();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await terminal.flush();
  };

  const getViewport = () => terminal.getViewport();

  const typeText = async (text: string) => {
    terminal.sendInput(text);
    await flush();
  };

  const sendKey = async (key: string) => {
    terminal.sendInput(key);
    await flush();
  };

  const assertSnapshot = async (snapshotName: string) => {
    await flush();
    const viewport = getViewport();
    const updateSnapshots = process.env.UPDATE_SNAPSHOTS === "1";

    if (!fs.existsSync(SNAPSHOTS_DIR)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }

    const snapshotPath = path.join(SNAPSHOTS_DIR, `${snapshotName}.snapshot.txt`);
    const sanitizedActualText = sanitizeUIOutput(viewport.join("\n"));

    if (updateSnapshots || !fs.existsSync(snapshotPath)) {
      fs.writeFileSync(snapshotPath, sanitizedActualText, "utf-8");
      return;
    }

    const expectedText = fs.readFileSync(snapshotPath, "utf-8");
    assert.strictEqual(
      sanitizedActualText,
      expectedText,
      `UI Visual snapshot discrepancy for '${snapshotName}'. Set UPDATE_SNAPSHOTS=1 to accept changes.`,
    );
  };

  const cleanup = () => {
    mode.stop();
    terminal.stop();
    harness.cleanup();
  };

  return {
    harness,
    terminal,
    mode,
    flush,
    getViewport,
    typeText,
    sendKey,
    assertSnapshot,
    cleanup,
  };
}
