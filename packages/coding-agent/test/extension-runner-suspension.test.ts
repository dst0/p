import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("ExtensionRunner suspension", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "extension-runner-suspension-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createRunner() {
    const runtime = createExtensionRuntime();
    const registry = ModelRegistry.create(AuthStorage.create(join(tempDir, "auth.json")));
    const runner = new ExtensionRunner([], runtime, tempDir, SessionManager.inMemory(), registry);
    return { runner, runtime };
  }

  it("blocks captured contexts reversibly while preserving permanent invalidation", () => {
    const { runner, runtime } = createRunner();
    const context = runner.createContext();

    runner.suspend("replacement pending");
    expect(() => context.sessionManager.getSessionFile()).toThrow("replacement pending");
    expect(() => runtime.assertActive()).toThrow("replacement pending");

    runner.resume();
    expect(() => context.sessionManager.getSessionFile()).not.toThrow();
    expect(() => runtime.assertActive()).not.toThrow();

    runner.suspend("replacement pending");
    runner.invalidate("permanently stale");
    runner.resume();
    expect(() => context.sessionManager.getSessionFile()).toThrow("permanently stale");
    expect(() => runtime.assertActive()).toThrow("permanently stale");
  });
});
