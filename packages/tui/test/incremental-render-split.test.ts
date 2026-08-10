import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { renderIncremental } from "../src/tui/tui-methods/incremental-render.ts";
import type { TUI } from "../src/tui.ts";

const originalDebug = process.env.PI_TUI_DEBUG;
const originalHome = process.env.HOME;

interface RenderDouble {
  collectKittyImageIds: (lines: string[]) => Set<number>;
  cursorRow: number;
  deleteChangedKittyImages: (first: number, last: number) => string;
  expandChangedRangeForKittyImages: (first: number, last: number) => { firstChanged: number; lastChanged: number };
  fullRedrawCount: number;
  getKittyImageReservedRows: () => number;
  hardwareCursorRow: number;
  maxLinesRendered: number;
  positionHardwareCursor: (position: { row: number; col: number } | null, lines: number) => void;
  previousHeight: number;
  previousKittyImageIds: Set<number>;
  previousLines: string[];
  previousViewportTop: number;
  previousWidth: number;
  stop: () => void;
  terminal: { write: (value: string) => void };
  writes: string[];
}

function createTui(previousLines: string[]): RenderDouble {
  const writes: string[] = [];
  return {
    collectKittyImageIds: () => new Set(),
    cursorRow: 0,
    deleteChangedKittyImages: () => "",
    expandChangedRangeForKittyImages: (firstChanged, lastChanged) => ({ firstChanged, lastChanged }),
    fullRedrawCount: 0,
    getKittyImageReservedRows: () => 1,
    hardwareCursorRow: 0,
    maxLinesRendered: 0,
    positionHardwareCursor: () => undefined,
    previousHeight: 4,
    previousKittyImageIds: new Set(),
    previousLines,
    previousViewportTop: 0,
    previousWidth: 80,
    stop: () => undefined,
    terminal: { write: (value) => writes.push(value) },
    writes,
  };
}

function render(
  tui: RenderDouble,
  newLines: string[],
  overrides: Partial<{
    computeLineDiff: (targetRow: number) => number;
    hardwareCursorRow: number;
    height: number;
    prevViewportTop: number;
    viewportTop: number;
    width: number;
  }> = {},
) {
  const redrawReasons: string[] = [];
  let fullRenders = 0;
  renderIncremental(tui as unknown as TUI, {
    computeLineDiff: overrides.computeLineDiff ?? (() => 0),
    cursorPos: { row: 0, col: 0 },
    fullRender: () => {
      fullRenders += 1;
    },
    hardwareCursorRow: overrides.hardwareCursorRow ?? 0,
    height: overrides.height ?? 4,
    logRedraw: (reason) => redrawReasons.push(reason),
    newLines,
    prevViewportTop: overrides.prevViewportTop ?? 0,
    viewportTop: overrides.viewportTop ?? 0,
    width: overrides.width ?? 80,
  });
  return { fullRenders, redrawReasons };
}

afterEach(() => {
  if (originalDebug === undefined) delete process.env.PI_TUI_DEBUG;
  else process.env.PI_TUI_DEBUG = originalDebug;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

describe("split incremental renderer", () => {
  it("falls back when deleting content would move above the viewport", () => {
    const tui = createTui(["first", "deleted"]);
    const result = render(tui, ["first"], { prevViewportTop: 2 });
    assert.equal(result.fullRenders, 1);
    assert.match(result.redrawReasons[0] ?? "", /deleted lines moved viewport up/);
  });

  it("falls back when too many deleted rows would need clearing", () => {
    const tui = createTui(Array.from({ length: 10 }, (_, index) => `line ${index}`));
    const result = render(tui, ["line 0"], { height: 3 });
    assert.equal(result.fullRenders, 1);
    assert.match(result.redrawReasons[0] ?? "", /extraLines > height/);
  });

  it("scrolls to a changed line below the viewport and moves down", () => {
    const oldLines = Array.from({ length: 9 }, (_, index) => `line ${index}`);
    const newLines = [...oldLines];
    newLines[8] = "changed";
    const tui = createTui(oldLines);
    render(tui, newLines, { computeLineDiff: () => 2, height: 3 });
    assert.match(tui.writes[0] ?? "", /\x1b\[2B/);
    assert.equal(tui.hardwareCursorRow, 8);
  });

  it("clears trailing rows after rendering shortened changed content", () => {
    const tui = createTui(["old", "kept", "trailing"]);
    render(tui, ["new", "kept"]);
    assert.match(tui.writes[0] ?? "", /\x1b\[2K/);
    assert.equal(tui.previousLines.length, 2);
  });

  it("moves to the content end before clearing an empty trailing row", () => {
    const tui = createTui(["old", "same", "last", ""]);
    render(tui, ["new", "same", "last"]);
    assert.match(tui.writes[0] ?? "", /\x1b\[2B/);
    assert.equal(tui.hardwareCursorRow, 2);
  });

  it("writes a diagnostic log, stops, and throws for an over-wide line", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "p-tui-width-"));
    process.env.HOME = tempHome;
    const tui = createTui(["ok"]);
    let stopped = false;
    tui.stop = () => {
      stopped = true;
    };
    assert.throws(() => render(tui, ["too wide"], { width: 3 }), /exceeds terminal width/);
    assert.equal(stopped, true);
    const crashLog = path.join(tempHome, ".p", "agent", "pi-crash.log");
    assert.match(fs.readFileSync(crashLog, "utf8"), /Terminal width: 3/);
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("records debug state when incremental diagnostics are enabled", () => {
    process.env.PI_TUI_DEBUG = "1";
    const debugDir = "/tmp/tui";
    const before = new Set(fs.existsSync(debugDir) ? fs.readdirSync(debugDir) : []);
    const tui = createTui(["before"]);
    render(tui, ["after"]);
    const created = fs.readdirSync(debugDir).filter((name) => !before.has(name));
    assert.equal(created.length, 1);
    const debugPath = path.join(debugDir, created[0] ?? "");
    assert.match(fs.readFileSync(debugPath, "utf8"), /firstChanged: 0/);
    fs.unlinkSync(debugPath);
  });
});
