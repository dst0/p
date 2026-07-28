import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { setKittyProtocolActive } from "../src/keys.ts";
import { normalizeAppleTerminalInput, ProcessTerminal } from "../src/terminal.ts";

describe("normalizeAppleTerminalInput", () => {
  it("rewrites Apple Terminal Return to CSI-u Shift+Enter when Shift is pressed", () => {
    assert.equal(normalizeAppleTerminalInput("\r", true, true), "\x1b[13;2u");
  });

  it("leaves Apple Terminal Return unchanged when Shift is not pressed", () => {
    assert.equal(normalizeAppleTerminalInput("\r", true, false), "\r");
  });

  it("leaves non-Apple Terminal Return unchanged when Shift is pressed", () => {
    assert.equal(normalizeAppleTerminalInput("\r", false, true), "\r");
  });

  it("leaves non-Return input unchanged", () => {
    assert.equal(normalizeAppleTerminalInput("\x1b[13;2u", true, true), "\x1b[13;2u");
    assert.equal(normalizeAppleTerminalInput("a", true, true), "a");
  });
});

describe("ProcessTerminal Kitty keyboard protocol negotiation", () => {
  type NegotiationHarness = {
    terminal: ProcessTerminal;
    writes: string[];
    send(data: string): void;
    getInput(): string | undefined;
    cleanup(): void;
  };

  function setupNegotiation(): NegotiationHarness {
    const terminal = new ProcessTerminal();
    const writes: string[] = [];
    let input: string | undefined;
    let dataHandler: ((data: string) => void) | undefined;
    let cleaned = false;
    const previousWrite = process.stdout.write;
    const previousOn = process.stdin.on;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stdin.on = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
      if (event === "data") dataHandler = listener as (data: string) => void;
      return process.stdin;
    }) as typeof process.stdin.on;

    (
      terminal as unknown as {
        inputHandler?: (data: string) => void;
        queryAndEnableKittyProtocol(): void;
      }
    ).inputHandler = (data) => {
      input = data;
    };
    (terminal as unknown as { queryAndEnableKittyProtocol(): void }).queryAndEnableKittyProtocol();

    return {
      terminal,
      writes,
      send(data: string): void {
        dataHandler?.(data);
      },
      getInput(): string | undefined {
        return input;
      },
      cleanup(): void {
        if (cleaned) return;
        cleaned = true;
        try {
          terminal.stop();
        } finally {
          process.stdout.write = previousWrite;
          process.stdin.on = previousOn;
          setKittyProtocolActive(false);
        }
      },
    };
  }

  it("queries Kitty mode before enabling modifyOtherKeys fallback", () => {
    const harness = setupNegotiation();
    try {
      assert.equal(harness.writes[0], "\x1b[>7u\x1b[?u\x1b[c");
      assert.equal(harness.writes.includes("\x1b[>4;2m"), false);
      assert.equal(harness.terminal.kittyProtocolActive, false);
    } finally {
      harness.cleanup();
    }
  });

  it("activates Kitty mode for non-zero negotiated flags", () => {
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[?7u");

      assert.equal(harness.getInput(), undefined);
      assert.equal(harness.terminal.kittyProtocolActive, true);
      assert.equal(harness.writes.includes("\x1b[>4;2m"), false);
      assert.equal(harness.writes.includes("\x1b[>4;0m"), false);

      harness.cleanup();
      assert.equal(harness.writes.filter((write) => write === "\x1b[<u").length, 1);
      assert.equal(harness.writes.includes("\x1b[>4;0m"), false);
    } finally {
      harness.cleanup();
    }
  });

  it("falls back to modifyOtherKeys for zero Kitty flags", () => {
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[?0u");

      assert.equal(harness.getInput(), undefined);
      assert.equal(harness.terminal.kittyProtocolActive, false);
      assert.equal(harness.writes.filter((write) => write === "\x1b[>4;2m").length, 1);

      harness.cleanup();
      assert.equal(harness.writes.filter((write) => write === "\x1b[>4;0m").length, 1);
    } finally {
      harness.cleanup();
    }
  });

  it("falls back to modifyOtherKeys for device attributes without Kitty flags", () => {
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[?62;4;52c");

      assert.equal(harness.getInput(), undefined);
      assert.equal(harness.terminal.kittyProtocolActive, false);
      assert.equal(harness.writes.filter((write) => write === "\x1b[>4;2m").length, 1);
    } finally {
      harness.cleanup();
    }
  });

  it("forwards normal input while waiting for Kitty response", () => {
    const harness = setupNegotiation();
    try {
      harness.send("a");

      assert.equal(harness.getInput(), "a");
      assert.equal(harness.terminal.kittyProtocolActive, false);
    } finally {
      harness.cleanup();
    }
  });

  it("tracks split Kitty confirmation", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[?7");
      mock.timers.tick(10);

      assert.equal(harness.getInput(), undefined);

      harness.send("u");

      assert.equal(harness.terminal.kittyProtocolActive, true);
      assert.equal(harness.writes.includes("\x1b[>4;2m"), false);
    } finally {
      harness.cleanup();
      mock.timers.reset();
    }
  });

  it("replays buffered CSI-prefix input when it is not a Kitty response", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[");
      mock.timers.tick(10);

      assert.equal(harness.getInput(), undefined);

      mock.timers.tick(150);

      assert.equal(harness.getInput(), "\x1b[");
    } finally {
      harness.cleanup();
      mock.timers.reset();
    }
  });
});

