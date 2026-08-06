import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type Component, TUI } from "../../src/tui.ts";
import { VirtualTerminal } from "../virtual-terminal.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = path.join(__dirname, "..", "snapshots");

export class LoggingVirtualTerminal extends VirtualTerminal {
  private writes: string[] = [];

  override write(data: string): void {
    this.writes.push(data);
    super.write(data);
  }

  getWrites(): string {
    return this.writes.join("");
  }

  clearWrites(): void {
    this.writes = [];
  }
}

export interface VisualSnapshotOptions {
  width?: number;
  height?: number;
  updateSnapshots?: boolean;
}

/**
 * Asserts that rendering a TUI component inside VirtualTerminal matches the saved text snapshot.
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

export interface ScrollSnapshotOptions extends VisualSnapshotOptions {
  action: (tui: TUI, terminal: LoggingVirtualTerminal) => Promise<void> | void;
}

/**
 * Asserts visual regression and verifies no \x1b[2J artifact escape sequence occurs during scroll or redraw operations.
 */
export async function assertScrollVisualSnapshot(
  component: Component,
  snapshotName: string,
  options: ScrollSnapshotOptions,
): Promise<void> {
  const width = options.width ?? 80;
  const height = options.height ?? 10;
  const updateSnapshots = options.updateSnapshots ?? process.env.UPDATE_SNAPSHOTS === "1";

  const terminal = new LoggingVirtualTerminal(width, height);
  const tui = new TUI(terminal);
  tui.addChild(component);

  tui.start();
  await terminal.flush();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await terminal.flush();

  terminal.clearWrites();
  await options.action(tui, terminal);
  await terminal.flush();

  const writes = terminal.getWrites();
  assert.ok(
    !writes.includes("\x1b[2J"),
    `Scroll redraw emitted \\x1b[2J which causes terminal scrollback artifacts in snapshot "${snapshotName}".`,
  );

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
    `Visual regression detected after scrolling in snapshot "${snapshotName}".\nRun with UPDATE_SNAPSHOTS=1 to update baselines if intended.`,
  );
}
