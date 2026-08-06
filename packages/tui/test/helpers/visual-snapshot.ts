import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type Component, TUI } from "../../src/tui.ts";
import { VirtualTerminal } from "../virtual-terminal.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = path.join(__dirname, "..", "snapshots");

export interface VisualSnapshotOptions {
  width?: number;
  height?: number;
  updateSnapshots?: boolean;
}

/**
 * Asserts that rendering a TUI component inside VirtualTerminal matches the saved text snapshot.
 * Snapshots are saved in `packages/tui/test/snapshots/<snapshotName>.snap`.
 * Run with UPDATE_SNAPSHOTS=1 to regenerate baseline snapshots.
 */
export async function assertVisualSnapshot(
  component: Component,
  snapshotName: string,
  options: VisualSnapshotOptions = {},
): Promise<void> {
  const width = options.width ?? 80;
  const height = options.height ?? 24;
  const updateSnapshots = options.updateSnapshots ?? process.env.UPDATE_SNAPSHOTS === "1";

  const terminal = new VirtualTerminal(width, height);
  const tui = new TUI(terminal);
  tui.addChild(component);

  tui.start();
  await terminal.flush();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await terminal.flush();

  const viewport = terminal.getViewport();
  tui.stop();

  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }

  const snapshotFile = path.join(SNAPSHOTS_DIR, `${snapshotName}.snap`);
  const actualText = viewport.join("\n");

  if (updateSnapshots || !fs.existsSync(snapshotFile)) {
    fs.writeFileSync(snapshotFile, actualText, "utf8");
    return;
  }

  const expectedText = fs.readFileSync(snapshotFile, "utf8");
  assert.strictEqual(
    actualText,
    expectedText,
    `Visual regression detected in snapshot "${snapshotName}".\nRun with UPDATE_SNAPSHOTS=1 to update baselines if intended.`,
  );
}
