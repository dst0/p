import type * as PTui from "@dst0/p-tui";
import { setKeybindings } from "@dst0/p-tui";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";
import { do_run } from "../src/modes/interactive/interactive-mode/interactivemode-methods/run-loop.ts";
import {
  showTerminalNewLineHint,
  TERMINAL_NEWLINE_HINT_TIMEOUT_MS,
} from "../src/modes/interactive/interactive-mode/interactivemode-methods/terminal-newline-hint.ts";

const appleFallback = vi.hoisted(() => ({ available: false }));

vi.mock("@dst0/p-tui", async (importOriginal) => ({
  ...(await importOriginal<typeof PTui>()),
  hasAppleTerminalShiftEnterFallback: () => appleFallback.available,
}));

const ISOLATED_ENV_KEYS = ["TMUX", "TERM_PROGRAM"] as const;
const originalEnv = new Map(ISOLATED_ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of ISOLATED_ENV_KEYS) delete process.env[key];
  appleFallback.available = false;
  setKeybindings(new KeybindingsManager({}));
});

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  setKeybindings(new KeybindingsManager({}));
});

const GENERIC =
  "Shift+Enter may submit in this terminal (no kitty keyboard protocol). Use Ctrl+J or \\ then Enter for a new line.";

type FakeTerminal = {
  kittyProtocolActive: boolean;
  waitForKeyboardProtocolNegotiation?: Mock<(timeoutMs: number) => Promise<boolean>>;
};

function createSelf(options: { terminal: FakeTerminal; warnings?: { terminalNewLine?: boolean } }) {
  return {
    ui: { terminal: options.terminal },
    settingsManager: { getWarnings: vi.fn(() => options.warnings ?? {}) },
    showWarning: vi.fn(),
  };
}

