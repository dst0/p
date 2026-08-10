import type { Editor } from "../src/components/editor.ts";
import { TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/** Create a TUI with a virtual terminal for testing */
export function createTestTUI(cols = 80, rows = 24): TUI {
  return new TUI(new VirtualTerminal(cols, rows));
}

/** Standard applyCompletion that replaces prefix with item.value */
export function applyCompletion(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
  item: { value: string },
  prefix: string,
): { lines: string[]; cursorLine: number; cursorCol: number } {
  const line = lines[cursorLine] || "";
  const before = line.slice(0, cursorCol - prefix.length);
  const after = line.slice(cursorCol);
  const newLines = [...lines];
  newLines[cursorLine] = before + item.value + after;
  return {
    lines: newLines,
    cursorLine,
    cursorCol: before.length + item.value.length,
  };
}

export async function flushAutocomplete(): Promise<void> {
  await new Promise((r) => setTimeout(r, 60));
}

export function positionCursor(editor: Editor, line: number, col: number): void {
  for (let i = 0; i < 20; i++) editor.handleInput("\x1b[A");
  for (let i = 0; i < line; i++) editor.handleInput("\x1b[B");
  editor.handleInput("\x01"); // Ctrl+A
  for (let i = 0; i < col; i++) editor.handleInput("\x1b[C");
}
