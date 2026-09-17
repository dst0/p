import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionContextActions } from "../src/core/extensions/types.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("extension budget context", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "extension-budget-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("isolates the read-only snapshot from the current task budget", () => {
    const modelRegistry = ModelRegistry.create(AuthStorage.create(join(tempDir, "auth.json")));
    const runner = new ExtensionRunner([], createExtensionRuntime(), tempDir, SessionManager.inMemory(), modelRegistry);
    const policy = { mode: "limited" as const, unit: "tokens" as const, limit: 500 };
    runner.bindCore({} as ExtensionActions, {
      getModel: () => undefined,
      getRunBudgetPolicy: () => policy,
      isIdle: () => true,
      isProjectTrusted: () => true,
      getSignal: () => undefined,
      abort: () => {},
      hasPendingMessages: () => false,
      shutdown: () => {},
      getContextUsage: () => undefined,
      compact: () => {},
      getSystemPrompt: () => "",
    } satisfies ExtensionContextActions);

    const snapshot = runner.createContext().runBudgetPolicy;
    expect(snapshot).toEqual(policy);
    (snapshot as { limit: number }).limit = 1;
    expect(runner.createContext().runBudgetPolicy).toEqual(policy);
  });

  it("returns no model until the host binds one", () => {
    const modelRegistry = ModelRegistry.create(AuthStorage.create(join(tempDir, "auth.json")));
    const runner = new ExtensionRunner([], createExtensionRuntime(), tempDir, SessionManager.inMemory(), modelRegistry);

    expect(runner.getModel()).toBeUndefined();
    expect(() => runner.getRunBudgetPolicyFn()).toThrow("not bound to a task budget");
  });
});
