import assert from "node:assert";
import { describe, it } from "node:test";
import {
  type Component,
  formatOsc11BackgroundColor,
  formatOsc111ResetBackgroundColor,
  parseOsc11BackgroundColor,
  type Terminal,
  TUI,
} from "../src/index.ts";

class TestTerminal implements Terminal {
  private inputHandler?: (data: string) => void;
  private resizeHandler?: () => void;
  private readonly columnCount: number;
  private readonly rowCount: number;
  readonly writes: string[] = [];

  constructor(columnCount = 80, rowCount = 24) {
    this.columnCount = columnCount;
    this.rowCount = rowCount;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;
  }

  stop(): void {
    this.inputHandler = undefined;
    this.resizeHandler = undefined;
  }

  async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}

  write(data: string): void {
    this.writes.push(data);
  }

  get columns(): number {
    return this.columnCount;
  }

  get rows(): number {
    return this.rowCount;
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  moveBy(_lines: number): void {}

  hideCursor(): void {}

  showCursor(): void {}

  clearLine(): void {}

  clearFromCursor(): void {}

  clearScreen(): void {}

  setTitle(_title: string): void {}

  setProgress(_active: boolean): void {}

  sendInput(data: string): void {
    this.inputHandler?.(data);
  }

  sendResize(): void {
    this.resizeHandler?.();
  }
}

class InputRecorder implements Component {
  readonly inputs: string[] = [];

  render(_width: number): string[] {
    return [];
  }

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  invalidate(): void {}
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("parseOsc11BackgroundColor", () => {
  it("parses 16-bit OSC 11 rgb responses", () => {
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;rgb:0000/8000/ffff\x07"), {
      r: 0,
      g: 128,
      b: 255,
    });
  });

  it("parses rgba: prefix OSC 11 responses", () => {
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;rgba:0000/8000/ffff\x07"), {
      r: 0,
      g: 128,
      b: 255,
    });
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;rgba:ff/80/00\x07"), {
      r: 255,
      g: 128,
      b: 0,
    });
  });

  it("parses 1-digit, 2-digit, and 3-digit per-channel hex OSC 11 responses", () => {
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;rgb:f/8/0\x07"), {
      r: 255,
      g: 136,
      b: 0,
    });
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;rgb:ff/80/00\x07"), {
      r: 255,
      g: 128,
      b: 0,
    });
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;rgb:fff/800/000\x07"), {
      r: 255,
      g: 128,
      b: 0,
    });
  });

  it("parses uppercase OSC 11 hex responses", () => {
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;#FFFFFF\x1b\\"), { r: 255, g: 255, b: 255 });
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;#00008000FFFF\x07"), {
      r: 0,
      g: 128,
      b: 255,
    });
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;rgb:FF/80/00\x07"), {
      r: 255,
      g: 128,
      b: 0,
    });
  });

  it("parses OSC 11 hex responses", () => {
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;#ffffff\x1b\\"), { r: 255, g: 255, b: 255 });
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;#000000\x07"), { r: 0, g: 0, b: 0 });
  });

  it("parses 12-digit hex OSC 11 responses", () => {
    assert.deepStrictEqual(parseOsc11BackgroundColor("\x1b]11;#00008000ffff\x07"), {
      r: 0,
      g: 128,
      b: 255,
    });
  });

  it("rejects non-strict OSC 11 responses", () => {
    assert.strictEqual(parseOsc11BackgroundColor(`x\x1b]11;#ffffff\x07`), undefined);
    assert.strictEqual(parseOsc11BackgroundColor("\x1b]10;#ffffff\x07"), undefined);
    assert.strictEqual(parseOsc11BackgroundColor("\x1b]11;#ffffff\x07x"), undefined);
    assert.strictEqual(parseOsc11BackgroundColor("\x1b]11;#invalid\x07"), undefined);
    assert.strictEqual(parseOsc11BackgroundColor("\x1b]11;#12345\x07"), undefined);
    assert.strictEqual(parseOsc11BackgroundColor("\x1b]11;#00008000zzzz\x07"), undefined);
    assert.strictEqual(parseOsc11BackgroundColor("\x1b]11;rgb:invalid/0000/0000\x07"), undefined);
    assert.strictEqual(parseOsc11BackgroundColor("\x1b]11;rgb:0000\x07"), undefined);
    assert.strictEqual(parseOsc11BackgroundColor("\x1b]11;rgb:ff/80\x07"), undefined);
    assert.strictEqual(parseOsc11BackgroundColor("\x1b]11;rgb:ff/80/00/11\x07"), undefined);
  });
});

