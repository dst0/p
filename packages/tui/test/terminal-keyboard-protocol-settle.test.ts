import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { setKittyProtocolActive } from "../src/keys.ts";
import { ProcessTerminal } from "../src/terminal.ts";

type NegotiationHarness = {
  terminal: ProcessTerminal;
  send(data: string): void;
  cleanup(): void;
};

function startNegotiation(): NegotiationHarness {
  const terminal = new ProcessTerminal();
  let dataHandler: ((data: string) => void) | undefined;
  const previousWrite = process.stdout.write;
  const previousOn = process.stdin.on;

  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stdin.on = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === "data") dataHandler = listener as (data: string) => void;
    return process.stdin;
  }) as typeof process.stdin.on;
  terminal.inputHandler = () => {};
  terminal.queryAndEnableKittyProtocol();

  return {
    terminal,
    send(data: string): void {
      dataHandler?.(data);
    },
    cleanup(): void {
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

async function settleState(promise: Promise<boolean>): Promise<boolean | "pending"> {
  const pending = Symbol("pending");
  const result = await Promise.race([promise, Promise.resolve(pending)]);
  return result === pending ? "pending" : (result as boolean);
}

describe("ProcessTerminal.waitForKeyboardProtocolNegotiation", () => {
  let harness: NegotiationHarness;

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
    harness = startNegotiation();
  });

  afterEach(() => {
    harness.cleanup();
    mock.timers.reset();
  });

  it("stays pending until the terminal answers the keyboard protocol query", async () => {
    const waiting = harness.terminal.waitForKeyboardProtocolNegotiation(2000);

    harness.send("a");
    harness.send("\x1b[A");
    assert.equal(await settleState(waiting), "pending");
    assert.equal(harness.terminal.kittyProtocolActive, false);
    assert.equal(harness.terminal.modifyOtherKeysActive, false);

    mock.timers.tick(2000);
    assert.equal(await waiting, false);
  });

  it("resolves true with kitty active once non-zero kitty flags arrive", async () => {
    const waiting = harness.terminal.waitForKeyboardProtocolNegotiation(2000);

    harness.send("\x1b[?7u");

    assert.equal(await waiting, true);
    assert.equal(harness.terminal.kittyProtocolActive, true);
  });

  it("resolves true without kitty when only device attributes arrive", async () => {
    const waiting = harness.terminal.waitForKeyboardProtocolNegotiation(2000);

    harness.send("\x1b[?62;4;52c");

    assert.equal(await waiting, true);
    assert.equal(harness.terminal.kittyProtocolActive, false);
    assert.equal(harness.terminal.modifyOtherKeysActive, true);
  });

  it("does not settle on zero kitty flags until device attributes confirm the fallback", async () => {
    const waiting = harness.terminal.waitForKeyboardProtocolNegotiation(2000);

    harness.send("\x1b[?0u");
    assert.equal(await settleState(waiting), "pending");

    harness.send("\x1b[?62c");
    assert.equal(await waiting, true);
    assert.equal(harness.terminal.kittyProtocolActive, false);
  });

  it("times out after zero kitty flags when the device-attributes reply never arrives", async () => {
    const waiting = harness.terminal.waitForKeyboardProtocolNegotiation(500);

    harness.send("\x1b[?0u");
    mock.timers.tick(500);

    assert.equal(await waiting, false);
    assert.equal(harness.terminal.kittyProtocolActive, false);
    assert.equal(harness.terminal.modifyOtherKeysActive, true);
  });

  it("settles when the kitty reply arrives split across reads", async () => {
    const waiting = harness.terminal.waitForKeyboardProtocolNegotiation(2000);

    harness.send("\x1b[?7");
    mock.timers.tick(10);
    assert.equal(await settleState(waiting), "pending");
    harness.send("u");

    assert.equal(await waiting, true);
    assert.equal(harness.terminal.kittyProtocolActive, true);
  });

  it("settles with kitty active when one read carries both the kitty and device-attributes replies", async () => {
    const waiting = harness.terminal.waitForKeyboardProtocolNegotiation(2000);

    harness.send("\x1b[?7u\x1b[?62;4c");
    mock.timers.tick(10);

    assert.equal(await waiting, true);
    assert.equal(harness.terminal.kittyProtocolActive, true);
    assert.equal(harness.terminal.modifyOtherKeysActive, false);
  });

  it("starts a fresh negotiation when the terminal is stopped and queried again", async () => {
    harness.send("\x1b[?7u");
    assert.equal(await settleState(harness.terminal.waitForKeyboardProtocolNegotiation(2000)), true);

    harness.terminal.stop();
    harness.terminal.queryAndEnableKittyProtocol();
    const waiting = harness.terminal.waitForKeyboardProtocolNegotiation(2000);
    assert.equal(harness.terminal.kittyProtocolActive, false);
    assert.equal(await settleState(waiting), "pending");

    harness.send("\x1b[?62c");
    assert.equal(await waiting, true);
    assert.equal(harness.terminal.kittyProtocolActive, false);
  });

  it("resolves immediately when negotiation already settled before the wait began", async () => {
    harness.send("\x1b[?7u");

    assert.equal(await settleState(harness.terminal.waitForKeyboardProtocolNegotiation(2000)), true);
  });

  it("resolves false after the timeout and ignores a reply that arrives later", async () => {
    const waiting = harness.terminal.waitForKeyboardProtocolNegotiation(500);

    mock.timers.tick(499);
    assert.equal(await settleState(waiting), "pending");
    mock.timers.tick(1);
    assert.equal(await waiting, false);

    harness.send("\x1b[?7u");
    assert.equal(harness.terminal.kittyProtocolActive, true);
    assert.equal(await settleState(harness.terminal.waitForKeyboardProtocolNegotiation(500)), true);
  });

  it("settles every concurrent waiter on one reply", async () => {
    const first = harness.terminal.waitForKeyboardProtocolNegotiation(2000);
    const second = harness.terminal.waitForKeyboardProtocolNegotiation(5000);

    harness.send("\x1b[?62c");

    assert.deepEqual(await Promise.all([first, second]), [true, true]);
  });

  it("drops waiters from the terminal once they settle or time out", async () => {
    const settled = harness.terminal.waitForKeyboardProtocolNegotiation(2000);
    const timedOut = harness.terminal.waitForKeyboardProtocolNegotiation(100);
    assert.equal(harness.terminal.keyboardProtocolNegotiationWaiters.length, 2);

    mock.timers.tick(100);
    assert.equal(await timedOut, false);
    assert.equal(harness.terminal.keyboardProtocolNegotiationWaiters.length, 1);

    harness.send("\x1b[?7u");
    assert.equal(await settled, true);
    assert.equal(harness.terminal.keyboardProtocolNegotiationWaiters.length, 0);
  });
});

describe("ProcessTerminal.waitForKeyboardProtocolNegotiation process lifetime", () => {
  it("does not keep the process alive while the terminal stays silent", () => {
    const terminalModule = new URL("../src/terminal.ts", import.meta.url).href;
    const script = [
      `import { ProcessTerminal } from ${JSON.stringify(terminalModule)};`,
      "const terminal = new ProcessTerminal();",
      "terminal.waitForKeyboardProtocolNegotiation(120000).then((settled) => console.log('resolved', settled));",
    ].join("\n");

    const startedAt = Date.now();
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 30_000,
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.ok(Date.now() - startedAt < 30_000);
  });
});
