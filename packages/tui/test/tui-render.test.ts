import assert from "node:assert";
import { describe, it } from "node:test";
import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Image } from "../src/components/image.ts";
import {
  deleteKittyImage,
  encodeKitty,
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
} from "../src/terminal-image.ts";
import { type Component, TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class TestComponent implements Component {
  lines: string[] = [];
  render(_width: number): string[] {
    return this.lines;
  }
  invalidate(): void {}
}

class LoggingVirtualTerminal extends VirtualTerminal {
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

async function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previousValues = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function getCellItalic(terminal: VirtualTerminal, row: number, col: number): number {
  const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
  const buffer = xterm.buffer.active;
  const line = buffer.getLine(buffer.viewportY + row);
  assert.ok(line, `Missing buffer line at row ${row}`);
  const cell = line.getCell(col);
  assert.ok(cell, `Missing cell at row ${row} col ${col}`);
  return cell.isItalic();
}

describe("TUI Kitty image cleanup", () => {
  it("clears reserved Kitty image rows before drawing appended image placements", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const terminal = new LoggingVirtualTerminal(40, 10);
      const tui = new TUI(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = ["before"];
      tui.start();
      await terminal.waitForRender();
      terminal.clearWrites();

      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 2 },
        { widthPx: 20, heightPx: 20 },
      );
      const imageLines = image.render(40);
      const imageSequence = imageLines[0];
      component.lines = ["before", ...imageLines, "after"];
      tui.requestRender();
      await terminal.waitForRender();

      const writes = terminal.getWrites();
      assert.ok(
        writes.includes(`\x1b[2K\r\n\x1b[2K\x1b[1A${imageSequence}\x1b[1B`),
        "reserved rows should be cleared before the image placement is drawn",
      );
      assert.ok(
        !writes.includes(`${imageSequence}\r\n\x1b[2K`),
        "reserved row clears must not run after the image placement is drawn",
      );

      tui.stop();
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });

  it("falls back to full redraw when Kitty image pre-clear would scroll", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const terminal = new LoggingVirtualTerminal(40, 2);
      const tui = new TUI(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = ["before"];
      tui.start();
      await terminal.waitForRender();
      const redrawsBeforeImage = tui.fullRedraws;
      terminal.clearWrites();

      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 3 },
        { widthPx: 30, heightPx: 30 },
      );
      component.lines = ["before", ...image.render(40), "after"];
      tui.requestRender();
      await terminal.waitForRender();

      assert.ok(tui.fullRedraws > redrawsBeforeImage, "unsafe image pre-clear should force a full redraw");
      assert.ok(terminal.getWrites().includes("\x1b[2J"), "fallback should clear and fully redraw");

      tui.stop();
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });

  it("reserves Kitty image rows before drawing during full redraw fallbacks", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const terminal = new LoggingVirtualTerminal(40, 5);
      const tui = new TUI(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = ["l0", "l1", "l2", "l3", "l4"];
      tui.start();
      await terminal.waitForRender();
      const redrawsBeforeImage = tui.fullRedraws;
      terminal.clearWrites();

      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 3 },
        { widthPx: 30, heightPx: 30 },
      );
      const imageLines = image.render(40);
      const imageSequence = imageLines[0];
      component.lines = ["l0", "l1", "l2", "l3", "l4", ...imageLines, "after"];
      tui.requestRender();
      await terminal.waitForRender();

      const writes = terminal.getWrites();
      assert.ok(tui.fullRedraws > redrawsBeforeImage, "scrolling image append should force a full redraw");
      assert.ok(
        writes.includes(`\r\n\r\n\x1b[2A${imageSequence}\x1b[2B`),
        "full redraw should reserve visible image rows before drawing the placement",
      );
      assert.ok(
        !writes.includes(`${imageSequence}\r\n\x1b[0m`),
        "full redraw must not write reserved padding rows after drawing the placement",
      );

      tui.stop();
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });

  it("does not use cursor-up placement for Kitty images taller than the viewport", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const terminal = new LoggingVirtualTerminal(40, 5);
      const tui = new TUI(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = ["before"];
      tui.start();
      await terminal.waitForRender();
      terminal.clearWrites();

      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 6 },
        { widthPx: 60, heightPx: 60 },
      );
      const imageLines = image.render(40);
      const imageSequence = imageLines[0];
      assert.ok(imageLines.length > terminal.rows, "test image should exceed the viewport height");

      component.lines = ["before", ...imageLines, "after"];
      tui.requestRender(true);
      await terminal.waitForRender();

      const writes = terminal.getWrites();
      assert.ok(writes.includes(imageSequence), "image placement should be drawn");
      assert.ok(
        !writes.includes(`\x1b[${imageLines.length - 1}A${imageSequence}`),
        "taller-than-viewport images must keep the #4461 first-row placement path",
      );

      tui.stop();
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });

  it("deletes changed image ids before drawing moved placements", async () => {
    const terminal = new LoggingVirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    const oldImage = encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 42, moveCursor: false });
    component.lines = ["top", oldImage];
    tui.start();
    await terminal.waitForRender();
    terminal.clearWrites();

    const newImage = encodeKitty("BBBB", { columns: 2, rows: 1, imageId: 42, moveCursor: false });
    component.lines = [newImage, ""];
    tui.requestRender();
    await terminal.waitForRender();

    const writes = terminal.getWrites();
    const deleteIndex = writes.indexOf(deleteKittyImage(42));
    const drawIndex = writes.indexOf(newImage);
    assert.ok(deleteIndex >= 0, "changed old image should be deleted");
    assert.ok(drawIndex >= 0, "new image should be drawn");
    assert.ok(deleteIndex < drawIndex, "old image must be deleted before the new placement is drawn");

    tui.stop();
  });

  it("redraws image lines when an earlier reserved image row changes", async () => {
    const terminal = new LoggingVirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    const image = encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 88, moveCursor: false });
    component.lines = ["", image];
    tui.start();
    await terminal.waitForRender();
    terminal.clearWrites();

    component.lines = ["covered", image];
    tui.requestRender();
    await terminal.waitForRender();

    const writes = terminal.getWrites();
    const deleteIndex = writes.indexOf(deleteKittyImage(88));
    const drawIndex = writes.indexOf(image);
    assert.ok(deleteIndex >= 0, "image should be deleted when a reserved row changes");
    assert.ok(drawIndex >= 0, "unchanged image line should be redrawn after deleting the placement");
    assert.ok(deleteIndex < drawIndex, "old placement must be deleted before the image line is redrawn");
    assert.ok(!writes.includes("\x1b[2J"), "reserved row changes should not force a full redraw");

    tui.stop();
  });

  it("deletes previously rendered image ids during full redraws", async () => {
    const terminal = new LoggingVirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = [encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 77, moveCursor: false })];
    tui.start();
    await terminal.waitForRender();
    terminal.clearWrites();

    component.lines = ["plain text"];
    tui.requestRender(true);
    await terminal.waitForRender();

    const writes = terminal.getWrites();
    const deleteIndex = writes.indexOf(deleteKittyImage(77));
    const clearIndex = writes.indexOf("\x1b[2J");
    assert.ok(deleteIndex >= 0, "previous image should be deleted during full redraw");
    assert.ok(clearIndex >= 0, "full redraw should clear the screen");
    assert.ok(deleteIndex < clearIndex, "old image should be deleted before the screen is cleared");

    tui.stop();
  });
});

