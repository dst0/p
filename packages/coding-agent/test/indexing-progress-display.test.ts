import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { formatIndexingStatus } from "../src/modes/interactive/components/footer-indexing-status.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const updateIcon = chalk.bgWhite.bold.green("▲");

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

function createSession(): AgentSession {
  return {
    state: { model: undefined, thinkingLevel: "off" },
    interactionMode: "normal",
    sessionManager: { getEntries: () => [], getCwd: () => "/tmp/project", getSessionName: () => undefined },
    modelRegistry: { isUsingOAuth: () => false },
    getContextUsage: () => undefined,
  } as unknown as AgentSession;
}

describe("formatIndexingStatus", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  describe("decisions and service availability", () => {
    it("handles decision unknown and disabled", () => {
      expect(formatIndexingStatus({ decision: "unknown", indexed: false, serviceRunning: true })).toBe("🔎 ?");
      expect(formatIndexingStatus({ decision: "disabled", indexed: false, serviceRunning: false })).toBe("🔎 OFF");
    });

    it("handles service dead state", () => {
      expect(formatIndexingStatus({ decision: "enabled", indexed: true, serviceRunning: false })).toBe("🔎 ON!");
    });

    it("handles error, partial, unavailable, and lastError states", () => {
      expect(
        formatIndexingStatus({ decision: "enabled", indexed: true, serviceRunning: true, ragState: "error" }),
      ).toBe("🔎 ON!");
      expect(
        formatIndexingStatus({ decision: "enabled", indexed: true, serviceRunning: true, ragState: "partial" }),
      ).toBe("🔎 ON!");
      expect(
        formatIndexingStatus({ decision: "enabled", indexed: true, serviceRunning: true, ragState: "unavailable" }),
      ).toBe("🔎 ON!");
      expect(
        formatIndexingStatus({ decision: "enabled", indexed: true, serviceRunning: true, ragState: "disabled" }),
      ).toBe("🔎 ON!");
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "ready",
          lastError: "Network failure",
        }),
      ).toBe("🔎 ON!");
    });

    it("handles ready and idle state", () => {
      expect(
        formatIndexingStatus({ decision: "enabled", indexed: true, serviceRunning: true, ragState: "ready" }),
      ).toBe("🔎: ✅");
      expect(
        formatIndexingStatus({ decision: "enabled", indexed: true, serviceRunning: true, ragState: "stale" }),
      ).toBe("🔎 ON");
      expect(
        formatIndexingStatus({ decision: "enabled", indexed: true, serviceRunning: true, ragState: "not_initialized" }),
      ).toBe("🔎 ON");
    });

    it("handles queued state with or without progress", () => {
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "queued",
          progress: { phase: "scanning", percent: 42 },
        }),
      ).toBe("🔎 queued");
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "queued",
          progress: { phase: "scanning", percent: 0 },
        }),
      ).toBe("🔎 queued");
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "queued",
        }),
      ).toBe("🔎 queued");
    });
  });

  describe("phases and no-progress state", () => {
    it("shows init / update text without progress", () => {
      expect(
        formatIndexingStatus({ decision: "enabled", indexed: true, serviceRunning: true, ragState: "initializing" }),
      ).toBe("🔎 init");
      expect(
        formatIndexingStatus({ decision: "enabled", indexed: true, serviceRunning: true, ragState: "updating" }),
      ).toBe(`🔎 ${updateIcon} update`);
    });

    it("shows scanning, preparing, and finalizing phases with and without file counts", () => {
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "initializing",
          progress: { phase: "scanning", percent: 0, processedFiles: 5, totalFiles: 20 },
        }),
      ).toBe("🔎 scanning 5/20");
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "initializing",
          progress: { phase: "scanning", percent: 0 },
        }),
      ).toBe("🔎 scanning");
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "updating",
          progress: { phase: "preparing", percent: 12, processedFiles: 3, totalFiles: 8 },
        }),
      ).toBe(`🔎 ${updateIcon} preparing 3/8`);
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "updating",
          progress: { phase: "preparing", percent: 12 },
        }),
      ).toBe(`🔎 ${updateIcon} preparing`);
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "initializing",
          progress: { phase: "finalizing", percent: 100 },
        }),
      ).toBe("🔎 finalizing");
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "updating",
          progress: { phase: "finalizing", percent: 100 },
        }),
      ).toBe(`🔎 ${updateIcon} finalizing`);
    });
  });
});

describe("FooterComponent indexing progress display", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  it("renders queued for queued indexing with stale progress", () => {
    const footer = new FooterComponent(createSession(), {
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

  it("renders percentage for updating indexing in progress across wide and narrow widths", () => {
    const footer = new FooterComponent(createSession(), {
      ...createFooterData(),
      getIndexingStatus: () => ({
        decision: "enabled",
        indexed: true,
        serviceRunning: true,
        ragState: "updating",
        progress: { phase: "indexing", percent: 42 },
      }),
    });

    const wide = footer.render(100).join("\n");
    expect(wide).toContain(updateIcon);
    expect(wide).toContain("42.0%");

    const narrow = footer.render(40).join("\n");
    expect(narrow).toContain(updateIcon);
  });
});
