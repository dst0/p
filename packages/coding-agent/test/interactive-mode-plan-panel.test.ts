import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type PlanPanelMode = "hidden" | "compact" | "expanded";

interface PlanPanelBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface SgrMouseEvent {
  button: number;
  x: number;
  y: number;
  released: boolean;
}

const togglePlanPanel = Reflect.get(InteractiveMode.prototype, "togglePlanPanel") as (this: {
  planPanelMode: PlanPanelMode;
  planPanelMouseMode: boolean;
  hidePlanPanel(): void;
  planStatusTracker: { onUpdate?: () => void };
  settingsManager: { setPlanPanelMode(mode: PlanPanelMode): void };
  syncPlanTracker(): void;
  ui: {
    requestRender(): void;
    terminal: { setMouseTracking?(active: boolean): void };
  };
  showPlanPanelOverlay(): void;
}) => void;

const hidePlanPanel = Reflect.get(InteractiveMode.prototype, "hidePlanPanel") as (this: {
  planPanelHandle?: { hide(): void };
  planPanelDragMode?: "width" | "height" | "both";
  planPanelMouseMode: boolean;
  ui: {
    requestRender(): void;
    terminal: { setMouseTracking?(active: boolean): void };
  };
}) => void;

const showPlanPanelOverlay = Reflect.get(InteractiveMode.prototype, "showPlanPanelOverlay") as (this: {
  planPanelMode: PlanPanelMode;
  planPanelMouseMode: boolean;
  planPanelHandle?: { hide(): void };
  planPanelHeight?: number;
  getPlanPanelMaxHeight(): number;
  getPlanPanelCompactWidth(): number;
  getAppKeyDisplay(action: string): string;
  planPanel: {
    setMode(mode: "compact" | "expanded"): void;
    setViewport(height: number, fill: boolean): void;
    setKeyHints(hints: Record<string, string>): void;
    setMouseMode(active: boolean): void;
  };
  ui: {
    requestRender(): void;
    showOverlay(
      panel: unknown,
      options: {
        anchor: string;
        width: number | string;
        maxHeight: string;
        margin: number;
        nonCapturing: boolean;
      },
    ): { hide(): void };
  };
}) => void;

const getPlanPanelMaxHeight = Reflect.get(InteractiveMode.prototype, "getPlanPanelMaxHeight") as (this: {
  ui: { terminal: { rows: number } };
}) => number;

const getPlanPanelCompactWidth = Reflect.get(InteractiveMode.prototype, "getPlanPanelCompactWidth") as (this: {
  planPanelCompactWidth: number;
  ui: { terminal: { columns: number } };
}) => number;

const getPlanPanelBounds = Reflect.get(InteractiveMode.prototype, "getPlanPanelBounds") as (this: {
  planPanelMode: PlanPanelMode;
  getPlanPanelCompactWidth(): number;
  planPanel: { getRenderedHeight(): number };
  ui: { terminal: { columns: number } };
}) => PlanPanelBounds;

const handlePlanPanelInput = Reflect.get(InteractiveMode.prototype, "handlePlanPanelInput") as (
  this: {
    planPanelMode: PlanPanelMode;
    planPanelMouseMode: boolean;
    handlePlanPanelMouse(event: SgrMouseEvent): boolean;
    keybindings: { matches(data: string, action: string): boolean };
    resizePlanPanel(widthDelta: number, heightDelta: number): void;
    scrollPlanPanel(direction: -1 | 1): void;
    setPlanPanelMouseMode(active: boolean): void;
  },
  data: string,
) => { consume: boolean } | undefined;

const scrollPlanPanel = Reflect.get(InteractiveMode.prototype, "scrollPlanPanel") as (
  this: {
    planPanel: { scrollBy(delta: number): boolean };
    ui: { requestRender(): void };
  },
  direction: -1 | 1,
) => void;

const resizePlanPanel = Reflect.get(InteractiveMode.prototype, "resizePlanPanel") as (
  this: {
    getPlanPanelBounds(): PlanPanelBounds;
    planPanelHeight?: number;
    setPlanPanelSize(width: number | undefined, height: number | undefined): void;
  },
  widthDelta: number,
  heightDelta: number,
) => void;