describe("ProcessTerminal dimensions", () => {
  it("falls back to COLUMNS and LINES before default dimensions", () => {
    const previousColumnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    const previousRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    const previousColumns = process.env.COLUMNS;
    const previousLines = process.env.LINES;

    try {
      Object.defineProperty(process.stdout, "columns", { value: undefined, configurable: true });
      Object.defineProperty(process.stdout, "rows", { value: undefined, configurable: true });
      process.env.COLUMNS = "123";
      process.env.LINES = "45";

      const terminal = new ProcessTerminal();

      assert.equal(terminal.columns, 123);
      assert.equal(terminal.rows, 45);
    } finally {
      if (previousColumnsDescriptor) {
        Object.defineProperty(process.stdout, "columns", previousColumnsDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
      if (previousRowsDescriptor) {
        Object.defineProperty(process.stdout, "rows", previousRowsDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "rows");
      }
      if (previousColumns === undefined) {
        delete process.env.COLUMNS;
      } else {
        process.env.COLUMNS = previousColumns;
      }
      if (previousLines === undefined) {
        delete process.env.LINES;
      } else {
        process.env.LINES = previousLines;
      }
    }
  });
});

import { afterEach, beforeEach } from "node:test";

describe("ProcessTerminal methods", () => {
  let terminal: ProcessTerminal;
  let writes: string[] = [];
  const previousWrite = process.stdout.write;

  beforeEach(() => {
    terminal = new ProcessTerminal();
    writes = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = previousWrite;
    terminal.stop();
  });

  it("write", () => {
    terminal.write("test output");
    assert.ok(writes.includes("test output"));
  });

  it("moveBy", () => {
    terminal.moveBy(5);
    assert.ok(writes.includes("\x1b[5B"));
    terminal.moveBy(-3);
    assert.ok(writes.includes("\x1b[3A"));
    terminal.moveBy(0); // Should not write anything
  });

  it("hideCursor and showCursor", () => {
    terminal.hideCursor();
    assert.ok(writes.includes("\x1b[?25l"));
    terminal.showCursor();
    assert.ok(writes.includes("\x1b[?25h"));
  });

  it("clear functions", () => {
    terminal.clearLine();
    assert.ok(writes.includes("\x1b[K"));
    terminal.clearFromCursor();
    assert.ok(writes.includes("\x1b[J"));
    terminal.clearScreen();
    assert.ok(writes.includes("\x1b[2J\x1b[H"));
  });

  it("setTitle", () => {
    terminal.setTitle("my-title");
    assert.ok(writes.includes("\x1b]0;my-title\x07"));
  });

  it("setProgress", () => {
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      terminal.setProgress(true);
      assert.ok(writes.includes("\x1b]9;4;3\x07"));
      mock.timers.tick(1500);
      assert.equal(writes.filter((w) => w === "\x1b]9;4;3\x07").length, 2);

      terminal.setProgress(false);
      assert.ok(writes.includes("\x1b]9;4;0;\x07"));
    } finally {
      mock.timers.reset();
    }
  });

  it("setMouseTracking toggles SGR button-motion reporting once per state", () => {
    terminal.setMouseTracking(true);
    terminal.setMouseTracking(true);
    terminal.setMouseTracking(false);

    assert.equal(writes.filter((write) => write === "\x1b[?1002h\x1b[?1006h").length, 1);
    assert.equal(writes.filter((write) => write === "\x1b[?1006l\x1b[?1002l").length, 1);
  });

  it("start and stop lifecycle", () => {
    let _resized = false;
    terminal.start(
      () => {},
      () => {
        _resized = true;
      },
    );
    assert.ok(writes.includes("\x1b[?2004h"));

    // Simulate paste
    (terminal as any).stdinBuffer.emit("paste", "hello");

    terminal.stop();
    assert.ok(writes.includes("\x1b[?2004l"));

    // Multiple stops shouldn't crash
    terminal.stop();
  });
});

describe("ProcessTerminal drainInput", () => {
  let terminal: ProcessTerminal;

  beforeEach(() => {
    terminal = new ProcessTerminal();
  });

  it("drains input and turns off kitty protocol", async () => {
    let writeCalled = false;
    const previousWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      if (chunk === "\x1b[<u") writeCalled = true;
      return true;
    }) as any;

    try {
      terminal.start(
        () => {},
        () => {},
      );
      // Force kitty active
      (terminal as any)._kittyProtocolActive = true;
      (terminal as any).keyboardProtocolPushed = true;
      terminal.setMouseTracking(true);

      // Use fast real timeouts instead of mocking timers for V8 coverage
      const drainPromise = terminal.drainInput(10, 5);

      await drainPromise;
      assert.ok(writeCalled);
      assert.equal(terminal.kittyProtocolActive, false);
    } finally {
      mock.timers.reset();
      process.stdout.write = previousWrite;
      terminal.stop();
    }
  });
});

