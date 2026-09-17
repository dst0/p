import { describe, expect, it } from "vitest";
import {
  formatPlanExecutionContext,
  formatPlanExecutionRequest,
  getPlanModeTools,
  restorePlanModeTools,
  type TodoItem,
} from "../examples/extensions/plan-mode/utils.ts";

describe("plan mode tool preservation", () => {
  it("keeps active tools with declared read-only effects while disabling mutation tools", () => {
    expect(
      getPlanModeTools(
        ["read", "edit", "semantic_search", "write", "custom_review"],
        [
          { name: "read", effect: { kind: "read", risk: "normal" } },
          { name: "edit", effect: { kind: "workspace_write", risk: "normal" } },
          { name: "semantic_search", effect: { kind: "read", risk: "normal" } },
          { name: "write", effect: { kind: "workspace_write", risk: "normal" } },
          { name: "custom_review", effect: { kind: "read", risk: "normal" } },
        ],
      ),
    ).toEqual(["read", "semantic_search", "custom_review"]);
  });

  it("fails closed for unknown and mutating custom tool effects", () => {
    expect(
      getPlanModeTools(
        ["custom_review", "deploy", "delete", "external_write", "unclassified", "missing"],
        [
          { name: "custom_review", effect: { kind: "read", risk: "normal" } },
          { name: "deploy", effect: { kind: "external_write", risk: "high", domains: ["deployment"] } },
          { name: "delete", effect: { kind: "workspace_write", risk: "high", domains: ["destructive"] } },
          { name: "external_write", effect: { kind: "external_write", risk: "normal" } },
          { name: "unclassified", effect: { kind: "unknown", risk: "high" } },
          { name: "missing" },
        ],
      ),
    ).toEqual(["custom_review"]);
  });

  it("allows only the explicitly guarded bash exception when its declared effect is unsafe", () => {
    expect(
      getPlanModeTools(
        ["bash", "process"],
        [
          { name: "bash", effect: { kind: "unknown", risk: "high" } },
          { name: "process", effect: { kind: "external_write", risk: "high" } },
        ],
      ),
    ).toEqual(["bash"]);
  });

  it("restores the original tool set and custom tools registered while planning", () => {
    expect(
      restorePlanModeTools(["read", "edit", "write", "custom_before"], ["read", "custom_before", "custom_during"]),
    ).toEqual(["read", "edit", "write", "custom_before", "custom_during"]);
  });

  it("does not invent mutation tools when no saved tool set exists", () => {
    expect(restorePlanModeTools(null, ["read", "custom_only"])).toEqual(["read", "custom_only"]);
  });
});

describe("plan execution prompts", () => {
  const plan: TodoItem[] = [
    { step: 1, text: "Inspect the baseline", completed: true },
    { step: 2, text: "Implement the fix", completed: false },
    { step: 3, text: "Verify the result", completed: false },
  ];

  it("passes the full roadmap into the execution request", () => {
    const request = formatPlanExecutionRequest(plan);
    expect(request).toContain("1. Inspect the baseline");
    expect(request).toContain("2. Implement the fix");
    expect(request).toContain("3. Verify the result");
    expect(request).toContain("Start with step 1");
  });

  it("keeps already completed steps out of the per-turn execution context", () => {
    const context = formatPlanExecutionContext(plan);
    expect(context).not.toContain("1. Inspect the baseline");
    expect(context).toContain("2. Implement the fix");
    expect(context).toContain("3. Verify the result");
  });
});