describe("TUI.queryTerminalBackgroundColor", () => {
  it("writes OSC 11 query and resolves with the parsed RGB reply", async () => {
    const terminal = new TestTerminal();
    const tui = new TUI(terminal);
    tui.start();
    try {
      const query = tui.queryTerminalBackgroundColor({ timeoutMs: 1000 });
      assert.ok(terminal.writes.includes("\x1b]11;?\x07"));

      terminal.sendInput("\x1b]11;#ffffff\x07");

      assert.deepStrictEqual(await query, { r: 255, g: 255, b: 255 });
    } finally {
      tui.stop();
    }
  });

  it("consumes OSC 11 replies before input listeners and focused component dispatch", async () => {
    const terminal = new TestTerminal();
    const tui = new TUI(terminal);
    const component = new InputRecorder();
    const listenerInputs: string[] = [];
    tui.addChild(component);
    tui.setFocus(component);
    tui.addInputListener((data) => {
      listenerInputs.push(data);
      return undefined;
    });
    tui.start();
    try {
      const query = tui.queryTerminalBackgroundColor({ timeoutMs: 1000 });

      terminal.sendInput("\x1b]11;#000000\x07");

      assert.deepStrictEqual(await query, { r: 0, g: 0, b: 0 });
      assert.deepStrictEqual(listenerInputs, []);
      assert.deepStrictEqual(component.inputs, []);
    } finally {
      tui.stop();
    }
  });

  it("consumes unparseable strict OSC 11 replies and resolves undefined", async () => {
    const terminal = new TestTerminal();
    const tui = new TUI(terminal);
    const component = new InputRecorder();
    const listenerInputs: string[] = [];
    tui.addChild(component);
    tui.setFocus(component);
    tui.addInputListener((data) => {
      listenerInputs.push(data);
      return undefined;
    });
    tui.start();
    try {
      const query = tui.queryTerminalBackgroundColor({ timeoutMs: 1000 });

      terminal.sendInput("\x1b]11;not-a-color\x07");

      assert.strictEqual(await query, undefined);
      assert.deepStrictEqual(listenerInputs, []);
      assert.deepStrictEqual(component.inputs, []);
    } finally {
      tui.stop();
    }
  });

  it("dispatches non-matching input normally while waiting for an OSC 11 reply", async () => {
    const terminal = new TestTerminal();
    const tui = new TUI(terminal);
    const component = new InputRecorder();
    const listenerInputs: string[] = [];
    tui.addChild(component);
    tui.setFocus(component);
    tui.addInputListener((data) => {
      listenerInputs.push(data);
      return undefined;
    });
    tui.start();
    try {
      let settled = false;
      const query = tui.queryTerminalBackgroundColor({ timeoutMs: 1000 }).then((rgb) => {
        settled = true;
        return rgb;
      });

      terminal.sendInput("x");
      await Promise.resolve();

      assert.strictEqual(settled, false);
      assert.deepStrictEqual(listenerInputs, ["x"]);
      assert.deepStrictEqual(component.inputs, ["x"]);

      terminal.sendInput("\x1b]11;#ffffff\x07");
      assert.deepStrictEqual(await query, { r: 255, g: 255, b: 255 });
    } finally {
      tui.stop();
    }
  });

  it("keeps consuming a late OSC 11 reply after timeout", async () => {
    const terminal = new TestTerminal();
    const tui = new TUI(terminal);
    const component = new InputRecorder();
    const listenerInputs: string[] = [];
    tui.addChild(component);
    tui.setFocus(component);
    tui.addInputListener((data) => {
      listenerInputs.push(data);
      return undefined;
    });
    tui.start();
    try {
      const query = tui.queryTerminalBackgroundColor({ timeoutMs: 1 });
      await wait(5);

      assert.strictEqual(await query, undefined);

      terminal.sendInput("\x1b]11;#ffffff\x07");

      assert.deepStrictEqual(listenerInputs, []);
      assert.deepStrictEqual(component.inputs, []);
    } finally {
      tui.stop();
    }
  });
});

