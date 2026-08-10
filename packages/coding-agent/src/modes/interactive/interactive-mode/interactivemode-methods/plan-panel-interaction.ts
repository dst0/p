import { Spacer, Text } from "@dst0/p-tui";
import { getOrderedPlanTree } from "../../../../core/compaction/index.ts";
import type { SgrMouseEvent } from "../../components/plan-panel.ts";
import { theme } from "../../theme/theme.ts";
import { MIN_PLAN_PANEL_HEIGHT, MIN_PLAN_PANEL_WIDTH } from "../constants.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_scrollPlanPanel(self: InteractiveMode, direction: -1 | 1): void {
  if (self.planPanel.scrollBy(direction * 3)) {
    self.ui.requestRender();
  }
}

export function do_resizePlanPanel(self: InteractiveMode, widthDelta: number, heightDelta: number): void {
  const bounds = self.getPlanPanelBounds();
  const width = widthDelta === 0 ? undefined : bounds.width + widthDelta;
  const height = heightDelta === 0 ? undefined : (self.planPanelHeight ?? bounds.height) + heightDelta;
  self.setPlanPanelSize(width, height);
}

export function do_setPlanPanelSize(
  self: InteractiveMode,
  width: number | undefined,
  height: number | undefined,
): void {
  let changed = false;
  if (width !== undefined && self.planPanelMode === "compact") {
    const maxWidth = Math.max(4, self.ui.terminal.columns - 2);
    const minWidth = Math.min(MIN_PLAN_PANEL_WIDTH, maxWidth);
    const nextWidth = Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
    if (nextWidth !== self.planPanelCompactWidth) {
      self.planPanelCompactWidth = nextWidth;
      self.settingsManager.setPlanPanelCompactWidth(nextWidth);
      changed = true;
    }
  }

  if (height !== undefined) {
    const maxHeight = self.getPlanPanelMaxHeight();
    const minHeight = Math.min(MIN_PLAN_PANEL_HEIGHT, maxHeight);
    const nextHeight = Math.max(minHeight, Math.min(maxHeight, Math.round(height)));
    if (nextHeight !== self.planPanelHeight) {
      self.planPanelHeight = nextHeight;
      self.settingsManager.setPlanPanelHeight(nextHeight);
      changed = true;
    }
  }

  if (changed) {
    self.showPlanPanelOverlay();
  }
}

export function do_handlePlanPanelMouse(self: InteractiveMode, event: SgrMouseEvent): boolean {
  const bounds = self.getPlanPanelBounds();
  const inside = event.x >= bounds.left && event.x <= bounds.right && event.y >= bounds.top && event.y <= bounds.bottom;
  const isWheel = (event.button & 64) !== 0;
  if (isWheel) {
    if (inside) {
      self.scrollPlanPanel((event.button & 1) === 0 ? -1 : 1);
      return true;
    }
    return false;
  }

  const button = event.button & 3;
  if (event.released || button === 3) {
    const wasDragging = self.planPanelDragMode !== undefined;
    self.planPanelDragMode = undefined;
    return wasDragging;
  }

  const isMotion = (event.button & 32) !== 0;
  if (isMotion) {
    if (!self.planPanelDragMode) return false;
    const width =
      self.planPanelDragMode === "width" || self.planPanelDragMode === "both" ? bounds.right - event.x + 1 : undefined;
    const height =
      self.planPanelDragMode === "height" || self.planPanelDragMode === "both" ? event.y - bounds.top + 1 : undefined;
    self.setPlanPanelSize(width, height);
    return true;
  }

  if (button !== 0 || !inside) return false;
  const onWidthHandle = self.planPanelMode === "compact" && event.x === bounds.left;
  const onHeightHandle = event.y === bounds.bottom;
  self.planPanelDragMode =
    onWidthHandle && onHeightHandle ? "both" : onWidthHandle ? "width" : onHeightHandle ? "height" : undefined;
  return self.planPanelDragMode !== undefined;
}

export function do_syncPlanTracker(self: InteractiveMode): void {
  const state = self.session.getSessionStateSnapshot().state;
  const orderedTree = getOrderedPlanTree(state.plan);
  self.planStatusTracker.steps = orderedTree.map(({ item, depth, isLastChild, active }) => ({
    id: item.id,
    description: item.text,
    status: (item.status === "done" ? "completed" : item.status) || "pending",
    parentId: item.parentId,
    depth,
    isLastChild,
    active,
  }));
  self.planStatusTracker.onUpdate?.();
}

export function do_showStatus(self: InteractiveMode, message: string): void {
  const children = self.chatContainer.children;
  const last = children.length > 0 ? children[children.length - 1] : undefined;
  const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

  if (last && secondLast && last === self.lastStatusText && secondLast === self.lastStatusSpacer) {
    self.lastStatusText.setText(theme.fg("dim", message));
    self.ui.requestRender();
    return;
  }

  const spacer = new Spacer(1);
  const text = new Text(theme.fg("dim", message), 1, 0);
  self.chatContainer.addChild(spacer);
  self.chatContainer.addChild(text);
  self.lastStatusSpacer = spacer;
  self.lastStatusText = text;
  self.ui.requestRender();
}
