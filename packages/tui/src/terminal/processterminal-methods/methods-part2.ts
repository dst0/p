import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { setKittyProtocolActive } from "../../keys.ts";
import { cjsRequire, TERMINAL_PROGRESS_CLEAR_SEQUENCE } from "../constants.ts";
import type { ProcessTerminal } from "../processterminal.ts";

export function do_enableModifyOtherKeys(self: ProcessTerminal): void {
  if (self._kittyProtocolActive || self._modifyOtherKeysActive) return;
  process.stdout.write("\x1b[>4;2m");
  self._modifyOtherKeysActive = true;
}

export function do_disableModifyOtherKeys(self: ProcessTerminal): void {
  if (!self._modifyOtherKeysActive) return;
  process.stdout.write("\x1b[>4;0m");
  self._modifyOtherKeysActive = false;
}

export function do_enableWindowsVTInput(_self: ProcessTerminal): void {
  if (process.platform !== "win32") return;
  try {
    const arch = process.arch;
    if (arch !== "x64" && arch !== "arm64") return;

    // Dynamic require so non-Windows and bundled/browser paths never load the
    // native helper. In the npm package native/ is next to dist/; in compiled
    // binary archives native/ is copied next to the executable.
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const nativePath = path.join("native", "win32", "prebuilds", `win32-${arch}`, "win32-console-mode.node");
    const candidates = [
      path.join(moduleDir, "..", nativePath),
      path.join(moduleDir, nativePath),
      path.join(path.dirname(process.execPath), nativePath),
    ];
    for (const modulePath of candidates) {
      try {
        const helper = cjsRequire(modulePath) as { enableVirtualTerminalInput?: () => boolean };
        helper.enableVirtualTerminalInput?.();
        return;
      } catch {
        // Try the next possible packaging location.
      }
    }
  } catch {
    // Native helper not available — Shift+Tab won't be distinguishable from Tab.
  }
}

export async function do_drainInput(self: ProcessTerminal, maxMs = 1000, idleMs = 50): Promise<void> {
  self.setMouseTracking(false);
  const shouldDisableKittyProtocol = self.keyboardProtocolPushed || self._kittyProtocolActive;
  self.clearKeyboardProtocolNegotiationBuffer();
  if (shouldDisableKittyProtocol) {
    // Disable Kitty keyboard protocol first so any late key releases
    // do not generate new Kitty escape sequences.
    process.stdout.write("\x1b[<u");
    self.keyboardProtocolPushed = false;
    self._kittyProtocolActive = false;
    setKittyProtocolActive(false);
  }
  self.disableModifyOtherKeys();

  const previousHandler = self.inputHandler;
  self.inputHandler = undefined;

  let lastDataTime = Date.now();
  const onData = () => {
    lastDataTime = Date.now();
  };

  process.stdin.on("data", onData);
  const endTime = Date.now() + maxMs;

  const check = async (): Promise<void> => {
    const now = Date.now();
    const timeLeft = endTime - now;
    if (timeLeft <= 0) return;
    if (now - lastDataTime >= idleMs) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(idleMs, timeLeft)));
    return check();
  };

  try {
    await check();
  } finally {
    process.stdin.removeListener("data", onData);
    self.inputHandler = previousHandler;
  }
}

export function do_stop(self: ProcessTerminal): void {
  if (self.clearProgressInterval()) {
    process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
  }

  self.setMouseTracking(false);

  // Disable bracketed paste mode
  process.stdout.write("\x1b[?2004l");

  const shouldDisableKittyProtocol = self.keyboardProtocolPushed || self._kittyProtocolActive;
  self.clearKeyboardProtocolNegotiationBuffer();

  /* c8 ignore stop */
  // Disable Kitty keyboard protocol if not already done by drainInput()
  if (shouldDisableKittyProtocol) {
    process.stdout.write("\x1b[<u");
    self.keyboardProtocolPushed = false;
    self._kittyProtocolActive = false;
    setKittyProtocolActive(false);
  }
  self.disableModifyOtherKeys();

  // Clean up StdinBuffer
  if (self.stdinBuffer) {
    self.stdinBuffer.destroy();
    self.stdinBuffer = undefined;
  }

  // Remove event handlers
  if (self.stdinDataHandler) {
    process.stdin.removeListener("data", self.stdinDataHandler);
    self.stdinDataHandler = undefined;
  }
  self.inputHandler = undefined;
  if (self.resizeHandler) {
    process.stdout.removeListener("resize", self.resizeHandler);
    self.resizeHandler = undefined;
  }

  // Pause stdin to prevent any buffered input (e.g., Ctrl+D) from being
  // re-interpreted after raw mode is disabled. This fixes a race condition
  // where Ctrl+D could close the parent shell over SSH.
  process.stdin.pause();

  // Restore raw mode state
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(self.wasRaw);
  }
}

export function do_write(self: ProcessTerminal, data: string): void {
  process.stdout.write(data);
  if (self.writeLogPath) {
    try {
      fs.appendFileSync(self.writeLogPath, data, { encoding: "utf8" });
    } catch {
      // Ignore logging errors
    }
  }
}

export function do_moveBy(_self: ProcessTerminal, lines: number): void {
  if (lines > 0) {
    // Move down
    process.stdout.write(`\x1b[${lines}B`);
  } else if (lines < 0) {
    // Move up
    process.stdout.write(`\x1b[${-lines}A`);
  }
  // lines === 0: no movement
}