describe("formatOsc11BackgroundColor & formatOsc111ResetBackgroundColor", () => {
  it("formats non-tmux OSC 11 background color sequence", () => {
    const origTmux = process.env.TMUX;
    const origTerm = process.env.TERM;
    delete process.env.TMUX;
    process.env.TERM = "xterm-256color";
    try {
      assert.strictEqual(formatOsc11BackgroundColor("#18181e"), "\x1b]11;#18181e\x07");
      assert.strictEqual(formatOsc111ResetBackgroundColor(), "\x1b]111\x07");
    } finally {
      if (origTmux) process.env.TMUX = origTmux;
      else delete process.env.TMUX;
      if (origTerm) process.env.TERM = origTerm;
      else delete process.env.TERM;
    }
  });

  it("formats tmux OSC 11 background color sequence when TERM starts with tmux", () => {
    const origTmux = process.env.TMUX;
    const origTerm = process.env.TERM;
    delete process.env.TMUX;
    process.env.TERM = "tmux-256color";
    try {
      assert.strictEqual(
        formatOsc11BackgroundColor("#18181e"),
        "\x1bPtmux;\x1b\x1b]11;#18181e\x07\x1b\\\x1b]11;#18181e\x07",
      );
      assert.strictEqual(formatOsc111ResetBackgroundColor(), "\x1bPtmux;\x1b\x1b]111\x07\x1b\\\x1b]111\x07");
    } finally {
      if (origTmux) process.env.TMUX = origTmux;
      else delete process.env.TMUX;
      if (origTerm) process.env.TERM = origTerm;
      else delete process.env.TERM;
    }
  });

  it("formats tmux OSC 11 background color sequence", () => {
    const origTmux = process.env.TMUX;
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    try {
      assert.strictEqual(
        formatOsc11BackgroundColor("#18181e"),
        "\x1bPtmux;\x1b\x1b]11;#18181e\x07\x1b\\\x1b]11;#18181e\x07",
      );
      assert.strictEqual(formatOsc111ResetBackgroundColor(), "\x1bPtmux;\x1b\x1b]111\x07\x1b\\\x1b]111\x07");
    } finally {
      if (origTmux) process.env.TMUX = origTmux;
      else delete process.env.TMUX;
    }
  });
});

describe("TUI background color setting", () => {
  it("sets and resets background color via TUI methods", () => {
    const terminal = new TestTerminal();
    const tui = new TUI(terminal);
    tui.setTerminalBackgroundColor("#18181e");
    assert.strictEqual(terminal.writes.length, 1);
    assert.ok(terminal.writes[0].includes("#18181e"));

    // Setting same background should be no-op
    tui.setTerminalBackgroundColor("#18181e");
    assert.strictEqual(terminal.writes.length, 1);

    // Setting undefined resets
    tui.setTerminalBackgroundColor(undefined);
    assert.strictEqual(terminal.writes.length, 2);
    assert.ok(terminal.writes[1].includes("111"));

    // resetTerminalBackgroundColor
    tui.setTerminalBackgroundColor("#222222");
    tui.resetTerminalBackgroundColor();
    assert.ok(terminal.writes[terminal.writes.length - 1].includes("111"));
  });

  it("resets background color when TUI stops", () => {
    const terminal = new TestTerminal();
    const tui = new TUI(terminal);
    tui.setTerminalBackgroundColor("#18181e");
    tui.stop();
    assert.ok(terminal.writes.some((w) => w.includes("111")));
  });
});