const setPlanPanelSize = Reflect.get(InteractiveMode.prototype, "setPlanPanelSize") as (
  this: {
    planPanelMode: PlanPanelMode;
    planPanelCompactWidth: number;
    planPanelHeight?: number;
    getPlanPanelMaxHeight(): number;
    settingsManager: {
      setPlanPanelCompactWidth(width: number): void;
      setPlanPanelHeight(height: number): void;
    };
    showPlanPanelOverlay(): void;
    ui: { terminal: { columns: number } };
  },
  width: number | undefined,
  height: number | undefined,
) => void;

const handlePlanPanelMouse = Reflect.get(InteractiveMode.prototype, "handlePlanPanelMouse") as (
  this: {
    planPanelMode: PlanPanelMode;
    planPanelDragMode?: "width" | "height" | "both";
    getPlanPanelBounds(): PlanPanelBounds;
    scrollPlanPanel(direction: -1 | 1): void;
    setPlanPanelSize(width: number | undefined, height: number | undefined): void;
  },
  event: SgrMouseEvent,
) => boolean;

const setPlanPanelMouseMode = Reflect.get(InteractiveMode.prototype, "setPlanPanelMouseMode") as (
  this: {
    planPanelDragMode?: "width" | "height" | "both";
    planPanelMouseMode: boolean;
    planPanel: { setMouseMode(active: boolean): void };
    ui: {
      requestRender(): void;
      terminal: { setMouseTracking?(active: boolean): void };
    };
  },
  active: boolean,
) => void;

const stop = Reflect.get(InteractiveMode.prototype, "stop") as (this: {
  settingsManager: { getShowTerminalProgress(): boolean };
  ui: {
    terminal: {
      setProgress(active: boolean): void;
      setMouseTracking?(active: boolean): void;
    };
    stop(): void;
  };
  planPanelInputUnsubscribe?: () => void;
  queuedFooterSpinnerTimer?: ReturnType<typeof setInterval>;
  loadingAnimation?: { stop(): void };
  clearExtensionTerminalInputListeners(): void;
  footer: { dispose(): void };
  footerDataProvider: { dispose(): void };
  unsubscribe?: () => void;
  isInitialized: boolean;
  unregisterSignalHandlers(): void;
}) => void;

