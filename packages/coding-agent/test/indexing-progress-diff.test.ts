import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";
import { formatIndexingStatus } from "../src/modes/interactive/components/footer-indexing-status.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const updateIcon = chalk.bgWhite.bold.green("▲");

describe("formatIndexingStatus diff vs initial indexing", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  describe("updating incremental progress formatting", () => {
    it("formats preserving existing chunks vs embedding new chunks during updating", () => {
      // Copying / preserving phase
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "updating",
          progress: {
            phase: "indexing",
            percent: 50,
            processedChunks: 30000,
            totalChunks: 60159,
            reusedChunks: 60000,
            recalculatedTotal: 159,
            recalculatedChunks: 0,
          },
        }),
      ).toBe(`🔎 ${updateIcon} 50.0% (30k/60k preserved) (159 pending)`);

      // Embedding new chunks phase
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "updating",
          progress: {
            phase: "indexing",
            percent: 99.8,
            processedChunks: 60120,
            totalChunks: 60159,
            reusedChunks: 60000,
            recalculatedTotal: 159,
            recalculatedChunks: 120,
            etaSeconds: 15,
          },
        }),
      ).toBe(`🔎 ${updateIcon} 75.5% (120/159 new chunks) (60k reused) (ETA: 15s)`);
    });

    it("formats updating when recalculatedTotal is 0 or undefined", () => {
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "updating",
          progress: { phase: "indexing", percent: 75, processedChunks: 75, totalChunks: 100 },
        }),
      ).toBe(`🔎 ${updateIcon} 75.0% (75/100 chunks)`);

      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "updating",
          progress: { phase: "indexing", percent: 100, recalculatedTotal: 0, reusedChunks: 500 },
        }),
      ).toBe(`🔎 ${updateIcon} 100.0% (500 reused)`);
    });

    it("formats updating when reusedChunks is 0 or undefined", () => {
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "updating",
          progress: { phase: "indexing", percent: 50, recalculatedTotal: 100, recalculatedChunks: 50 },
        }),
      ).toBe(`🔎 ${updateIcon} 50.0% (50/100 new chunks)`);
    });

    it("clamps out-of-bounds percentages defensively", () => {
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "updating",
          progress: { phase: "indexing", percent: -10 },
        }),
      ).toBe(`🔎 ${updateIcon} 0.0%`);

      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "updating",
          progress: { phase: "indexing", percent: 150 },
        }),
      ).toBe(`🔎 ${updateIcon} 100.0%`);
    });
  });

  describe("initializing full repository progress formatting", () => {
    it("formats initial indexing with chunks and breakdown", () => {
      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "initializing",
          progress: {
            phase: "indexing",
            percent: 16.4,
            processedChunks: 10000,
            totalChunks: 60000,
            reusedChunks: 57817,
            recalculatedTotal: 9686,
          },
        }),
      ).toBe("🔎 16.4% (10k/60k chunks) (58k reused, 9.7k new)");

      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "initializing",
          progress: {
            phase: "indexing",
            percent: 50.0,
            processedChunks: 600,
            totalChunks: 1200,
            reusedChunks: 1200,
          },
        }),
      ).toBe("🔎 50.0% (600/1.2k chunks) (1.2k reused)");

      expect(
        formatIndexingStatus({
          decision: "enabled",
          indexed: true,
          serviceRunning: true,
          ragState: "initializing",
          progress: {
            phase: "indexing",
            percent: 20.0,
            processedChunks: 100,
            totalChunks: 500,
            recalculatedTotal: 500,
          },
        }),
      ).toBe("🔎 20.0% (100/500 chunks) (500 new)");
    });
  });
});
