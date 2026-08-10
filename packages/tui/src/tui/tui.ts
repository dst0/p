import type { Terminal } from "../terminal.ts";
import type { RgbColor } from "../terminal-colors.ts";
import { type DelegatedMethods, installDelegatedMethods } from "../utils/install-delegated-methods.ts";
import { Container } from "./container.ts";
import * as configurationDelegates from "./tui-methods/configuration.ts";
import * as cursorBackgroundDelegates from "./tui-methods/cursor-background.ts";
import * as inputHandlingDelegates from "./tui-methods/input-handling.ts";
import * as lineCompositingDelegates from "./tui-methods/line-compositing.ts";
import * as overlayCompositingDelegates from "./tui-methods/overlay-compositing.ts";
import * as overlayLayoutDelegates from "./tui-methods/overlay-layout.ts";
import * as overlayManagementDelegates from "./tui-methods/overlay-management.ts";
import * as renderPipelineDelegates from "./tui-methods/render-pipeline.ts";
import * as terminalControlDelegates from "./tui-methods/terminal-control.ts";
import type {
  Component,
  InputListener,
  OverlayFocusRestorePolicy,
  OverlayFocusRestoreState,
  OverlayStackEntry,
  PendingOsc11BackgroundQuery,
} from "./types.ts";

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The installer below synchronously defines every delegated method.
export class TUI extends Container {
  public terminal: Terminal;

  public previousLines: string[] = [];

  public previousKittyImageIds = new Set<number>();

  public previousWidth = 0;

  public previousHeight = 0;

  public focusedComponent: Component | null = null;

  public inputListeners = new Set<InputListener>();

  public onDebug?: () => void;

  public renderRequested = false;

  public renderTimer: NodeJS.Timeout | undefined;

  public lastRenderAt = 0;

  public static readonly MIN_RENDER_INTERVAL_MS = 16;

  public cursorRow = 0;

  public hardwareCursorRow = 0;

  public showHardwareCursor = process.env.PI_HARDWARE_CURSOR === "1";

  public clearOnShrink = process.env.PI_CLEAR_ON_SHRINK === "1";

  public maxLinesRendered = 0;

  public previousViewportTop = 0;

  public fullRedrawCount = 0;

  public stopped = false;

  public pendingOsc11BackgroundReplies = 0;

  public pendingOsc11BackgroundQueries: PendingOsc11BackgroundQuery[] = [];

  public focusOrderCounter = 0;

  public overlayStack: OverlayStackEntry[] = [];

  public previousOverlayCount = 0;

  public overlayFocusRestore: OverlayFocusRestoreState = { status: "inactive" };

  constructor(terminal: Terminal, showHardwareCursor?: boolean) {
    super();
    this.terminal = terminal;
    if (showHardwareCursor !== undefined) {
      this.showHardwareCursor = showHardwareCursor;
    }
  }

  get fullRedraws(): number {
    return this.fullRedrawCount;
  }

  public currentBackgroundColorHex: string | undefined = undefined;

  public static readonly SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

  override invalidate(): void {
    super.invalidate();
    for (const overlay of this.overlayStack) overlay.component.invalidate?.();
  }

  setFocusInternal({
    component,
    overlayFocusRestore,
  }: {
    component: Component | null;
    overlayFocusRestore: OverlayFocusRestorePolicy;
  }): void {
    configurationDelegates.do_setFocusInternal(this, {
      component,
      overlayFocusRestore,
    });
  }

  queryTerminalBackgroundColor({ timeoutMs }: { timeoutMs: number }): Promise<RgbColor | undefined> {
    return cursorBackgroundDelegates.do_queryTerminalBackgroundColor(this, { timeoutMs });
  }
}

type TUIMethods = Omit<
  DelegatedMethods<
    TUI,
    typeof configurationDelegates &
      typeof cursorBackgroundDelegates &
      typeof inputHandlingDelegates &
      typeof lineCompositingDelegates &
      typeof overlayCompositingDelegates &
      typeof overlayLayoutDelegates &
      typeof overlayManagementDelegates &
      typeof renderPipelineDelegates &
      typeof terminalControlDelegates
  >,
  "queryTerminalBackgroundColor" | "setFocusInternal"
>;

export interface TUI extends TUIMethods {}

installDelegatedMethods(TUI.prototype, [
  configurationDelegates,
  cursorBackgroundDelegates,
  inputHandlingDelegates,
  lineCompositingDelegates,
  overlayCompositingDelegates,
  overlayLayoutDelegates,
  overlayManagementDelegates,
  renderPipelineDelegates,
  terminalControlDelegates,
]);
