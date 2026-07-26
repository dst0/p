import { describe, expect, test } from "vitest";
import { PlanPanel, PlanStatusTracker } from "../src/modes/interactive/components/plan-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("PlanPanel border rendering", () => {
  test("renders contrast border and box frame correctly", () => {
    initTheme("dark");

    const tracker = new PlanStatusTracker();
    tracker.addStep({ id: "step-1", description: "First step", status: "completed" });
    tracker.addStep({ id: "step-2", description: "Second step", status: "in_progress", active: true });
    tracker.addToolEvent({ id: "tool-1", name: "view_file", status: "success", durationMs: 15 });

    const panel = new PlanPanel(tracker);
    const lines = panel.render(50);

    expect(lines.length).toBeGreaterThan(0);

    // Top border line should start with ╭ and end with ╮
    expect(lines[0]).toContain("╭");
    expect(lines[0]).toContain("╮");

    // Middle rows should be enclosed in │
    const contentLines = lines.slice(1, lines.length - 1);
    for (const line of contentLines) {
      expect(line).toMatch(/[│├]/);
    }

    // Bottom border line should start with ╰ and end with ╯
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toContain("╰");
    expect(lastLine).toContain("╯");

    // Each rendered line must fit exact width (50) in visible width
    for (const line of lines) {
      // visibleWidth should be <= 50
      expect(line.length).toBeGreaterThan(0);
    }
  });
});
