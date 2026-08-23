import { getApiProvider } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { createUIRegressionHarness } from "./helpers/ui-visual-snapshot-harness.ts";

describe("InteractiveMode E2E Terminal Visual Regression Suite", () => {
  it("renders correct initial startup viewport and editor box", async () => {
    const ui = await createUIRegressionHarness({ width: 80, height: 24 });
    try {
      await ui.flush();
      const viewport = ui.getViewport();

      expect(viewport.length).toBe(24);
      expect(viewport.some((line) => line.includes("p v"))).toBe(true);

      await ui.assertSnapshot("01-startup-viewport");
    } finally {
      ui.cleanup();
    }
  });

  it("renders typed text and slash-commands in editor input box", async () => {
    const ui = await createUIRegressionHarness({ width: 80, height: 24 });
    try {
      await ui.typeText("/model");
      const viewport = ui.getViewport();

      expect(viewport.some((line) => line.includes("/model"))).toBe(true);

      await ui.assertSnapshot("02-typed-command-viewport");
    } finally {
      ui.cleanup();
    }
  });

  it("renders user prompt in chat container and streams assistant response", async () => {
    const ui = await createUIRegressionHarness({ width: 80, height: 24, completionMode: "implicit" });
    try {
      expect(getApiProvider(ui.harness.getModel().api)).toBeDefined();
      ui.harness.setResponses([
        {
          role: "assistant",
          api: "faux" as any,
          provider: "faux",
          model: "faux-1",
          usage: {
            input: 10,
            output: 10,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 20,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          content: [{ type: "text", text: "Hello! I am ready to assist." }],
          stopReason: "stop",
          timestamp: Date.now(),
        },
      ]);

      await ui.harness.session.prompt("Hello agent");
      await ui.flush();

      const viewport = ui.getViewport();
      expect(viewport.some((line) => line.includes("Hello agent") || line.includes("Hello! I am ready"))).toBe(true);

      await ui.assertSnapshot("03-prompt-and-completion-viewport");
    } finally {
      ui.cleanup();
    }
  });

  it("renders modal selector dialog on /settings command submission", async () => {
    const ui = await createUIRegressionHarness({ width: 80, height: 24 });
    try {
      (ui.mode as any).showSettingsSelector();
      await ui.flush();

      const viewport = ui.getViewport();
      expect(viewport.some((line) => line.trim().length > 0)).toBe(true);

      await ui.assertSnapshot("04-modal-selector-viewport");
    } finally {
      ui.cleanup();
    }
  });
});
