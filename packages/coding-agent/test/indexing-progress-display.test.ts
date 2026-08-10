import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent, formatIndexingStatus } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function createFooterData(): ReadonlyFooterDataProvider {
  return {
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map(),
    getPrefillProgress: () => undefined,
    getGenProgress: () => undefined,
    getQueuedProgress: () => undefined,
    getSendingProgress: () => undefined,
    getModelSwitchProgress: () => undefined,
    getLoadingProgress: () => undefined,
    getIndexingStatus: () => ({ decision: "unknown", indexed: false, serviceRunning: false }),
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
    onProgressChange: () => () => {},
  };
}

function createSession(interactionMode: "normal" | "plan"): AgentSession {
  return {
    state: {
      model: undefined,
      thinkingLevel: "off",
    },
    interactionMode,
    sessionManager: {
      getEntries: () => [],
      getCwd: () => "/tmp/project",
      getSessionName: () => undefined,
    },
    modelRegistry: {
      isUsingOAuth: () => false,
    },
    getContextUsage: () => undefined,
  } as unknown as AgentSession;
}

describe("formatIndexingStatus", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  it("shows queued state even if stale progress is present", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "queued",
        progress: { phase: "scanning", percent: 42 },
      }),
    ).toBe("🔎 queued");
  });

  it("does not show zero progress for a queued repository", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "queued",
        progress: { phase: "scanning", percent: 0 },
      }),
    ).toBe("🔎 queued");
  });

  it("shows queued text when no progress is available", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "queued",
      }),
    ).toBe("🔎 queued");
  });

  it("shows percentage for updating state with progress", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 75, processedChunks: 75, totalChunks: 100 },
      }),
    ).toContain("🔎 75.0% (75/100 chunks)");
  });

  it("formats reused vs new chunk breakdown when chunk stats are present", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 16.4, reusedChunks: 57817, recalculatedTotal: 9686 },
      }),
    ).toContain("🔎 16.4% (58k reused, 9.7k new)");

    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 50.0, reusedChunks: 1200 },
      }),
    ).toContain("🔎 50.0% (1.2k reused)");

    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 20.0, recalculatedTotal: 500 },
      }),
    ).toContain("🔎 20.0% (500 new)");
  });

  it("shows 0.0% for updating state with zero progress", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 0 },
      }),
    ).toContain("🔎 0.0%");
  });

  it("shows init text when initializing without progress", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "initializing",
      }),
    ).toBe("🔎 init");
  });

  it("shows the preparing phase without a synthetic percentage", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "initializing",
        progress: { phase: "preparing", percent: 12, processedFiles: 3, totalFiles: 8 },
      }),
    ).toBe("🔎 preparing 3/8");
  });

  it("shows OFF when indexing is disabled", () => {
    expect(
      formatIndexingStatus({
        decision: "disabled",
        indexed: false,
        serviceRunning: false,
      }),
    ).toBe("🔎 OFF");
  });

  it("shows ready state with checkmark", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "ready",
      }),
    ).toBe("🔎: ✅");
  });

  it("shows ON when service is not running", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: false,
      }),
    ).toBe("🔎 ON!");
  });

  it("does not infer ETA from elapsed time alone", () => {
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 50, startedAt },
      }),
    ).toBe("🔎 50.0%");
  });

  it("shows decimal minutes ETA for longer runs", () => {
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 20, startedAt },
      }),
    ).toBe("🔎 20.0%");
  });

  it("shows decimal minutes with fractional part", () => {
    const startedAt = new Date(Date.now() - 125_000).toISOString();
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 20, startedAt },
      }),
    ).toBe("🔎 20.0%");
  });

  it("omits ETA when percent is 0", () => {
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 0, startedAt },
      }),
    ).toBe("🔎 0.0%");
  });

  it("omits ETA when startedAt is not provided", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 50 },
      }),
    ).toBe("🔎 50.0%");
  });

  it("formats ETA in hours when eta exceeds 1 hour", () => {
    const startedAt = new Date(Date.now() - 120_000).toISOString(); // 2 minutes to do 1% means 200 minutes total (3.3 hours)
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 1, startedAt },
      }),
    ).toBe("🔎 1.0%");
  });

  it("uses explicit etaSeconds from progress when present", () => {
    expect(
      formatIndexingStatus({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 50, etaSeconds: 90 },
      }),
    ).toBe("🔎 50.0% (ETA: 90s)");
  });
});

describe("FooterComponent indexing progress display", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  it("renders queued for queued indexing with stale progress", () => {
    const footer = new FooterComponent(createSession("normal"), {
      ...createFooterData(),
      getIndexingStatus: () => ({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "queued",
        progress: { phase: "scanning", percent: 0 },
      }),
    });

    expect(footer.render(100).join("\n")).toContain("🔎 queued");
  });

  it("renders percentage for updating indexing in progress", () => {
    const footer = new FooterComponent(createSession("normal"), {
      ...createFooterData(),
      getIndexingStatus: () => ({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 42 },
      }),
    });

    expect(footer.render(100).join("\n")).toContain("🔎 42.0%");
  });
});
