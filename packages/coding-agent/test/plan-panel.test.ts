import { visibleWidth } from "@dst0/p-tui";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getNextPlanPanelMode,
  PlanPanel,
  PlanStatusTracker,
  parseSgrMouseEvent,
} from "../src/modes/interactive/components/plan-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("PlanPanel", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  it("cycles F2 state through compact, expanded, and hidden", () => {
    expect(getNextPlanPanelMode("hidden")).toBe("compact");
    expect(getNextPlanPanelMode("compact")).toBe("expanded");
    expect(getNextPlanPanelMode("expanded")).toBe("hidden");
  });

  it("renders flat roots and nested tasks as a connected tree", () => {
    const tracker = new PlanStatusTracker();
    tracker.steps = [
      {
        id: "root-a",
        description: "Root A",
        status: "in_progress",
        depth: 0,
        isLastChild: false,
      },
      {
        id: "child-a1",
        parentId: "root-a",
        description: "Child A1",
        status: "in_progress",
        depth: 1,
        isLastChild: false,
      },
      {
        id: "grandchild-a1",
        parentId: "child-a1",
        description: "Grandchild A1",
        status: "in_progress",
        depth: 2,
        isLastChild: true,
        active: true,
      },
      {
        id: "child-a2",
        parentId: "root-a",
        description: "Child A2",
        status: "not_started",
        depth: 1,
        isLastChild: true,
      },
      {
        id: "root-b",
        description: "Root B",
        status: "not_started",
        depth: 0,
        isLastChild: true,
      },
    ];

    const rendered = new PlanPanel(tracker).render(80).map(stripAnsi);

    expect(rendered.find((line) => line.includes("Root A"))).toContain("├─");
    expect(rendered.find((line) => line.includes("Child A1"))).toContain("│  ├─");
    expect(rendered.find((line) => line.includes("Grandchild A1"))).toContain("│  │  └─");
    expect(rendered.find((line) => line.includes("Grandchild A1"))).toContain("👈");
    expect(rendered.find((line) => line.includes("Child A2"))).toContain("│  └─");
    expect(rendered.find((line) => line.includes("Root B"))).toContain("└─");
    expect(rendered.find((line) => line.includes("Root A"))).not.toContain("👈");
    expect(rendered.find((line) => line.includes("Child A1"))).not.toContain("👈");
  });

  it("keeps the frame fixed while scrolling overflowing content", () => {
    const tracker = new PlanStatusTracker();
    tracker.steps = Array.from({ length: 10 }, (_, index) => ({
      id: `step-${index + 1}`,
      description: `Step ${index + 1}`,
      status: "not_started" as const,
      depth: 0,
      isLastChild: index === 9,
    }));

    const panel = new PlanPanel(tracker);
    panel.setViewport(10, false);

    const initial = panel.render(60).map(stripAnsi);
    expect(initial).toHaveLength(10);
    expect(initial[0]).toContain("Steps Complete");
    expect(initial.at(-1)).toContain("╰");
    expect(initial.join("\n")).toContain("Step 1");
    expect(initial.join("\n")).not.toContain("Step 10");

    expect(panel.scrollBy(3)).toBe(true);
    const scrolled = panel.render(60).map(stripAnsi);
    expect(scrolled).toHaveLength(10);
    expect(scrolled.join("\n")).not.toContain("Step 1");
    expect(scrolled.join("\n")).toContain("Step 4");
    expect(scrolled.join("\n")).toContain("↑3");

    expect(panel.render(60).map(visibleWidth)).toEqual(Array.from({ length: 10 }, () => 60));
  });

  it("fills the expanded viewport without exceeding its configured height", () => {
    const tracker = new PlanStatusTracker();
    tracker.addStep({
      id: "only-step",
      description: "Only step",
      status: "in_progress",
      active: true,
    });
    const panel = new PlanPanel(tracker);
    panel.setMode("expanded");
    panel.setViewport(12, true);

    expect(panel.render(80)).toHaveLength(12);
    expect(panel.getRenderedHeight()).toBe(12);
  });

  it("parses SGR mouse press, drag, wheel, and release events", () => {
    expect(parseSgrMouseEvent("\x1b[<0;12;7M")).toEqual({
      button: 0,
      x: 12,
      y: 7,
      released: false,
    });
    expect(parseSgrMouseEvent("\x1b[<32;20;9M")?.button).toBe(32);
    expect(parseSgrMouseEvent("\x1b[<65;20;9M")?.button).toBe(65);
    expect(parseSgrMouseEvent("\x1b[<0;20;9m")?.released).toBe(true);
    expect(parseSgrMouseEvent("not a mouse event")).toBeUndefined();
  });
});
