import * as fs from "node:fs";
import * as path from "node:path";
import type { StdinBuffer } from "../stdin-buffer.ts";
import {
  do_clearKeyboardProtocolNegotiationBuffer,
  do_clearKeyboardProtocolNegotiationBufferFlushTimer,
  do_flushKeyboardProtocolNegotiationBufferAsInput,
  do_forwardInputSequence,
  do_handleKeyboardProtocolNegotiationSequence,
  do_queryAndEnableKittyProtocol,
  do_readKeyboardProtocolNegotiationSequence,
  do_scheduleKeyboardProtocolNegotiationBufferFlush,
  do_setKeyboardProtocolNegotiationBuffer,
  do_setupStdinBuffer,
  do_start,
} from "./processterminal-methods/methods-part1.ts";
import {
  do_disableModifyOtherKeys,
  do_drainInput,
  do_enableModifyOtherKeys,
  do_enableWindowsVTInput,
  do_moveBy,
  do_stop,
  do_write,
} from "./processterminal-methods/methods-part2.ts";
import {
  do_clearFromCursor,
  do_clearLine,
  do_clearProgressInterval,
  do_clearScreen,
  do_hideCursor,
  do_setMouseTracking,
  do_setProgress,
  do_setTitle,
  do_showCursor,
} from "./processterminal-methods/methods-part3.ts";
import type { KeyboardProtocolNegotiationSequence, Terminal } from "./types.ts";

export class ProcessTerminal implements Terminal {
  public wasRaw = false;

  public inputHandler?: (data: string) => void;

  public resizeHandler?: () => void;

  public _kittyProtocolActive = false;

  public _modifyOtherKeysActive = false;

  public keyboardProtocolPushed = false;

  public keyboardProtocolNegotiationBuffer = "";

  public keyboardProtocolBufferFlushTimer?: ReturnType<typeof setTimeout>;

  public stdinBuffer?: StdinBuffer;

  public stdinDataHandler?: (data: string) => void;

  public progressInterval?: ReturnType<typeof setInterval>;

  public mouseTrackingActive = false;

  public writeLogPath = (() => {
    const env = process.env.PI_TUI_WRITE_LOG || "";
    if (!env) return "";
    try {
      if (fs.statSync(env).isDirectory()) {
        const now = new Date();
        const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
        return path.join(env, `tui-${ts}-${process.pid}.log`);
      }
    } catch {
      // Not an existing directory - use as-is (file path)
    }
    return env;
  })();

  get kittyProtocolActive(): boolean {
    return this._kittyProtocolActive;
  }

  get modifyOtherKeysActive(): boolean {
    return this._modifyOtherKeysActive;
  }

  get columns(): number {
    return process.stdout.columns || Number(process.env.COLUMNS) || 80;
  }

  get rows(): number {
    return process.stdout.rows || Number(process.env.LINES) || 24;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    do_start(this, onInput, onResize);
  }

  setupStdinBuffer(): void {
    do_setupStdinBuffer(this);
  }

  queryAndEnableKittyProtocol(): void {
    do_queryAndEnableKittyProtocol(this);
  }

  handleKeyboardProtocolNegotiationSequence(
    negotiationSequence: KeyboardProtocolNegotiationSequence | undefined,
  ): boolean {
    return do_handleKeyboardProtocolNegotiationSequence(this, negotiationSequence);
  }

  readKeyboardProtocolNegotiationSequence(
    sequence: string,
  ): KeyboardProtocolNegotiationSequence | "pending" | undefined {
    return do_readKeyboardProtocolNegotiationSequence(this, sequence);
  }

  setKeyboardProtocolNegotiationBuffer(sequence: string): void {
    do_setKeyboardProtocolNegotiationBuffer(this, sequence);
  }

  clearKeyboardProtocolNegotiationBuffer(): void {
    do_clearKeyboardProtocolNegotiationBuffer(this);
  }

  flushKeyboardProtocolNegotiationBufferAsInput(): void {
    do_flushKeyboardProtocolNegotiationBufferAsInput(this);
  }

  scheduleKeyboardProtocolNegotiationBufferFlush(): void {
    do_scheduleKeyboardProtocolNegotiationBufferFlush(this);
  }

  clearKeyboardProtocolNegotiationBufferFlushTimer(): void {
    do_clearKeyboardProtocolNegotiationBufferFlushTimer(this);
  }

  forwardInputSequence(sequence: string): void {
    do_forwardInputSequence(this, sequence);
  }

  enableModifyOtherKeys(): void {
    do_enableModifyOtherKeys(this);
  }

  disableModifyOtherKeys(): void {
    do_disableModifyOtherKeys(this);
  }

  enableWindowsVTInput(): void {
    do_enableWindowsVTInput(this);
  }

  async drainInput(maxMs = 1000, idleMs = 50): Promise<void> {
    return do_drainInput(this, maxMs, idleMs);
  }

  stop(): void {
    do_stop(this);
  }

  write(data: string): void {
    do_write(this, data);
  }

  moveBy(lines: number): void {
    do_moveBy(this, lines);
  }

  hideCursor(): void {
    do_hideCursor(this);
  }

  showCursor(): void {
    do_showCursor(this);
  }

  clearLine(): void {
    do_clearLine(this);
  }

  clearFromCursor(): void {
    do_clearFromCursor(this);
  }

  clearScreen(): void {
    do_clearScreen(this);
  }

  setTitle(title: string): void {
    do_setTitle(this, title);
  }

  setProgress(active: boolean): void {
    do_setProgress(this, active);
  }

  setMouseTracking(active: boolean): void {
    do_setMouseTracking(this, active);
  }

  clearProgressInterval(): boolean {
    return do_clearProgressInterval(this);
  }
}
