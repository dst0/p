import type { Message } from "@dst0/p-ai";
import type { OverlayOptions } from "@dst0/p-tui";
import { getNextPlanPanelMode, parseSgrMouseEvent } from "../../components/plan-panel.ts";
import { MIN_PLAN_PANEL_WIDTH } from "../constants.ts";
import type { InteractiveMode } from "../interactivemode.ts";
import type { PlanPanelBounds } from "../types.ts";

export function do_getUserMessageText(_self: InteractiveMode, message: Message): string {
  if (message.role !== "user") return "";
  const textBlocks =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : message.content.filter((c: { type: string }) => c.type === "text");
  return textBlocks.map((c) => (c as { text: string }).text).join("");
}

export function do_togglePlanPanel(self: InteractiveMode): void {
  self.planPanelMode = getNextPlanPanelMode(self.planPanelMode);
  self.settingsManager.setPlanPanelMode(self.planPanelMode);
  if (self.planPanelMode === "hidden") {
    self.hidePlanPanel();
    return;
  }

  self.planStatusTracker.onUpdate = () => {
    if (self.planPanelMode !== "hidden") {
      self.ui.requestRender();
    }
  };
  self.syncPlanTracker();
  self.showPlanPanelOverlay();
}

export function do_hidePlanPanel(self: InteractiveMode): void {
  self.planPanelHandle?.hide();
  self.planPanelHandle = undefined;
  self.planPanelDragMode = undefined;
  self.planPanelMouseMode = false;
  self.ui.terminal.setMouseTracking?.(false);
  self.ui.requestRender();
}

export function do_showPlanPanelOverlay(self: InteractiveMode): void {
  if (self.planPanelMode === "hidden") return;

  self.planPanelHandle?.hide();
  const expanded = self.planPanelMode === "expanded";
  const maxHeight = self.getPlanPanelMaxHeight();
  const viewportHeight = Math.min(self.planPanelHeight ?? maxHeight, maxHeight);
  self.planPanel.setMode(self.planPanelMode);
  self.planPanel.setViewport(viewportHeight, expanded || self.planPanelHeight !== undefined);
  self.planPanel.setKeyHints({
    toggle: self.getAppKeyDisplay("app.plan.toggle"),
    mouseToggle: self.getAppKeyDisplay("app.plan.mouseToggle"),
    scrollUp: self.getAppKeyDisplay("app.plan.scrollUp"),
    scrollDown: self.getAppKeyDisplay("app.plan.scrollDown"),
    resizeNarrower: self.getAppKeyDisplay("app.plan.resizeNarrower"),
    resizeWider: self.getAppKeyDisplay("app.plan.resizeWider"),
    resizeShorter: self.getAppKeyDisplay("app.plan.resizeShorter"),
    resizeTaller: self.getAppKeyDisplay("app.plan.resizeTaller"),
  });
  self.planPanel.setMouseMode(self.planPanelMouseMode);

  const options: OverlayOptions = expanded
    ? {
        anchor: "top-left",
        width: "100%",
        maxHeight: "66.6667%",
        margin: 0,
        nonCapturing: true,
      }
    : {
        anchor: "top-right",
        width: self.getPlanPanelCompactWidth(),
        maxHeight: "66.6667%",
        margin: 1,
        nonCapturing: true,
      };
  self.planPanelHandle = self.ui.showOverlay(self.planPanel, options);
  self.ui.requestRender();
}

export function do_getPlanPanelMaxHeight(self: InteractiveMode): number {
  return Math.max(1, Math.floor((self.ui.terminal.rows * 2) / 3));
}

export function do_getPlanPanelCompactWidth(self: InteractiveMode): number {
  const maxWidth = Math.max(4, self.ui.terminal.columns - 2);
  const minWidth = Math.min(MIN_PLAN_PANEL_WIDTH, maxWidth);
  return Math.max(minWidth, Math.min(maxWidth, self.planPanelCompactWidth));
}

export function do_getPlanPanelBounds(self: InteractiveMode): PlanPanelBounds {
  const expanded = self.planPanelMode === "expanded";
  const width = expanded ? self.ui.terminal.columns : self.getPlanPanelCompactWidth();
  const right = expanded ? self.ui.terminal.columns : self.ui.terminal.columns - 1;
  const left = Math.max(1, right - width + 1);
  const top = expanded ? 1 : 2;
  const height = Math.max(1, self.planPanel.getRenderedHeight());
  return {
    left,
    right,
    top,
    bottom: top + height - 1,
    width,
    height,
  };
}

export function do_handlePlanPanelInput(self: InteractiveMode, data: string): { consume: boolean } | undefined {
  if (self.planPanelMode === "hidden") return undefined;

  if (self.keybindings.matches(data, "app.plan.mouseToggle")) {
    self.setPlanPanelMouseMode(!self.planPanelMouseMode);
    return { consume: true };
  }
  if (self.planPanelMouseMode && self.keybindings.matches(data, "app.interrupt")) {
    self.setPlanPanelMouseMode(false);
    return { consume: true };
  }

  const mouseEvent = parseSgrMouseEvent(data);
  if (mouseEvent) {
    if (!self.planPanelMouseMode) return undefined;
    const consumed = self.handlePlanPanelMouse(mouseEvent);
    if (consumed) return { consume: true };
    return undefined;
  }

  if (self.keybindings.matches(data, "app.plan.scrollUp")) {
    self.scrollPlanPanel(-1);
    return { consume: true };
  }
  if (self.keybindings.matches(data, "app.plan.scrollDown")) {
    self.scrollPlanPanel(1);
    return { consume: true };
  }
  if (self.keybindings.matches(data, "app.plan.resizeNarrower")) {
    self.resizePlanPanel(-4, 0);
    return { consume: true };
  }
  if (self.keybindings.matches(data, "app.plan.resizeWider")) {
    self.resizePlanPanel(4, 0);
    return { consume: true };
  }
  if (self.keybindings.matches(data, "app.plan.resizeShorter")) {
    self.resizePlanPanel(0, -2);
    return { consume: true };
  }
  if (self.keybindings.matches(data, "app.plan.resizeTaller")) {
    self.resizePlanPanel(0, 2);
    return { consume: true };
  }
  return undefined;
}

export function do_setPlanPanelMouseMode(self: InteractiveMode, active: boolean): void {
  if (self.planPanelMouseMode === active) return;
  self.planPanelMouseMode = active;
  if (!active) self.planPanelDragMode = undefined;
  self.ui.terminal.setMouseTracking?.(active);
  self.planPanel.setMouseMode(active);
  self.ui.requestRender();
}