describe("TUI resize handling", () => {
  it("triggers full re-render when terminal height changes", async () => {
    await withEnv({ TERMUX_VERSION: undefined }, async () => {
      const terminal = new VirtualTerminal(40, 10);
      const tui = new TUI(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = ["Line 0", "Line 1", "Line 2"];
      tui.start();
      await terminal.waitForRender();

      const initialRedraws = tui.fullRedraws;

      // Resize height
      terminal.resize(40, 15);
      await terminal.waitForRender();

      // Should have triggered a full redraw
      assert.ok(tui.fullRedraws > initialRedraws, "Height change should trigger full redraw");

      const viewport = terminal.getViewport();
      assert.ok(viewport[0]?.includes("Line 0"), "Content preserved after height change");

      tui.stop();
    });
  });

  it("skips full re-render on height changes in Termux", async () => {
    await withEnv({ TERMUX_VERSION: "1" }, async () => {
      const terminal = new LoggingVirtualTerminal(40, 10);
      const tui = new TUI(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = Array.from({ length: 20 }, (_, i) => `Line ${i}`);
      tui.start();
      await terminal.waitForRender();
      terminal.clearWrites();

      const initialRedraws = tui.fullRedraws;
      for (const height of [15, 8, 14, 11]) {
        terminal.resize(40, height);
        await terminal.waitForRender();
      }

      assert.strictEqual(tui.fullRedraws, initialRedraws, "Height change should not trigger full redraw");
      assert.ok(!terminal.getWrites().includes("\x1b[2J"), "Height change should not clear the screen");
      assert.ok(!terminal.getWrites().includes("\x1b[3J"), "Height change should not clear scrollback");

      const viewport = terminal.getViewport();
      assert.ok(viewport.join("\n").includes("Line 19"), "Latest content remains visible after resize");

      tui.stop();
    });
  });

  it("triggers full re-render when terminal width changes", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2"];
    tui.start();
    await terminal.waitForRender();

    const initialRedraws = tui.fullRedraws;

    // Resize width
    terminal.resize(60, 10);
    await terminal.waitForRender();

    // Should have triggered a full redraw
    assert.ok(tui.fullRedraws > initialRedraws, "Width change should trigger full redraw");

    tui.stop();
  });
});

describe("TUI content shrinkage", () => {
  it("clears empty rows when content shrinks significantly", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    tui.setClearOnShrink(true); // Explicitly enable (may be disabled via env var)
    const component = new TestComponent();
    tui.addChild(component);

    // Start with many lines
    component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4", "Line 5"];
    tui.start();
    await terminal.waitForRender();

    const initialRedraws = tui.fullRedraws;

    // Shrink to fewer lines
    component.lines = ["Line 0", "Line 1"];
    tui.requestRender();
    await terminal.waitForRender();

    // Should have triggered a full redraw to clear empty rows
    assert.ok(tui.fullRedraws > initialRedraws, "Content shrinkage should trigger full redraw");

    const viewport = terminal.getViewport();
    assert.ok(viewport[0]?.includes("Line 0"), "First line preserved");
    assert.ok(viewport[1]?.includes("Line 1"), "Second line preserved");
    // Lines below should be empty (cleared)
    assert.strictEqual(viewport[2]?.trim(), "", "Line 2 should be cleared");
    assert.strictEqual(viewport[3]?.trim(), "", "Line 3 should be cleared");

    tui.stop();
  });

  it("handles shrink to single line", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    tui.setClearOnShrink(true); // Explicitly enable (may be disabled via env var)
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
    tui.start();
    await terminal.waitForRender();

    // Shrink to single line
    component.lines = ["Only line"];
    tui.requestRender();
    await terminal.waitForRender();

    const viewport = terminal.getViewport();
    assert.ok(viewport[0]?.includes("Only line"), "Single line rendered");
    assert.strictEqual(viewport[1]?.trim(), "", "Line 1 should be cleared");

    tui.stop();
  });

  it("handles shrink to empty", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    tui.setClearOnShrink(true); // Explicitly enable (may be disabled via env var)
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2"];
    tui.start();
    await terminal.waitForRender();

    // Shrink to empty
    component.lines = [];
    tui.requestRender();
    await terminal.waitForRender();

    const viewport = terminal.getViewport();
    // All lines should be empty
    assert.strictEqual(viewport[0]?.trim(), "", "Line 0 should be cleared");
    assert.strictEqual(viewport[1]?.trim(), "", "Line 1 should be cleared");

    tui.stop();
  });
});

