import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitModelCall, getModel } from "@dst0/p-ai";
import { describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("SDK resource initialization budget", () => {
  it("has model-call admission active while the SDK loads its default resources", async () => {
    const root = mkdtempSync(join(tmpdir(), "p-budget-sdk-init-"));
    const authStorage = AuthStorage.inMemory();
    const model = getModel("openai", "gpt-4o-mini");
    let admitted = false;
    const reload = vi.spyOn(DefaultResourceLoader.prototype, "reload").mockImplementation(async () => {
      const receipt = admitModelCall({ kind: "text", model });
      admitted = receipt !== undefined;
      receipt?.settle(undefined);
    });
    try {
      const { session } = await createAgentSession({
        cwd: root,
        agentDir: join(root, ".agent"),
        authStorage,
        modelRegistry: ModelRegistry.inMemory(authStorage),
        model,
        settingsManager: SettingsManager.inMemory(),
        sessionManager: SessionManager.inMemory(root),
        projectInstructionMode: "off",
        taskVerificationMode: "off",
        runBudget: { mode: "limited", unit: "requests", limit: 1 },
      });
      try {
        expect(admitted).toBe(true);
        expect(session.runBudget.snapshot()).toMatchObject({ requests: 1, status: "exhausted" });
      } finally {
        session.dispose();
      }
    } finally {
      reload.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