describe("InteractiveMode plan panel", () => {
  it("cycles the panel and manages mouse tracking", () => {
    const requestRender = vi.fn();
    const hide = vi.fn();
    const context = {
      planPanelMode: "hidden" as PlanPanelMode,
      planPanelMouseMode: false,
      hidePlanPanel: hide,
      planStatusTracker: { onUpdate: undefined as (() => void) | undefined },
      settingsManager: { setPlanPanelMode: vi.fn() },
      syncPlanTracker: vi.fn(),
      ui: {
        requestRender,
        terminal: { setMouseTracking: vi.fn() },
      },
      showPlanPanelOverlay: vi.fn(),
    };

    togglePlanPanel.call(context);
    expect(context.planPanelMode).toBe("compact");
    expect(context.settingsManager.setPlanPanelMode).toHaveBeenLastCalledWith("compact");
    expect(context.ui.terminal.setMouseTracking).not.toHaveBeenCalledWith(true);
    context.planStatusTracker.onUpdate?.();
    expect(requestRender).toHaveBeenCalledOnce();

    togglePlanPanel.call(context);
    expect(context.planPanelMode).toBe("expanded");
    togglePlanPanel.call(context);
    expect(context.planPanelMode).toBe("hidden");
    expect(hide).toHaveBeenCalledOnce();

    const handle = { hide: vi.fn() };
    const hideContext = {
      planPanelHandle: handle as { hide(): void } | undefined,
      planPanelDragMode: "both" as "width" | "height" | "both" | undefined,
      planPanelMouseMode: true,
      ui: {
        requestRender: vi.fn(),
        terminal: { setMouseTracking: vi.fn() },
      },
    };
    hidePlanPanel.call(hideContext);
    expect(handle.hide).toHaveBeenCalledOnce();
    expect(hideContext.planPanelHandle).toBeUndefined();
    expect(hideContext.planPanelDragMode).toBeUndefined();
    expect(hideContext.planPanelMouseMode).toBe(false);
    expect(hideContext.ui.terminal.setMouseTracking).toHaveBeenCalledWith(false);
  });

  it("renders compact and expanded overlays with bounded geometry", () => {
    const priorHandle = { hide: vi.fn() };
    const nextHandle = { hide: vi.fn() };
    const planPanel = {
      setMode: vi.fn(),
      setViewport: vi.fn(),
      setKeyHints: vi.fn(),
      setMouseMode: vi.fn(),
    };
    const showOverlay = vi.fn(() => nextHandle);
    const context = {
      planPanelMode: "hidden" as PlanPanelMode,
      planPanelMouseMode: false,
      planPanelHandle: priorHandle as { hide(): void } | undefined,
      planPanelHeight: undefined as number | undefined,
      getPlanPanelMaxHeight: () => 20,
      getPlanPanelCompactWidth: () => 50,
      getAppKeyDisplay: (action: string) => action,
      planPanel,
      ui: {
        requestRender: vi.fn(),
        showOverlay,
      },
    };

    showPlanPanelOverlay.call(context);
    expect(showOverlay).not.toHaveBeenCalled();

    context.planPanelMode = "compact";
    showPlanPanelOverlay.call(context);
    expect(priorHandle.hide).toHaveBeenCalledOnce();
    expect(planPanel.setViewport).toHaveBeenLastCalledWith(20, false);
    expect(planPanel.setMouseMode).toHaveBeenLastCalledWith(false);
    expect(showOverlay).toHaveBeenLastCalledWith(
      planPanel,
      expect.objectContaining({ anchor: "top-right", width: 50, margin: 1 }),
    );

    context.planPanelMode = "expanded";
    context.planPanelHeight = 12;
    showPlanPanelOverlay.call(context);
    expect(planPanel.setViewport).toHaveBeenLastCalledWith(12, true);
    expect(showOverlay).toHaveBeenLastCalledWith(
      planPanel,
      expect.objectContaining({ anchor: "top-left", width: "100%", margin: 0 }),
    );

    expect(getPlanPanelMaxHeight.call({ ui: { terminal: { rows: 30 } } })).toBe(20);
    expect(
      getPlanPanelCompactWidth.call({
        planPanelCompactWidth: 50,
        ui: { terminal: { columns: 100 } },
      }),
    ).toBe(50);
    expect(
      getPlanPanelCompactWidth.call({
        planPanelCompactWidth: 50,
        ui: { terminal: { columns: 20 } },
      }),
    ).toBe(18);

    const boundsContext = {
      planPanelMode: "compact" as PlanPanelMode,
      getPlanPanelCompactWidth: () => 50,
      planPanel: { getRenderedHeight: () => 12 },
      ui: { terminal: { columns: 100 } },
    };
    expect(getPlanPanelBounds.call(boundsContext)).toEqual({
      left: 50,
      right: 99,
      top: 2,
      bottom: 13,
      width: 50,
      height: 12,
    });
    boundsContext.planPanelMode = "expanded";
    expect(getPlanPanelBounds.call(boundsContext)).toEqual({
      left: 1,
      right: 100,
      top: 1,
      bottom: 12,
      width: 100,
      height: 12,
    });
  });

  it("routes keyboard and mouse input to plan operations", () => {
    const scroll = vi.fn();
    const resize = vi.fn();
    const mouse = vi.fn().mockReturnValue(false);
    const context = {
      planPanelMode: "hidden" as PlanPanelMode,
      planPanelMouseMode: false,
      handlePlanPanelMouse: mouse,
      keybindings: {
        matches: (data: string, action: string) => data === action,
      },
      resizePlanPanel: resize,
      scrollPlanPanel: scroll,
      setPlanPanelMouseMode: vi.fn(),
    };

    expect(handlePlanPanelInput.call(context, "app.plan.scrollUp")).toBeUndefined();
    context.planPanelMode = "compact";

    expect(handlePlanPanelInput.call(context, "app.plan.mouseToggle")).toEqual({ consume: true });
    expect(context.setPlanPanelMouseMode).toHaveBeenLastCalledWith(true);

    expect(handlePlanPanelInput.call(context, "\x1b[<0;12;7M")).toBeUndefined();
    expect(mouse).not.toHaveBeenCalled();

    context.planPanelMouseMode = true;
    mouse.mockReturnValue(true);
    expect(handlePlanPanelInput.call(context, "\x1b[<0;50;5M")).toEqual({ consume: true });
    expect(mouse).toHaveBeenCalledOnce();

    expect(handlePlanPanelInput.call(context, "app.interrupt")).toEqual({ consume: true });
    expect(context.setPlanPanelMouseMode).toHaveBeenLastCalledWith(false);

    mouse.mockReturnValue(false);

    const actions = [
      ["app.plan.scrollUp", [-1]],
      ["app.plan.scrollDown", [1]],
      ["app.plan.resizeNarrower", [-4, 0]],
      ["app.plan.resizeWider", [4, 0]],
      ["app.plan.resizeShorter", [0, -2]],
      ["app.plan.resizeTaller", [0, 2]],
    ] as const;
    for (const [action, args] of actions) {
      expect(handlePlanPanelInput.call(context, action)).toEqual({ consume: true });
      if (action.includes("scroll")) expect(scroll).toHaveBeenLastCalledWith(...args);
      else expect(resize).toHaveBeenLastCalledWith(...args);
    }
    expect(handlePlanPanelInput.call(context, "unmatched")).toBeUndefined();
  });

  it("enables mouse tracking only while plan panel mouse mode is active", () => {
    const context = {
      planPanelDragMode: "width" as "width" | "height" | "both" | undefined,
      planPanelMouseMode: false,
      planPanel: { setMouseMode: vi.fn() },
      ui: {
        requestRender: vi.fn(),
        terminal: { setMouseTracking: vi.fn() },
      },
    };

    setPlanPanelMouseMode.call(context, true);
    expect(context.planPanelMouseMode).toBe(true);
    expect(context.ui.terminal.setMouseTracking).toHaveBeenLastCalledWith(true);
    expect(context.planPanel.setMouseMode).toHaveBeenLastCalledWith(true);

    setPlanPanelMouseMode.call(context, false);
    expect(context.planPanelMouseMode).toBe(false);
    expect(context.planPanelDragMode).toBeUndefined();
    expect(context.ui.terminal.setMouseTracking).toHaveBeenLastCalledWith(false);
    expect(context.planPanel.setMouseMode).toHaveBeenLastCalledWith(false);
    expect(context.ui.requestRender).toHaveBeenCalledTimes(2);

    setPlanPanelMouseMode.call(context, false);
    expect(context.ui.terminal.setMouseTracking).toHaveBeenCalledTimes(2);
  });

  it("scrolls and clamps keyboard resizing", () => {
    const requestRender = vi.fn();
    const scrollBy = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const scrollContext = { planPanel: { scrollBy }, ui: { requestRender } };
    scrollPlanPanel.call(scrollContext, 1);
    scrollPlanPanel.call(scrollContext, -1);
    expect(scrollBy).toHaveBeenNthCalledWith(1, 3);
    expect(scrollBy).toHaveBeenNthCalledWith(2, -3);
    expect(requestRender).toHaveBeenCalledOnce();

    const bounds: PlanPanelBounds = {
      left: 50,
      right: 99,
      top: 2,
      bottom: 11,
      width: 50,
      height: 10,
    };
    const setSize = vi.fn();
    const resizeContext = {
      getPlanPanelBounds: () => bounds,
      planPanelHeight: undefined as number | undefined,
      setPlanPanelSize: setSize,
    };
    resizePlanPanel.call(resizeContext, -4, 0);
    resizePlanPanel.call(resizeContext, 0, 2);
    resizeContext.planPanelHeight = 15;
    resizePlanPanel.call(resizeContext, 0, -2);
    expect(setSize).toHaveBeenNthCalledWith(1, 46, undefined);
    expect(setSize).toHaveBeenNthCalledWith(2, undefined, 12);
    expect(setSize).toHaveBeenNthCalledWith(3, undefined, 13);

    const overlay = vi.fn();
    const sizeContext = {
      planPanelMode: "compact" as PlanPanelMode,
      planPanelCompactWidth: 50,
      planPanelHeight: undefined as number | undefined,
      getPlanPanelMaxHeight: () => 20,
      settingsManager: {
        setPlanPanelCompactWidth: vi.fn(),
        setPlanPanelHeight: vi.fn(),
      },
      showPlanPanelOverlay: overlay,
      ui: { terminal: { columns: 100 } },
    };
    setPlanPanelSize.call(sizeContext, 60, 12);
    expect(sizeContext.planPanelCompactWidth).toBe(60);
    expect(sizeContext.planPanelHeight).toBe(12);
    expect(sizeContext.settingsManager.setPlanPanelCompactWidth).toHaveBeenLastCalledWith(60);
    expect(sizeContext.settingsManager.setPlanPanelHeight).toHaveBeenLastCalledWith(12);
    expect(overlay).toHaveBeenCalledOnce();

    setPlanPanelSize.call(sizeContext, 60, 12);
    expect(overlay).toHaveBeenCalledOnce();
    setPlanPanelSize.call(sizeContext, 1_000, 1_000);
    expect(sizeContext.planPanelCompactWidth).toBe(98);
    expect(sizeContext.planPanelHeight).toBe(20);

    sizeContext.planPanelMode = "expanded";
    setPlanPanelSize.call(sizeContext, 40, 20);
    expect(sizeContext.planPanelCompactWidth).toBe(98);
  });

  it("handles wheel and border drag mouse gestures", () => {
    const bounds: PlanPanelBounds = {
      left: 50,
      right: 99,
      top: 2,
      bottom: 11,
      width: 50,
      height: 10,
    };
    const scroll = vi.fn();
    const setSize = vi.fn();
    const context = {
      planPanelMode: "compact" as PlanPanelMode,
      planPanelDragMode: undefined as "width" | "height" | "both" | undefined,
      getPlanPanelBounds: () => bounds,
      scrollPlanPanel: scroll,
      setPlanPanelSize: setSize,
    };
    const event = (button: number, x: number, y: number, released = false): SgrMouseEvent => ({
      button,
      x,
      y,
      released,
    });

    expect(handlePlanPanelMouse.call(context, event(64, 60, 5))).toBe(true);
    expect(handlePlanPanelMouse.call(context, event(65, 60, 5))).toBe(true);
    expect(handlePlanPanelMouse.call(context, event(64, 1, 1))).toBe(false);
    expect(scroll.mock.calls).toEqual([[-1], [1]]);

    context.planPanelDragMode = "both";
    expect(handlePlanPanelMouse.call(context, event(0, 60, 5, true))).toBe(true);
    expect(context.planPanelDragMode).toBeUndefined();
    expect(handlePlanPanelMouse.call(context, event(3, 60, 5))).toBe(false);

    expect(handlePlanPanelMouse.call(context, event(32, 70, 8))).toBe(false);
    expect(setSize).not.toHaveBeenCalled();
    context.planPanelDragMode = "width";
    expect(handlePlanPanelMouse.call(context, event(32, 70, 8))).toBe(true);
    expect(setSize).toHaveBeenLastCalledWith(30, undefined);
    context.planPanelDragMode = "height";
    expect(handlePlanPanelMouse.call(context, event(32, 70, 8))).toBe(true);
    expect(setSize).toHaveBeenLastCalledWith(undefined, 7);
    context.planPanelDragMode = "both";
    expect(handlePlanPanelMouse.call(context, event(32, 70, 8))).toBe(true);
    expect(setSize).toHaveBeenLastCalledWith(30, 7);

    expect(handlePlanPanelMouse.call(context, event(1, 60, 5))).toBe(false);
    expect(handlePlanPanelMouse.call(context, event(0, 1, 1))).toBe(false);
    expect(handlePlanPanelMouse.call(context, event(0, 50, 11))).toBe(true);
    expect(context.planPanelDragMode).toBe("both");
    expect(handlePlanPanelMouse.call(context, event(0, 50, 5))).toBe(true);
    expect(context.planPanelDragMode).toBe("width");
    expect(handlePlanPanelMouse.call(context, event(0, 70, 11))).toBe(true);
    expect(context.planPanelDragMode).toBe("height");
    expect(handlePlanPanelMouse.call(context, event(0, 70, 5))).toBe(false);
    expect(context.planPanelDragMode).toBeUndefined();
    expect(handlePlanPanelMouse.call(context, event(0, 70, 5, true))).toBe(false);
  });

  it("disables plan mouse handling during shutdown", () => {
    const unsubscribe = vi.fn();
    const context = {
      settingsManager: { getShowTerminalProgress: () => true },
      ui: {
        terminal: {
          setProgress: vi.fn(),
          setMouseTracking: vi.fn(),
        },
        stop: vi.fn(),
      },
      planPanelInputUnsubscribe: unsubscribe as (() => void) | undefined,
      queuedFooterSpinnerTimer: undefined,
      loadingAnimation: undefined,
      clearExtensionTerminalInputListeners: vi.fn(),
      footer: { dispose: vi.fn() },
      footerDataProvider: { dispose: vi.fn() },
      unsubscribe: vi.fn(),
      isInitialized: true,
      unregisterSignalHandlers: vi.fn(),
    };

    stop.call(context);
    expect(context.ui.terminal.setMouseTracking).toHaveBeenCalledWith(false);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(context.planPanelInputUnsubscribe).toBeUndefined();
    expect(context.ui.stop).toHaveBeenCalledOnce();
    expect(context.isInitialized).toBe(false);
  });
});