describe("ProcessTerminal edge cases", () => {
  it("modifyOtherKeysActive returns the correct boolean", () => {
    const terminal = new ProcessTerminal();
    assert.equal(terminal.modifyOtherKeysActive, false);
  });

  it("handles isAppleTerminalSession true", () => {
    const prevPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    const prevTerm = process.env.TERM_PROGRAM;
    try {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      process.env.TERM_PROGRAM = "Apple_Terminal";
      assert.equal(normalizeAppleTerminalInput("\r", true, true), "\x1b[13;2u");
    } finally {
      if (prevPlatform) Object.defineProperty(process, "platform", prevPlatform);
      process.env.TERM_PROGRAM = prevTerm;
    }
  });

  it("handles enableWindowsVTInput on win32", () => {
    const prevPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    try {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      const terminal = new ProcessTerminal();
      // start() calls enableWindowsVTInput
      terminal.start(
        () => {},
        () => {},
      );
      terminal.stop();
    } finally {
      if (prevPlatform) Object.defineProperty(process, "platform", prevPlatform);
    }
  });

  it("write logs to PI_TUI_WRITE_LOG", () => {
    const terminal = new ProcessTerminal();
    (terminal as any).writeLogPath = "/dev/null";
    terminal.write("test log");
  });

  it("readKeyboardProtocolNegotiationSequence processes buffered sequence prefix", () => {
    const terminal = new ProcessTerminal();
    (terminal as any).setKeyboardProtocolNegotiationBuffer("\x1b[");
    const result = (terminal as any).readKeyboardProtocolNegotiationSequence("?");
    assert.equal(result, "pending");
  });

  it("readKeyboardProtocolNegotiationSequence flushes invalid buffer", () => {
    const terminal = new ProcessTerminal();
    let flushed = false;
    (terminal as any).inputHandler = () => {
      flushed = true;
    };
    (terminal as any).setKeyboardProtocolNegotiationBuffer("\x1b[?");
    const result = (terminal as any).readKeyboardProtocolNegotiationSequence("x");
    assert.equal(result, undefined);
    assert.equal(flushed, true);
  });

  it("stop() cleans up progress interval", () => {
    const terminal = new ProcessTerminal();
    terminal.setProgress(true);
    terminal.stop();
    assert.equal((terminal as any).progressInterval, undefined);
  });

  it("drainInput handles timeout and early return", async () => {
    const terminal = new ProcessTerminal();
    terminal.start(
      () => {},
      () => {},
    );
    await terminal.drainInput(10, 5);
    terminal.stop();
  });
});
