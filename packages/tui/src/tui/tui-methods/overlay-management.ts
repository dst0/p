import type { TUI } from "../tui.ts";
import type { Component, InputListener, OverlayHandle, OverlayOptions, OverlayStackEntry } from "../types.ts";

export function do_showOverlay(self: TUI, component: Component, options?: OverlayOptions): OverlayHandle {
  const entry: OverlayStackEntry = {
    component,
    ...(options === undefined ? {} : { options }),
    preFocus: self.focusedComponent,
    hidden: false,
    focusOrder: ++self.focusOrderCounter,
  };
  self.overlayStack.push(entry);
  // Only focus if overlay is actually visible
  if (!options?.nonCapturing && self.isOverlayVisible(entry)) {
    self.setFocus(component);
  }
  self.terminal.hideCursor();
  self.requestRender();

  // Return handle for controlling self overlay
  return {
    hide: () => {
      const index = self.overlayStack.indexOf(entry);
      if (index !== -1) {
        self.clearOverlayFocusRestoreFor(entry);
        self.retargetOverlayPreFocus(entry);
        self.overlayStack.splice(index, 1);
        // Restore focus if self overlay had focus
        if (self.focusedComponent === component) {
          const topVisible = self.getTopmostVisibleOverlay();
          self.setFocus(topVisible?.component ?? entry.preFocus);
        }
        if (self.overlayStack.length === 0) self.terminal.hideCursor();
        self.requestRender();
      }
    },
    setHidden: (hidden: boolean) => {
      if (entry.hidden === hidden) return;
      entry.hidden = hidden;
      // Update focus when hiding/showing
      if (hidden) {
        self.clearOverlayFocusRestoreFor(entry);
        // If self overlay had focus, move focus to next visible or preFocus
        if (self.focusedComponent === component) {
          const topVisible = self.getTopmostVisibleOverlay();
          self.setFocus(topVisible?.component ?? entry.preFocus);
        }
      } else {
        // Restore focus to self overlay when showing (if it's actually visible)
        if (!options?.nonCapturing && self.isOverlayVisible(entry)) {
          entry.focusOrder = ++self.focusOrderCounter;
          self.setFocus(component);
        }
      }
      self.requestRender();
    },
    isHidden: () => entry.hidden,
    focus: () => {
      if (!self.overlayStack.includes(entry) || !self.isOverlayVisible(entry)) return;
      entry.focusOrder = ++self.focusOrderCounter;
      self.setFocus(component);
      self.requestRender();
    },
    unfocus: (unfocusOptions) => {
      const isFocused = self.focusedComponent === component;
      const restoreState = self.overlayFocusRestore;
      const hasPendingRestore = restoreState.status !== "inactive" && restoreState.overlay === entry;
      if (!isFocused && !hasPendingRestore) return;
      if (
        restoreState.status === "blocked" &&
        restoreState.overlay === entry &&
        self.focusedComponent === restoreState.blockedBy
      ) {
        if (unfocusOptions) {
          self.overlayFocusRestore = {
            status: "blocked",
            overlay: entry,
            blockedBy: restoreState.blockedBy,
            resume: { status: "focus-target", target: unfocusOptions.target },
          };
        } else {
          self.clearOverlayFocusRestore();
        }
        self.requestRender();
        return;
      }
      self.clearOverlayFocusRestoreFor(entry);
      if (isFocused || unfocusOptions) {
        const topVisible = self.getTopmostVisibleOverlay();
        const fallbackTarget = topVisible && topVisible !== entry ? topVisible.component : entry.preFocus;
        self.setFocus(unfocusOptions ? unfocusOptions.target : fallbackTarget);
      }
      self.requestRender();
    },
    isFocused: () => self.focusedComponent === component,
  };
}

export function do_hideOverlay(self: TUI): void {
  const overlay = self.overlayStack[self.overlayStack.length - 1];
  if (!overlay) return;
  self.clearOverlayFocusRestoreFor(overlay);
  self.retargetOverlayPreFocus(overlay);
  self.overlayStack.pop();
  if (self.focusedComponent === overlay.component) {
    // Find topmost visible overlay, or fall back to preFocus
    const topVisible = self.getTopmostVisibleOverlay();
    self.setFocus(topVisible?.component ?? overlay.preFocus);
  }
  if (self.overlayStack.length === 0) self.terminal.hideCursor();
  self.requestRender();
}

export function do_hasOverlay(self: TUI): boolean {
  return self.overlayStack.some((o) => self.isOverlayVisible(o));
}

export function do_isOverlayVisible(self: TUI, entry: OverlayStackEntry): boolean {
  if (entry.hidden) return false;
  if (entry.options?.visible) {
    return entry.options.visible(self.terminal.columns, self.terminal.rows);
  }
  return true;
}

export function do_getTopmostVisibleOverlay(self: TUI): OverlayStackEntry | undefined {
  let topmost: OverlayStackEntry | undefined;
  for (const overlay of self.overlayStack) {
    if (overlay.options?.nonCapturing || !self.isOverlayVisible(overlay)) continue;
    if (!topmost || overlay.focusOrder > topmost.focusOrder) {
      topmost = overlay;
    }
  }
  return topmost;
}

export function do_start(self: TUI): void {
  self.stopped = false;
  self.terminal.start(
    (data) => self.handleInput(data),
    () => self.requestRender(),
  );
  self.terminal.hideCursor();
  self.queryCellSize();
  self.requestRender();
}

export function do_addInputListener(self: TUI, listener: InputListener): () => void {
  self.inputListeners.add(listener);
  return () => {
    self.inputListeners.delete(listener);
  };
}

export function do_removeInputListener(self: TUI, listener: InputListener): void {
  self.inputListeners.delete(listener);
}
