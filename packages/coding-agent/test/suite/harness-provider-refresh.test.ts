import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, getApiProvider, getApiProviders } from "@dst0/p-ai";
import { describe, expect, it, vi } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getAssistantTexts, type Harness } from "./harness.ts";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  if (!resolve) throw new Error("Deferred resolver was not initialized");
  return { promise, resolve };
}

async function exerciseRefreshAndCleanup(cleanupFirst: "first" | "second"): Promise<void> {
  const first = await createHarness({ completionMode: "implicit" });
  const second = await createHarness({ completionMode: "implicit" });
  const harnesses: Record<"first" | "second", Harness> = { first, second };
  const cleanupSecond = cleanupFirst === "first" ? "second" : "first";
  let firstCleaned = false;
  let secondCleaned = false;

  try {
    expect(first.faux.api).not.toBe(second.faux.api);

    first.session.modelRegistry.refresh();
    expect(getApiProvider(first.faux.api)).toBeDefined();
    expect(getApiProvider(second.faux.api)).toBeDefined();
    second.setResponses([fauxAssistantMessage("second after first refresh")]);
    await second.session.prompt("second prompt");

    second.session.modelRegistry.refresh();
    expect(getApiProvider(first.faux.api)).toBeDefined();
    expect(getApiProvider(second.faux.api)).toBeDefined();
    first.setResponses([fauxAssistantMessage("first after second refresh")]);
    await first.session.prompt("first prompt");

    await first.session.reload();
    expect(getApiProvider(first.faux.api)).toBeDefined();
    expect(getApiProvider(second.faux.api)).toBeDefined();
    second.setResponses([fauxAssistantMessage("second after first reload")]);
    await second.session.prompt("second reload prompt");

    await second.session.reload();
    expect(getApiProvider(first.faux.api)).toBeDefined();
    expect(getApiProvider(second.faux.api)).toBeDefined();
    first.setResponses([fauxAssistantMessage("first after second reload")]);
    await first.session.prompt("first reload prompt");

    expect(getAssistantTexts(first)).toEqual(["first after second refresh", "first after second reload"]);
    expect(getAssistantTexts(second)).toEqual(["second after first refresh", "second after first reload"]);

    if (cleanupFirst === "first") firstCleaned = true;
    else secondCleaned = true;
    harnesses[cleanupFirst].cleanup();

    harnesses[cleanupSecond].session.modelRegistry.refresh();
    expect(getApiProvider(harnesses[cleanupSecond].faux.api)).toBeDefined();
    harnesses[cleanupSecond].setResponses([fauxAssistantMessage("survivor response")]);
    await harnesses[cleanupSecond].session.prompt("survivor prompt");

    expect(getAssistantTexts(harnesses[cleanupSecond])).toContain("survivor response");
  } finally {
    if (!secondCleaned) second.cleanup();
    if (!firstCleaned) first.cleanup();
  }
}

