import { isKeyRelease, matchesKey } from "../../keys.ts";
import { isOsc11BackgroundColorResponse, parseOsc11BackgroundColor } from "../../terminal-colors.ts";
import { setCellDimensions } from "../../terminal-image.ts";
import type { TUI } from "../tui.ts";

export function do_handleInput(self: TUI, data: string): void {
  if (self.consumeOsc11BackgroundResponse(data)) {
    return;
  }

  if (self.inputListeners.size > 0) {
    let current = data;
    for (const listener of self.inputListeners) {
      const result = listener(current);
      if (result?.consume) {
        return;
      }
      if (result?.data !== undefined) {
        current = result.data;
      }
    }
    if (current.length === 0) {
      return;
    }
    data = current;
  }

  // Consume terminal cell size responses without blocking unrelated input.
  if (self.consumeCellSizeResponse(data)) {
    return;
  }

  // Global debug key handler (Shift+Ctrl+D)
  if (matchesKey(data, "shift+ctrl+d") && self.onDebug) {
    self.onDebug();
    return;
  }

  // If focused component is an overlay, verify it's still visible
  // (visibility can change due to terminal resize or visible() callback)
  const focusedOverlay = self.overlayStack.find((o) => o.component === self.focusedComponent);
  if (focusedOverlay && !self.isOverlayVisible(focusedOverlay)) {
    // Focused overlay is no longer visible, redirect to topmost visible overlay
    const topVisible = self.getTopmostVisibleOverlay();
    if (topVisible) {
      self.setFocus(topVisible.component);
    } else {
      self.setFocusInternal({ component: focusedOverlay.preFocus, overlayFocusRestore: "preserve" });
    }
  }

  const focusIsOverlay = self.overlayStack.some((o) => o.component === self.focusedComponent);
  if (!focusIsOverlay) {
    const restoreState = self.getVisibleOverlayFocusRestore();
    if (restoreState.status === "eligible") {
      self.setFocus(restoreState.overlay.component);
    } else if (restoreState.status === "blocked" && restoreState.blockedBy !== self.focusedComponent) {
      if (restoreState.resume.status === "restore-overlay") {
        self.setFocus(restoreState.overlay.component);
      } else {
        self.clearOverlayFocusRestore();
        self.setFocus(restoreState.resume.target);
      }
    }
  }

  // Pass input to focused component (including Ctrl+C)
  // The focused component can decide how to handle Ctrl+C
  if (self.focusedComponent?.handleInput) {
    // Filter out key release events unless component opts in
    if (isKeyRelease(data) && !self.focusedComponent.wantsKeyRelease) {
      return;
    }
    self.focusedComponent.handleInput(data);
    self.requestRender();
  }
}

export function do_consumeOsc11BackgroundResponse(self: TUI, data: string): boolean {
  if (self.pendingOsc11BackgroundReplies <= 0) {
    return false;
  }

  if (!isOsc11BackgroundColorResponse(data)) {
    return false;
  }

  const rgb = parseOsc11BackgroundColor(data);
  self.pendingOsc11BackgroundReplies -= 1;
  const query = self.pendingOsc11BackgroundQueries.shift();
  if (query && !query.settled) {
    query.settled = true;
    if (query.timer) {
      clearTimeout(query.timer);
      query.timer = undefined;
    }
    query.resolve?.(rgb);
    query.resolve = undefined;
  }
  return true;
}

export function do_consumeCellSizeResponse(self: TUI, data: string): boolean {
  // Response format: ESC [ 6 ; height ; width t
  const match = data.match(/^\x1b\[6;(\d+);(\d+)t$/);
  if (!match) {
    return false;
  }

  const heightPx = parseInt(match[1], 10);
  const widthPx = parseInt(match[2], 10);
  if (heightPx <= 0 || widthPx <= 0) {
    return true;
  }

  setCellDimensions({ widthPx, heightPx });
  // Invalidate all components so images re-render with correct dimensions.
  self.invalidate();
  self.requestRender();
  return true;
}
