import { Container } from "../container.ts";
import { isFocusable } from "../helpers.ts";
import type { TUI } from "../tui.ts";
import type {
  BlockedOverlayFocusRestoreState,
  Component,
  OverlayFocusRestorePolicy,
  OverlayFocusRestoreState,
  OverlayStackEntry,
} from "../types.ts";

export function do_getShowHardwareCursor(self: TUI): boolean {
  return self.showHardwareCursor;
}

export function do_setShowHardwareCursor(self: TUI, enabled: boolean): void {
  if (self.showHardwareCursor === enabled) return;
  self.showHardwareCursor = enabled;
  if (!enabled) {
    self.terminal.hideCursor();
  }
  self.requestRender();
}

export function do_getClearOnShrink(self: TUI): boolean {
  return self.clearOnShrink;
}

export function do_setClearOnShrink(self: TUI, enabled: boolean): void {
  self.clearOnShrink = enabled;
}

export function do_setFocus(self: TUI, component: Component | null): void {
  self.setFocusInternal({ component, overlayFocusRestore: "clear" });
}

export function do_setFocusInternal(
  self: TUI,
  {
    component,
    overlayFocusRestore,
  }: {
    component: Component | null;
    overlayFocusRestore: OverlayFocusRestorePolicy;
  },
): void {
  const previousFocus = self.focusedComponent;
  let nextFocus = component;
  const previousFocusedOverlay = previousFocus
    ? self.overlayStack.find((entry) => entry.component === previousFocus && self.isOverlayVisible(entry))
    : undefined;
  const nextFocusIsOverlay = nextFocus ? self.overlayStack.some((entry) => entry.component === nextFocus) : false;
  const restoreState = self.getVisibleOverlayFocusRestore();
  if (nextFocus && !nextFocusIsOverlay) {
    if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
      if (restoreState.resume.status === "focus-target" || !self.isComponentMounted(restoreState.blockedBy)) {
        nextFocus = self.resolveBlockedOverlayFocusResume(restoreState);
      } else {
        self.overlayFocusRestore = {
          status: "blocked",
          overlay: restoreState.overlay,
          blockedBy: nextFocus,
          resume: restoreState.resume,
        };
      }
    } else if (
      previousFocusedOverlay &&
      restoreState.status !== "inactive" &&
      restoreState.overlay === previousFocusedOverlay &&
      !self.isOverlayFocusAncestor(previousFocusedOverlay, nextFocus)
    ) {
      self.overlayFocusRestore = {
        status: "blocked",
        overlay: previousFocusedOverlay,
        blockedBy: nextFocus,
        resume: { status: "restore-overlay" },
      };
    }
  } else if (nextFocus === null) {
    if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
      nextFocus = self.resolveBlockedOverlayFocusResume(restoreState);
    } else if (overlayFocusRestore === "clear") {
      self.clearOverlayFocusRestore();
    }
  }

  if (isFocusable(self.focusedComponent)) {
    self.focusedComponent.focused = false;
  }

  self.focusedComponent = nextFocus;

  if (isFocusable(nextFocus)) {
    nextFocus.focused = true;
  }

  const focusedOverlay = nextFocus
    ? self.overlayStack.find((entry) => entry.component === nextFocus && self.isOverlayVisible(entry))
    : undefined;
  if (focusedOverlay) {
    self.overlayFocusRestore = { status: "eligible", overlay: focusedOverlay };
  }
}

export function do_clearOverlayFocusRestore(self: TUI): void {
  self.overlayFocusRestore = { status: "inactive" };
}

export function do_clearOverlayFocusRestoreFor(self: TUI, overlay: OverlayStackEntry): void {
  if (self.overlayFocusRestore.status !== "inactive" && self.overlayFocusRestore.overlay === overlay) {
    self.clearOverlayFocusRestore();
  }
}

export function do_resolveBlockedOverlayFocusResume(
  self: TUI,
  restoreState: BlockedOverlayFocusRestoreState,
): Component | null {
  if (restoreState.resume.status === "restore-overlay") return restoreState.overlay.component;
  self.clearOverlayFocusRestore();
  return restoreState.resume.target;
}

export function do_getVisibleOverlayFocusRestore(self: TUI): OverlayFocusRestoreState {
  const restoreState = self.overlayFocusRestore;
  if (restoreState.status === "inactive") return restoreState;
  if (!self.overlayStack.includes(restoreState.overlay) || !self.isOverlayVisible(restoreState.overlay)) {
    return { status: "inactive" };
  }
  return restoreState;
}

export function do_isOverlayFocusAncestor(self: TUI, entry: OverlayStackEntry, component: Component): boolean {
  const visited = new Set<Component>();
  let current = entry.preFocus;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current === component) return true;
    current = self.overlayStack.find((overlay) => overlay.component === current)?.preFocus ?? null;
  }
  return false;
}

export function do_retargetOverlayPreFocus(self: TUI, removed: OverlayStackEntry): void {
  for (const overlay of self.overlayStack) {
    if (overlay !== removed && overlay.preFocus === removed.component) {
      overlay.preFocus = removed.preFocus;
    }
  }
}

export function do_isComponentMounted(self: TUI, component: Component): boolean {
  return self.children.some((child) => self.containsComponent(child, component));
}

export function do_containsComponent(self: TUI, root: Component, target: Component): boolean {
  if (root === target) return true;
  if (!(root instanceof Container)) return false;
  return root.children.some((child) => self.containsComponent(child, target));
}
