import { APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE } from "./constants.ts";
import type { KeyboardProtocolNegotiationSequence } from "./types.ts";

export function parseKeyboardProtocolNegotiationSequence(
  sequence: string,
): KeyboardProtocolNegotiationSequence | undefined {
  const kittyFlags = sequence.match(/^\x1b\[\?(\d+)u$/);
  if (kittyFlags) {
    return { type: "kitty-flags", flags: Number.parseInt(kittyFlags[1]!, 10) };
  }
  if (/^\x1b\[\?[\d;]*c$/.test(sequence)) {
    return { type: "device-attributes" };
  }
  return undefined;
}

export function isKeyboardProtocolNegotiationSequencePrefix(sequence: string): boolean {
  return sequence === "\x1b[" || /^\x1b\[\?[\d;]*$/.test(sequence);
}

export function isAppleTerminalSession(): boolean {
  return process.platform === "darwin" && process.env.TERM_PROGRAM === "Apple_Terminal";
}

export function normalizeAppleTerminalInput(data: string, isAppleTerminal: boolean, isShiftPressed: boolean): string {
  if (isAppleTerminal && data === "\r" && isShiftPressed) return APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE;
  return data;
}
