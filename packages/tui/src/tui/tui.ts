import type { Terminal } from "../terminal.ts";
import type { RgbColor } from "../terminal-colors.ts";
import { Container } from "./container.ts";
import {
  do_clearOverlayFocusRestore,
  do_clearOverlayFocusRestoreFor,
  do_containsComponent,
  do_getClearOnShrink,
  do_getShowHardwareCursor,
  do_getVisibleOverlayFocusRestore,
  do_isComponentMounted,
  do_isOverlayFocusAncestor,
  do_resolveBlockedOverlayFocusResume,
  do_retargetOverlayPreFocus,
  do_setClearOnShrink,
  do_setFocus,
  do_setFocusInternal,
  do_setShowHardwareCursor,
} from "./tui-methods/methods-part1.ts";
import {
  do_addInputListener,
  do_getTopmostVisibleOverlay,
  do_hasOverlay,
  do_hideOverlay,
  do_isOverlayVisible,
  do_removeInputListener,
  do_showOverlay,
  do_start,
} from "./tui-methods/methods-part2.ts";
import {
  do_queryCellSize,
  do_requestRender,
  do_resetTerminalBackgroundColor,
  do_scheduleRender,
  do_setTerminalBackgroundColor,
  do_stop,
} from "./tui-methods/methods-part3.ts";
import {
  do_consumeCellSizeResponse,
  do_consumeOsc11BackgroundResponse,
  do_handleInput,
} from "./tui-methods/methods-part4.ts";
import { do_resolveAnchorCol, do_resolveAnchorRow, do_resolveOverlayLayout } from "./tui-methods/methods-part5.ts";
import {
  do_applyLineResets,
  do_collectKittyImageIds,
  do_compositeOverlays,
  do_deleteChangedKittyImages,
  do_deleteKittyImages,
  do_expandChangedRangeForKittyImages,
  do_getKittyImageReservedRows,
} from "./tui-methods/methods-part6.ts";
import { do_compositeLineAt, do_extractCursorPosition } from "./tui-methods/methods-part7.ts";
import { do_doRender } from "./tui-methods/methods-part8.ts";
import { do_positionHardwareCursor, do_queryTerminalBackgroundColor } from "./tui-methods/methods-part9.ts";
import type {
  BlockedOverlayFocusRestoreState,
  Component,
  InputListener,
  OverlayAnchor,
  OverlayFocusRestorePolicy,
  OverlayFocusRestoreState,
  OverlayHandle,
  OverlayOptions,
  OverlayStackEntry,
  PendingOsc11BackgroundQuery,
} from "./types-part1.ts";

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

  getShowHardwareCursor(): boolean {
    return do_getShowHardwareCursor(this);
  }

  setShowHardwareCursor(enabled: boolean): void {
    do_setShowHardwareCursor(this, enabled);
  }

  getClearOnShrink(): boolean {
    return do_getClearOnShrink(this);
  }

  setClearOnShrink(enabled: boolean): void {
    do_setClearOnShrink(this, enabled);
  }

  setFocus(component: Component | null): void {
    do_setFocus(this, component);
  }

  setFocusInternal({
    component,
    overlayFocusRestore,
  }: {
    component: Component | null;
    overlayFocusRestore: OverlayFocusRestorePolicy;
  }): void {
    do_setFocusInternal(this, {
      component,
      overlayFocusRestore,
    });
  }

  clearOverlayFocusRestore(): void {
    do_clearOverlayFocusRestore(this);
  }

  clearOverlayFocusRestoreFor(overlay: OverlayStackEntry): void {
    do_clearOverlayFocusRestoreFor(this, overlay);
  }

  resolveBlockedOverlayFocusResume(restoreState: BlockedOverlayFocusRestoreState): Component | null {
    return do_resolveBlockedOverlayFocusResume(this, restoreState);
  }

  getVisibleOverlayFocusRestore(): OverlayFocusRestoreState {
    return do_getVisibleOverlayFocusRestore(this);
  }

  isOverlayFocusAncestor(entry: OverlayStackEntry, component: Component): boolean {
    return do_isOverlayFocusAncestor(this, entry, component);
  }

  retargetOverlayPreFocus(removed: OverlayStackEntry): void {
    do_retargetOverlayPreFocus(this, removed);
  }

  isComponentMounted(component: Component): boolean {
    return do_isComponentMounted(this, component);
  }

  containsComponent(root: Component, target: Component): boolean {
    return do_containsComponent(this, root, target);
  }

  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
    return do_showOverlay(this, component, options);
  }

  hideOverlay(): void {
    do_hideOverlay(this);
  }

  hasOverlay(): boolean {
    return do_hasOverlay(this);
  }

  isOverlayVisible(entry: OverlayStackEntry): boolean {
    return do_isOverlayVisible(this, entry);
  }

  getTopmostVisibleOverlay(): OverlayStackEntry | undefined {
    return do_getTopmostVisibleOverlay(this);
  }

  start(): void {
    do_start(this);
  }

  addInputListener(listener: InputListener): () => void {
    return do_addInputListener(this, listener);
  }

  removeInputListener(listener: InputListener): void {
    do_removeInputListener(this, listener);
  }

  queryCellSize(): void {
    do_queryCellSize(this);
  }

  setTerminalBackgroundColor(colorHex?: string): void {
    do_setTerminalBackgroundColor(this, colorHex);
  }

  resetTerminalBackgroundColor(): void {
    do_resetTerminalBackgroundColor(this);
  }

  stop(): void {
    do_stop(this);
  }

  requestRender(force = false): void {
    do_requestRender(this, force);
  }

  scheduleRender(): void {
    do_scheduleRender(this);
  }

  handleInput(data: string): void {
    do_handleInput(this, data);
  }

  consumeOsc11BackgroundResponse(data: string): boolean {
    return do_consumeOsc11BackgroundResponse(this, data);
  }

  consumeCellSizeResponse(data: string): boolean {
    return do_consumeCellSizeResponse(this, data);
  }

  resolveOverlayLayout(
    options: OverlayOptions | undefined,
    overlayHeight: number,
    termWidth: number,
    termHeight: number,
  ): { width: number; row: number; col: number; maxHeight: number | undefined } {
    return do_resolveOverlayLayout(this, options, overlayHeight, termWidth, termHeight);
  }

  resolveAnchorRow(anchor: OverlayAnchor, height: number, availHeight: number, marginTop: number): number {
    return do_resolveAnchorRow(this, anchor, height, availHeight, marginTop);
  }

  resolveAnchorCol(anchor: OverlayAnchor, width: number, availWidth: number, marginLeft: number): number {
    return do_resolveAnchorCol(this, anchor, width, availWidth, marginLeft);
  }

  compositeOverlays(lines: string[], termWidth: number, termHeight: number): string[] {
    return do_compositeOverlays(this, lines, termWidth, termHeight);
  }

  applyLineResets(lines: string[]): string[] {
    return do_applyLineResets(this, lines);
  }

  collectKittyImageIds(lines: string[]): Set<number> {
    return do_collectKittyImageIds(this, lines);
  }

  deleteKittyImages(ids: Iterable<number>): string {
    return do_deleteKittyImages(this, ids);
  }

  getKittyImageReservedRows(lines: string[], index: number, maxIndex = lines.length - 1): number {
    return do_getKittyImageReservedRows(this, lines, index, maxIndex);
  }

  expandChangedRangeForKittyImages(
    firstChanged: number,
    lastChanged: number,
    newLines: string[],
  ): { firstChanged: number; lastChanged: number } {
    return do_expandChangedRangeForKittyImages(this, firstChanged, lastChanged, newLines);
  }

  deleteChangedKittyImages(firstChanged: number, lastChanged: number): string {
    return do_deleteChangedKittyImages(this, firstChanged, lastChanged);
  }

  compositeLineAt(
    baseLine: string,
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): string {
    return do_compositeLineAt(this, baseLine, overlayLine, startCol, overlayWidth, totalWidth);
  }

  extractCursorPosition(lines: string[], height: number): { row: number; col: number } | null {
    return do_extractCursorPosition(this, lines, height);
  }

  doRender(): void {
    do_doRender(this);
  }

  positionHardwareCursor(cursorPos: { row: number; col: number } | null, totalLines: number): void {
    do_positionHardwareCursor(this, cursorPos, totalLines);
  }

  queryTerminalBackgroundColor({ timeoutMs }: { timeoutMs: number }): Promise<RgbColor | undefined> {
    return do_queryTerminalBackgroundColor(this, { timeoutMs });
  }
}