describe("test harness provider refresh lifecycle", () => {
  it("keeps every live faux provider across alternating refreshes and either cleanup order", async () => {
    await exerciseRefreshAndCleanup("first");
    await exerciseRefreshAndCleanup("second");
  });

  it("keeps sibling providers usable throughout an asynchronous reload", async () => {
    const reloadStarted = createDeferred();
    const releaseReload = createDeferred();
    const resourceLoader = createTestResourceLoader();
    resourceLoader.reload = async () => {
      reloadStarted.resolve();
      await releaseReload.promise;
    };
    const first = await createHarness({ completionMode: "implicit", resourceLoader });
    const second = await createHarness({ completionMode: "implicit" });
    const reload = first.session.reload();

    try {
      await reloadStarted.promise;
      second.setResponses([fauxAssistantMessage("during sibling reload")]);
      expect(getApiProvider(first.faux.api)).toBeDefined();
      expect(getApiProvider(second.faux.api)).toBeDefined();
      await second.session.prompt("prompt during reload");
      expect(getAssistantTexts(second)).toEqual(["during sibling reload"]);
    } finally {
      releaseReload.resolve();
      await reload;
      second.cleanup();
      first.cleanup();
    }
  });

  it("restores providers and queued state when refresh or reload throws", async () => {
    const reloadError = new Error("reload after reset failed");
    const resourceLoader = createTestResourceLoader();
    resourceLoader.reload = async () => {
      throw reloadError;
    };
    const first = await createHarness({ completionMode: "implicit" });
    const second = await createHarness({ completionMode: "implicit", resourceLoader });
    const refreshError = new Error("refresh after reset failed");
    const loadModels = first.session.modelRegistry.loadModels.bind(first.session.modelRegistry);

    try {
      first.setResponses([fauxAssistantMessage("first survives refresh failure")]);
      second.setResponses([fauxAssistantMessage("second survives reload failure")]);
      first.session.modelRegistry.loadModels = () => {
        throw refreshError;
      };

      expect(() => first.session.modelRegistry.refresh()).toThrow(refreshError);
      await expect(second.session.reload()).rejects.toBe(reloadError);
      expect(getApiProvider(first.faux.api)).toBeDefined();
      expect(getApiProvider(second.faux.api)).toBeDefined();
      expect(first.getPendingResponseCount()).toBe(1);
      expect(second.getPendingResponseCount()).toBe(1);
      expect(first.faux.state.callCount).toBe(0);
      expect(second.faux.state.callCount).toBe(0);

      first.session.modelRegistry.loadModels = loadModels;
      await first.session.prompt("first failure prompt");
      await second.session.prompt("second failure prompt");
      expect(getAssistantTexts(first)).toEqual(["first survives refresh failure"]);
      expect(getAssistantTexts(second)).toEqual(["second survives reload failure"]);
    } finally {
      first.session.modelRegistry.loadModels = loadModels;
      second.cleanup();
      first.cleanup();
    }
  });

  it("does not retain a provider when harness construction fails", async () => {
    const registeredBefore = getApiProviders().map((provider) => provider.api);
    const constructionError = new Error("extension construction failed");
    const existingFixtureDir = mkdtempSync(join(tmpdir(), "p-harness-existing-fixture-"));
    const markerPath = join(existingFixtureDir, "preserve.txt");
    let failedTempDir: string | undefined;
    writeFileSync(markerPath, "preserve\n");

    try {
      await expect(
        createHarness({
          tempRoot: existingFixtureDir,
          onTempDirCreated: (tempDir) => {
            failedTempDir = tempDir;
          },
          extensionFactories: [
            () => {
              throw constructionError;
            },
          ],
        }),
      ).rejects.toBe(constructionError);

      expect(getApiProviders().map((provider) => provider.api)).toEqual(registeredBefore);
      expect(existsSync(markerPath)).toBe(true);
      expect(failedTempDir).toBeDefined();
      if (!failedTempDir) throw new Error("Harness did not report its temporary directory");
      expect(existsSync(failedTempDir)).toBe(false);
    } finally {
      if (existsSync(existingFixtureDir)) rmSync(existingFixtureDir, { recursive: true });
    }
  });

  it("preserves the construction error and continues rollback when cleanup fails", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "p-harness-cleanup-failure-"));
    const constructionError = new Error("subscription construction failed");
    const cleanupError = new Error("session disposal failed");
    let failedTempDir: string | undefined;
    const subscribe = vi.spyOn(AgentSession.prototype, "subscribe").mockImplementationOnce(() => {
      throw constructionError;
    });
    const dispose = vi.spyOn(AgentSession.prototype, "dispose").mockImplementationOnce(() => {
      throw cleanupError;
    });

    try {
      await expect(
        createHarness({
          tempRoot: fixtureRoot,
          onTempDirCreated: (tempDir) => {
            failedTempDir = tempDir;
          },
        }),
      ).rejects.toBe(constructionError);
      expect(dispose).toHaveBeenCalledOnce();
      expect(failedTempDir).toBeDefined();
      if (!failedTempDir) throw new Error("Harness did not report its temporary directory");
      expect(existsSync(failedTempDir)).toBe(false);
      expect(constructionError.cause).toBeInstanceOf(AggregateError);
      expect((constructionError.cause as AggregateError).errors).toContain(cleanupError);
    } finally {
      dispose.mockRestore();
      subscribe.mockRestore();
      if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true });
    }
  });

  it("preserves a frozen construction error when cleanup also fails", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "p-harness-frozen-error-"));
    const constructionError = Object.freeze(new Error("frozen construction failure"));
    const cleanupError = new Error("frozen-error disposal failure");
    let failedTempDir: string | undefined;
    const subscribe = vi.spyOn(AgentSession.prototype, "subscribe").mockImplementationOnce(() => {
      throw constructionError;
    });
    const dispose = vi.spyOn(AgentSession.prototype, "dispose").mockImplementationOnce(() => {
      throw cleanupError;
    });

    try {
      await expect(
        createHarness({
          tempRoot: fixtureRoot,
          onTempDirCreated: (tempDir) => {
            failedTempDir = tempDir;
          },
        }),
      ).rejects.toBe(constructionError);
      expect(failedTempDir).toBeDefined();
      if (!failedTempDir) throw new Error("Harness did not report its temporary directory");
      expect(existsSync(failedTempDir)).toBe(false);
    } finally {
      dispose.mockRestore();
      subscribe.mockRestore();
      if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true });
    }
  });

  it("attempts every normal cleanup step before reporting cleanup failures", async () => {
    const harness = await createHarness();
    const cleanupError = new Error("normal session disposal failed");
    const dispose = vi.spyOn(harness.session, "dispose").mockImplementationOnce(() => {
      throw cleanupError;
    });

    try {
      expect(() => harness.cleanup()).toThrow(AggregateError);
      expect(getApiProvider(harness.faux.api)).toBeUndefined();
      expect(existsSync(harness.tempDir)).toBe(false);
    } finally {
      dispose.mockRestore();
      harness.cleanup();
    }
  });
});