describe("TUI differential rendering", () => {
  it("tracks cursor correctly when content shrinks with unchanged remaining lines", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    // Initial render: 5 identical lines
    component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4"];
    tui.start();
    await terminal.waitForRender();

    // Shrink to 3 lines, all identical to before (no content changes in remaining lines)
    component.lines = ["Line 0", "Line 1", "Line 2"];
    tui.requestRender();
    await terminal.waitForRender();

    // cursorRow should be 2 (last line of new content)
    // Verify by doing another render with a change on line 1
    component.lines = ["Line 0", "CHANGED", "Line 2"];
    tui.requestRender();
    await terminal.waitForRender();

    const viewport = terminal.getViewport();
    // Line 1 should show "CHANGED", proving cursor tracking was correct
    assert.ok(viewport[1]?.includes("CHANGED"), `Expected "CHANGED" on line 1, got: ${viewport[1]}`);

    tui.stop();
  });

  it("renders correctly when only a middle line changes (spinner case)", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    // Initial render
    component.lines = ["Header", "Working...", "Footer"];
    tui.start();
    await terminal.waitForRender();

    // Simulate spinner animation - only middle line changes
    const spinnerFrames = ["|", "/", "-", "\\"];
    for (const frame of spinnerFrames) {
      component.lines = ["Header", `Working ${frame}`, "Footer"];
      tui.requestRender();
      await terminal.waitForRender();

      const viewport = terminal.getViewport();
      assert.ok(viewport[0]?.includes("Header"), `Header preserved: ${viewport[0]}`);
      assert.ok(viewport[1]?.includes(`Working ${frame}`), `Spinner updated: ${viewport[1]}`);
      assert.ok(viewport[2]?.includes("Footer"), `Footer preserved: ${viewport[2]}`);
    }

    tui.stop();
  });

  it("resets styles after each rendered line", async () => {
    const terminal = new VirtualTerminal(20, 6);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["\x1b[3mItalic", "Plain"];
    tui.start();
    await terminal.waitForRender();

    assert.strictEqual(getCellItalic(terminal, 1, 0), 0);
    tui.stop();
  });

  it("renders correctly when first line changes but rest stays same", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
    tui.start();
    await terminal.waitForRender();

    // Change only first line
    component.lines = ["CHANGED", "Line 1", "Line 2", "Line 3"];
    tui.requestRender();
    await terminal.waitForRender();

    const viewport = terminal.getViewport();
    assert.ok(viewport[0]?.includes("CHANGED"), `First line changed: ${viewport[0]}`);
    assert.ok(viewport[1]?.includes("Line 1"), `Line 1 preserved: ${viewport[1]}`);
    assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
    assert.ok(viewport[3]?.includes("Line 3"), `Line 3 preserved: ${viewport[3]}`);

    tui.stop();
  });

  it("renders correctly when last line changes but rest stays same", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
    tui.start();
    await terminal.waitForRender();

    // Change only last line
    component.lines = ["Line 0", "Line 1", "Line 2", "CHANGED"];
    tui.requestRender();
    await terminal.waitForRender();

    const viewport = terminal.getViewport();
    assert.ok(viewport[0]?.includes("Line 0"), `Line 0 preserved: ${viewport[0]}`);
    assert.ok(viewport[1]?.includes("Line 1"), `Line 1 preserved: ${viewport[1]}`);
    assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
    assert.ok(viewport[3]?.includes("CHANGED"), `Last line changed: ${viewport[3]}`);

    tui.stop();
  });

  it("renders correctly when multiple non-adjacent lines change", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4"];
    tui.start();
    await terminal.waitForRender();

    // Change lines 1 and 3, keep 0, 2, 4 the same
    component.lines = ["Line 0", "CHANGED 1", "Line 2", "CHANGED 3", "Line 4"];
    tui.requestRender();
    await terminal.waitForRender();

    const viewport = terminal.getViewport();
    assert.ok(viewport[0]?.includes("Line 0"), `Line 0 preserved: ${viewport[0]}`);
    assert.ok(viewport[1]?.includes("CHANGED 1"), `Line 1 changed: ${viewport[1]}`);
    assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
    assert.ok(viewport[3]?.includes("CHANGED 3"), `Line 3 changed: ${viewport[3]}`);
    assert.ok(viewport[4]?.includes("Line 4"), `Line 4 preserved: ${viewport[4]}`);

    tui.stop();
  });

  it("handles transition from content to empty and back to content", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    // Start with content
    component.lines = ["Line 0", "Line 1", "Line 2"];
    tui.start();
    await terminal.waitForRender();

    let viewport = terminal.getViewport();
    assert.ok(viewport[0]?.includes("Line 0"), "Initial content rendered");

    // Clear to empty
    component.lines = [];
    tui.requestRender();
    await terminal.waitForRender();

    // Add content back - this should work correctly even after empty state
    component.lines = ["New Line 0", "New Line 1"];
    tui.requestRender();
    await terminal.waitForRender();

    viewport = terminal.getViewport();
    assert.ok(viewport[0]?.includes("New Line 0"), `New content rendered: ${viewport[0]}`);
    assert.ok(viewport[1]?.includes("New Line 1"), `New content line 1: ${viewport[1]}`);

    tui.stop();
  });

  it("full re-renders when deleted lines move the viewport upward", async () => {
    const terminal = new VirtualTerminal(20, 5);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = Array.from({ length: 12 }, (_, i) => `Line ${i}`);
    tui.start();
    await terminal.waitForRender();

    const initialRedraws = tui.fullRedraws;

    component.lines = Array.from({ length: 7 }, (_, i) => `Line ${i}`);
    tui.requestRender();
    await terminal.waitForRender();

    assert.ok(tui.fullRedraws > initialRedraws, "Shrink should trigger a full redraw");
    assert.deepStrictEqual(terminal.getViewport(), ["Line 2", "Line 3", "Line 4", "Line 5", "Line 6"]);

    tui.stop();
  });

  it("appends after a shrink without another full redraw once the viewport is reset", async () => {
    const terminal = new VirtualTerminal(20, 5);
    const tui = new TUI(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = Array.from({ length: 8 }, (_, i) => `Line ${i}`);
    tui.start();
    await terminal.waitForRender();

    const initialRedraws = tui.fullRedraws;

    component.lines = ["Line 0", "Line 1"];
    tui.requestRender();
    await terminal.waitForRender();

    assert.ok(tui.fullRedraws > initialRedraws, "Shrink should reset the viewport with a full redraw");
    const redrawsAfterShrink = tui.fullRedraws;

    component.lines = ["Line 0", "Line 1", "Line 2"];
    tui.requestRender();
    await terminal.waitForRender();

    assert.strictEqual(tui.fullRedraws, redrawsAfterShrink, "Append should stay on the differential path");
    assert.deepStrictEqual(terminal.getViewport(), ["Line 0", "Line 1", "Line 2", "", ""]);

    tui.stop();
  });

  it("clears stale content when maxLinesRendered was inflated by a transient component", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui = new TUI(terminal);
    const chat = new TestComponent();
    const editor = new TestComponent();
    tui.addChild(chat);
    tui.addChild(editor);

    const longChat = Array.from({ length: 15 }, (_, i) => `Chat ${i}`);
    const shortChat = Array.from({ length: 12 }, (_, i) => `Chat ${i}`);
    const editorLines = ["Editor 0", "Editor 1", "Editor 2"];
    const selectorLines = Array.from({ length: 8 }, (_, i) => `Selector ${i}`);

    chat.lines = longChat;
    editor.lines = editorLines;
    tui.start();
    await terminal.waitForRender();

    editor.lines = selectorLines;
    tui.requestRender();
    await terminal.waitForRender();

    editor.lines = editorLines;
    tui.requestRender();
    await terminal.waitForRender();

    const redrawsBeforeSwitch = tui.fullRedraws;
    chat.lines = shortChat;
    tui.requestRender();
    await terminal.waitForRender();

    assert.ok(tui.fullRedraws > redrawsBeforeSwitch, "Branch switch should trigger a full redraw");

    const viewport = terminal.getViewport();
    for (let i = 0; i < 10; i++) {
      const line = viewport[i] ?? "";
      assert.ok(!line.includes("Chat 12"), `Stale "Chat 12" at viewport row ${i}`);
      assert.ok(!line.includes("Chat 13"), `Stale "Chat 13" at viewport row ${i}`);
      assert.ok(!line.includes("Chat 14"), `Stale "Chat 14" at viewport row ${i}`);
    }

    assert.deepStrictEqual(viewport, [
      "Chat 5",
      "Chat 6",
      "Chat 7",
      "Chat 8",
      "Chat 9",
      "Chat 10",
      "Chat 11",
      "Editor 0",
      "Editor 1",
      "Editor 2",
    ]);

    tui.stop();
  });

  it("does not emit \\x1b[2J when redrawing viewport in-place for off-screen line changes", async () => {
    const terminal = new LoggingVirtualTerminal(80, 10);
    const tui = new TUI(terminal);
    const comp = new TestComponent();
    tui.addChild(comp);

    // Create 30 lines (more than 10-line viewport)
    comp.lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`);
    tui.start();
    await terminal.waitForRender();
    terminal.clearWrites();

    // Change an off-screen line by assigning a new array
    comp.lines = ["Line 1 - modified off-screen", ...comp.lines.slice(1)];
    tui.requestRender();
    await terminal.waitForRender();

    const writes = terminal.getWrites();
    assert.ok(!writes.includes("\x1b[2J"), "Viewport redraw should not use \\x1b[2J to clear screen");
    assert.ok(writes.includes("\x1b[H"), "Viewport redraw should position cursor home with \\x1b[H");
    assert.ok(writes.includes("\x1b[2K"), "Viewport redraw should clear lines in-place with \\x1b[2K");

    tui.stop();
  });

  it("handles overlay viewport shift with full height in-place redraw", async () => {
    const terminal = new LoggingVirtualTerminal(80, 10);
    const tui = new TUI(terminal);
    const comp = new TestComponent();
    tui.addChild(comp);

    comp.lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
    tui.start();
    await terminal.waitForRender();

    const overlayComp = new TestComponent();
    overlayComp.lines = ["Overlay 1", "Overlay 2"];
    tui.showOverlay(overlayComp);
    await terminal.waitForRender();
    terminal.clearWrites();

    // Trigger overlay viewport shift by appending lines (renderedCount = 10 === height)
    comp.lines = [...comp.lines, "Line 21", "Line 22", "Line 23"];
    tui.requestRender();
    await terminal.waitForRender();

    const writes = terminal.getWrites();
    assert.ok(!writes.includes("\x1b[2J"), "Overlay viewport shift should not emit \\x1b[2J");
    assert.ok(writes.includes("\x1b[H"), "Overlay viewport shift should use cursor home");
    assert.ok(writes.includes("\x1b[2K"), "Overlay viewport shift should use in-place line clearing");

    tui.stop();
  });

  it("handles overlay viewport shift when rendered count is less than terminal height", async () => {
    const terminal = new LoggingVirtualTerminal(80, 10);
    const tui = new TUI(terminal);
    const comp = new TestComponent();
    tui.addChild(comp);

    // Initial 15 lines in 10-line viewport (prevViewportTop = 5)
    comp.lines = Array.from({ length: 15 }, (_, i) => `Line ${i + 1}`);
    tui.start();
    await terminal.waitForRender();

    const overlayComp = new TestComponent();
    overlayComp.lines = ["Overlay"];
    tui.showOverlay(overlayComp);
    await terminal.waitForRender();
    terminal.clearWrites();

    // Shrink lines to 4 lines and shift viewport (newViewportTop = 0 !== 5, renderedCount = 4 < 10 height)
    comp.lines = ["Modified Line 1", "Line 2", "Line 3", "Line 4"];
    tui.requestRender();
    await terminal.waitForRender();

    const writes = terminal.getWrites();
    assert.ok(!writes.includes("\x1b[2J"), "Redraw should not emit \\x1b[2J");
    assert.ok(writes.includes("\x1b[2K"), "Redraw should clear remaining rows in-place");

    tui.stop();
  });

  it("handles off-screen line changes when rendered count is less than terminal height", async () => {
    const terminal = new LoggingVirtualTerminal(80, 10);
    const tui = new TUI(terminal);
    const comp = new TestComponent();
    tui.addChild(comp);

    // Initial 15 lines in 10-line viewport (prevViewportTop = 5)
    comp.lines = Array.from({ length: 15 }, (_, i) => `Line ${i + 1}`);
    tui.start();
    await terminal.waitForRender();
    terminal.clearWrites();

    // Change line 0 and shrink to 4 lines (firstChanged = 0 < 5, renderedCount = 4 < 10 height)
    comp.lines = ["Modified Line 1", "Line 2", "Line 3", "Line 4"];
    tui.requestRender();
    await terminal.waitForRender();

    const writes = terminal.getWrites();
    assert.ok(!writes.includes("\x1b[2J"), "Redraw should not emit \\x1b[2J");
    assert.ok(writes.includes("\x1b[2K"), "Redraw should clear remaining rows in-place");

    tui.stop();
  });
});
