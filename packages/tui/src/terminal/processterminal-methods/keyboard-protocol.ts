import { setKittyProtocolActive } from "../../keys.ts";
import { isNativeModifierPressed } from "../../native-modifiers.ts";
import { StdinBuffer } from "../../stdin-buffer.ts";
import { KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS, KITTY_KEYBOARD_PROTOCOL_QUERY } from "../constants.ts";
import {
  isAppleTerminalSession,
  isKeyboardProtocolNegotiationSequencePrefix,
  normalizeAppleTerminalInput,
  parseKeyboardProtocolNegotiationSequence,
} from "../helpers.ts";
import type { ProcessTerminal } from "../processterminal.ts";
import type { KeyboardProtocolNegotiationSequence } from "../types.ts";

export function do_start(self: ProcessTerminal, onInput: (data: string) => void, onResize: () => void): void {
  self.inputHandler = onInput;
  self.resizeHandler = onResize;

  // Save previous state and enable raw mode
  self.wasRaw = process.stdin.isRaw || false;
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.setEncoding("utf8");
  process.stdin.resume();

  // Enable bracketed paste mode - terminal will wrap pastes in \x1b[200~ ... \x1b[201~
  process.stdout.write("\x1b[?2004h");

  // Set up resize handler immediately
  process.stdout.on("resize", self.resizeHandler);

  // Refresh terminal dimensions - they may be stale after suspend/resume
  // (SIGWINCH is lost while process is stopped). Unix only.
  if (process.platform !== "win32") {
    process.kill(process.pid, "SIGWINCH");
  }

  // On Windows, enable ENABLE_VIRTUAL_TERMINAL_INPUT so the console sends
  // VT escape sequences (e.g. \x1b[Z for Shift+Tab) instead of raw console
  // events that lose modifier information. Must run AFTER setRawMode(true)
  // since that resets console mode flags.
  self.enableWindowsVTInput();

  // Query Kitty keyboard protocol and fall back to modifyOtherKeys when DA confirms no Kitty response.
  // See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
  self.queryAndEnableKittyProtocol();
}

export function do_setupStdinBuffer(self: ProcessTerminal): void {
  self.stdinBuffer = new StdinBuffer({ timeout: 10 });

  // Forward individual sequences to the input handler
  self.stdinBuffer.on("data", (sequence) => {
    const negotiationSequence = self.readKeyboardProtocolNegotiationSequence(sequence);
    if (negotiationSequence === "pending") {
      self.scheduleKeyboardProtocolNegotiationBufferFlush();
      return; // Wait briefly for the rest of a split Kitty response.
    }
    if (self.handleKeyboardProtocolNegotiationSequence(negotiationSequence)) {
      return;
    }

    self.forwardInputSequence(sequence);
  });

  // Re-wrap paste content with bracketed paste markers for existing editor handling
  self.stdinBuffer.on("paste", (content) => {
    if (self.inputHandler) {
      self.inputHandler(`\x1b[200~${content}\x1b[201~`);
    }
  });

  // Handler that pipes stdin data through the buffer
  self.stdinDataHandler = (data: string) => {
    self.stdinBuffer!.process(data);
  };
}

export function do_queryAndEnableKittyProtocol(self: ProcessTerminal): void {
  self.setupStdinBuffer();
  process.stdin.on("data", self.stdinDataHandler!);
  self.keyboardProtocolPushed = true;
  self.clearKeyboardProtocolNegotiationBuffer();
  process.stdout.write(KITTY_KEYBOARD_PROTOCOL_QUERY);
}

export function do_handleKeyboardProtocolNegotiationSequence(
  self: ProcessTerminal,
  negotiationSequence: KeyboardProtocolNegotiationSequence | undefined,
): boolean {
  if (!negotiationSequence) return false;
  self.clearKeyboardProtocolNegotiationBuffer();
  if (negotiationSequence.type === "kitty-flags") {
    if (negotiationSequence.flags !== 0) {
      self.disableModifyOtherKeys();
      if (!self._kittyProtocolActive) {
        self._kittyProtocolActive = true;
        setKittyProtocolActive(true);
      }
    } else {
      self.enableModifyOtherKeys();
    }
    return true;
  }

  if (!self._kittyProtocolActive) {
    self.enableModifyOtherKeys();
  }
  return true;
}

export function do_readKeyboardProtocolNegotiationSequence(
  self: ProcessTerminal,
  sequence: string,
): KeyboardProtocolNegotiationSequence | "pending" | undefined {
  if (self.keyboardProtocolNegotiationBuffer) {
    const bufferedSequence = self.keyboardProtocolNegotiationBuffer + sequence;
    const negotiationSequence = parseKeyboardProtocolNegotiationSequence(bufferedSequence);
    if (negotiationSequence) {
      self.clearKeyboardProtocolNegotiationBuffer();
      return negotiationSequence;
    }
    if (isKeyboardProtocolNegotiationSequencePrefix(bufferedSequence)) {
      self.setKeyboardProtocolNegotiationBuffer(bufferedSequence);
      return "pending";
    }
    self.flushKeyboardProtocolNegotiationBufferAsInput();
  }

  const negotiationSequence = parseKeyboardProtocolNegotiationSequence(sequence);
  if (negotiationSequence) return negotiationSequence;
  if (isKeyboardProtocolNegotiationSequencePrefix(sequence)) {
    self.setKeyboardProtocolNegotiationBuffer(sequence);
    return "pending";
  }
  return undefined;
}

export function do_setKeyboardProtocolNegotiationBuffer(self: ProcessTerminal, sequence: string): void {
  self.clearKeyboardProtocolNegotiationBufferFlushTimer();
  self.keyboardProtocolNegotiationBuffer = sequence;
}

export function do_clearKeyboardProtocolNegotiationBuffer(self: ProcessTerminal): void {
  self.clearKeyboardProtocolNegotiationBufferFlushTimer();
  self.keyboardProtocolNegotiationBuffer = "";
}

export function do_flushKeyboardProtocolNegotiationBufferAsInput(self: ProcessTerminal): void {
  if (!self.keyboardProtocolNegotiationBuffer) return;
  const sequence = self.keyboardProtocolNegotiationBuffer;
  self.clearKeyboardProtocolNegotiationBuffer();
  self.forwardInputSequence(sequence);
}

export function do_scheduleKeyboardProtocolNegotiationBufferFlush(self: ProcessTerminal): void {
  if (!self.keyboardProtocolNegotiationBuffer || self.keyboardProtocolBufferFlushTimer) return;
  self.keyboardProtocolBufferFlushTimer = setTimeout(() => {
    self.keyboardProtocolBufferFlushTimer = undefined;
    self.flushKeyboardProtocolNegotiationBufferAsInput();
  }, KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS);
}

export function do_clearKeyboardProtocolNegotiationBufferFlushTimer(self: ProcessTerminal): void {
  if (!self.keyboardProtocolBufferFlushTimer) return;
  clearTimeout(self.keyboardProtocolBufferFlushTimer);
  self.keyboardProtocolBufferFlushTimer = undefined;
}

export function do_forwardInputSequence(self: ProcessTerminal, sequence: string): void {
  if (!self.inputHandler) return;
  const isAppleTerminal = sequence === "\r" && isAppleTerminalSession();
  const input = normalizeAppleTerminalInput(
    sequence,
    isAppleTerminal,
    isAppleTerminal && isNativeModifierPressed("shift"),
  );
  self.inputHandler(input);
}
