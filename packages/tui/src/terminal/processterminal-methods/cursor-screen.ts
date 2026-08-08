import {
  TERMINAL_PROGRESS_ACTIVE_SEQUENCE,
  TERMINAL_PROGRESS_CLEAR_SEQUENCE,
  TERMINAL_PROGRESS_KEEPALIVE_MS,
} from "../constants.ts";
import type { ProcessTerminal } from "../processterminal.ts";

export function do_hideCursor(_self: ProcessTerminal): void {
  process.stdout.write("\x1b[?25l");
}

export function do_showCursor(_self: ProcessTerminal): void {
  process.stdout.write("\x1b[?25h");
}

export function do_clearLine(_self: ProcessTerminal): void {
  process.stdout.write("\x1b[K");
}

export function do_clearFromCursor(_self: ProcessTerminal): void {
  process.stdout.write("\x1b[J");
}

export function do_clearScreen(_self: ProcessTerminal): void {
  process.stdout.write("\x1b[2J\x1b[H"); // Clear screen and move to home (1,1)
}

export function do_setTitle(_self: ProcessTerminal, title: string): void {
  // OSC 0;title BEL - set terminal window title
  process.stdout.write(`\x1b]0;${title}\x07`);
}

export function do_setProgress(self: ProcessTerminal, active: boolean): void {
  if (active) {
    // OSC 9;4;3 - indeterminate progress
    process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
    if (!self.progressInterval) {
      self.progressInterval = setInterval(() => {
        process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
      }, TERMINAL_PROGRESS_KEEPALIVE_MS);
    }
  } else {
    self.clearProgressInterval();
    // OSC 9;4;0 - clear progress
    process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
  }
}

export function do_setMouseTracking(self: ProcessTerminal, active: boolean): void {
  if (active === self.mouseTrackingActive) return;
  self.mouseTrackingActive = active;
  process.stdout.write(active ? "\x1b[?1002h\x1b[?1006h" : "\x1b[?1006l\x1b[?1002l");
}

export function do_clearProgressInterval(self: ProcessTerminal): boolean {
  if (!self.progressInterval) return false;
  clearInterval(self.progressInterval);
  self.progressInterval = undefined;
  return true;
}