function asMode(self: ReturnType<typeof createSelf>): InteractiveMode {
  return self as unknown as InteractiveMode;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("showTerminalNewLineHint", () => {
  it("decides only after the keyboard protocol negotiation settles, using the final kitty state", async () => {
    const negotiation = deferred<boolean>();
    const terminal: FakeTerminal = {
      kittyProtocolActive: false,
      waitForKeyboardProtocolNegotiation: vi.fn(() => negotiation.promise),
    };
    const self = createSelf({ terminal });

    const pending = showTerminalNewLineHint(asMode(self));
    await Promise.resolve();
    expect(self.showWarning).not.toHaveBeenCalled();
    expect(terminal.waitForKeyboardProtocolNegotiation).toHaveBeenCalledWith(TERMINAL_NEWLINE_HINT_TIMEOUT_MS);

    terminal.kittyProtocolActive = true;
    negotiation.resolve(true);
    await pending;

    expect(self.showWarning).not.toHaveBeenCalled();
  });

  it("warns when negotiation settles without kitty", async () => {
    const terminal: FakeTerminal = {
      kittyProtocolActive: false,
      waitForKeyboardProtocolNegotiation: vi.fn(async () => true),
    };
    const self = createSelf({ terminal });

    await showTerminalNewLineHint(asMode(self));

    expect(self.showWarning).toHaveBeenCalledTimes(1);
    expect(self.showWarning).toHaveBeenCalledWith(GENERIC);
  });

  it("still warns when the terminal never answers within the bounded wait", async () => {
    const terminal: FakeTerminal = {
      kittyProtocolActive: false,
      waitForKeyboardProtocolNegotiation: vi.fn(async () => false),
    };
    const self = createSelf({ terminal });

    await showTerminalNewLineHint(asMode(self));

    expect(self.showWarning).toHaveBeenCalledWith(GENERIC);
  });

  it("reads TERM_PROGRAM and TMUX from the live environment", async () => {
    const terminal: FakeTerminal = {
      kittyProtocolActive: false,
      waitForKeyboardProtocolNegotiation: vi.fn(async () => true),
    };

    process.env.TERM_PROGRAM = "WezTerm";
    const wezterm = createSelf({ terminal });
    await showTerminalNewLineHint(asMode(wezterm));
    expect(wezterm.showWarning).toHaveBeenCalledWith(expect.stringContaining("~/.wezterm.lua"));

    process.env.TMUX = "/tmp/tmux-501/default,1,0";
    const tmux = createSelf({ terminal });
    await showTerminalNewLineHint(asMode(tmux));
    expect(tmux.showWarning).not.toHaveBeenCalled();
  });

  it("passes Apple Terminal's local modifier fallback through to the decision", async () => {
    process.env.TERM_PROGRAM = "Apple_Terminal";
    const terminal: FakeTerminal = {
      kittyProtocolActive: false,
      waitForKeyboardProtocolNegotiation: vi.fn(async () => true),
    };

    const withoutFallback = createSelf({ terminal });
    await showTerminalNewLineHint(asMode(withoutFallback));
    expect(withoutFallback.showWarning).toHaveBeenCalledWith(expect.stringContaining("Apple Terminal"));

    appleFallback.available = true;
    const withFallback = createSelf({ terminal });
    await showTerminalNewLineHint(asMode(withFallback));
    expect(withFallback.showWarning).not.toHaveBeenCalled();
  });

  it("never rejects the fire-and-forget startup call when the terminal or renderer fails", async () => {
    const failingWait: FakeTerminal = {
      kittyProtocolActive: false,
      waitForKeyboardProtocolNegotiation: vi.fn(async () => {
        throw new Error("terminal closed");
      }),
    };
    const waitSelf = createSelf({ terminal: failingWait });
    await expect(showTerminalNewLineHint(asMode(waitSelf))).resolves.toBeUndefined();
    expect(waitSelf.showWarning).not.toHaveBeenCalled();

    const failingRender = createSelf({
      terminal: { kittyProtocolActive: false, waitForKeyboardProtocolNegotiation: vi.fn(async () => true) },
    });
    failingRender.showWarning.mockImplementation(() => {
      throw new Error("renderer stopped");
    });
    await expect(showTerminalNewLineHint(asMode(failingRender))).resolves.toBeUndefined();
    expect(failingRender.showWarning).toHaveBeenCalledTimes(1);
  });

  it("describes the user's configured new-line key", async () => {
    setKeybindings(new KeybindingsManager({ "tui.input.newLine": ["ctrl+enter", "ctrl+j"] }));
    const terminal: FakeTerminal = {
      kittyProtocolActive: false,
      waitForKeyboardProtocolNegotiation: vi.fn(async () => true),
    };
    const self = createSelf({ terminal });

    await showTerminalNewLineHint(asMode(self));

    expect(self.showWarning).toHaveBeenCalledWith(expect.stringMatching(/^Ctrl\+Enter may submit /));
  });

  it("respects the warnings.terminalNewLine opt-out without waiting on the terminal", async () => {
    const terminal: FakeTerminal = {
      kittyProtocolActive: false,
      waitForKeyboardProtocolNegotiation: vi.fn(async () => true),
    };
    const self = createSelf({ terminal, warnings: { terminalNewLine: false } });

    await showTerminalNewLineHint(asMode(self));

    expect(terminal.waitForKeyboardProtocolNegotiation).not.toHaveBeenCalled();
    expect(self.showWarning).not.toHaveBeenCalled();
  });

  it("stays silent for terminals that do not negotiate a keyboard protocol", async () => {
    const self = createSelf({ terminal: { kittyProtocolActive: false } });

    await showTerminalNewLineHint(asMode(self));

    expect(self.showWarning).not.toHaveBeenCalled();
  });
});

describe("InteractiveMode run loop", () => {
  it("starts the terminal new-line hint check at startup without delaying the prompt loop", async () => {
    const negotiation = deferred<boolean>();
    const terminal: FakeTerminal = {
      kittyProtocolActive: false,
      waitForKeyboardProtocolNegotiation: vi.fn(() => negotiation.promise),
    };
    const showWarning = vi.fn();
    const getUserInput = vi.fn(() => new Promise<string>(() => {}));
    const self = {
      init: vi.fn(async () => {}),
      version: "0.0.0",
      options: {},
      ui: { terminal },
      settingsManager: { getStartupNotices: () => false, getWarnings: () => ({}) },
      session: { modelRegistry: { getError: () => undefined }, prompt: vi.fn() },
      checkTmuxKeyboardSetup: vi.fn(async () => undefined),
      maybeWarnAboutAnthropicSubscriptionAuth: vi.fn(async () => {}),
      showWarning,
      showError: vi.fn(),
      getUserInput,
    };

    void do_run(self as unknown as InteractiveMode);
    await vi.waitFor(() => expect(getUserInput).toHaveBeenCalledTimes(1));
    expect(terminal.waitForKeyboardProtocolNegotiation).toHaveBeenCalledTimes(1);
    expect(showWarning).not.toHaveBeenCalled();

    negotiation.resolve(true);
    await vi.waitFor(() => expect(showWarning).toHaveBeenCalledTimes(1));
    expect(showWarning.mock.calls[0]?.[0]).toContain("may submit");
  });
});
