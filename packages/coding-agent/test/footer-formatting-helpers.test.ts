import { describe, expect, it } from "vitest";
import { formatEta, formatTokens } from "../src/modes/interactive/components/footer-indexing-status.ts";
import {
  computeGenTrend,
  formatCwdForFooter,
  formatQueuedProgress,
  formatQueuedSpinner,
  renderProgressBar,
  sanitizeStatusText,
} from "../src/modes/interactive/components/footer-progress.ts";

describe("footer-formatting-helpers", () => {
  describe("formatTokens", () => {
    it("formats counts across all numerical tiers", () => {
      expect(formatTokens(0)).toBe("0");
      expect(formatTokens(999)).toBe("999");
      expect(formatTokens(1000)).toBe("1.0k");
      expect(formatTokens(1540)).toBe("1.5k");
      expect(formatTokens(9999)).toBe("10.0k");
      expect(formatTokens(10000)).toBe("10k");
      expect(formatTokens(57817)).toBe("58k");
      expect(formatTokens(999999)).toBe("1000k");
      expect(formatTokens(1000000)).toBe("1.0M");
      expect(formatTokens(2500000)).toBe("2.5M");
      expect(formatTokens(9999999)).toBe("10.0M");
      expect(formatTokens(10000000)).toBe("10M");
      expect(formatTokens(15400000)).toBe("15M");
    });
  });

  describe("formatEta", () => {
    it("formats seconds tier (<120s)", () => {
      expect(formatEta(0)).toBe("0s");
      expect(formatEta(45.4)).toBe("45s");
      expect(formatEta(119)).toBe("119s");
    });

    it("formats minutes tier (120s to <60m)", () => {
      expect(formatEta(120)).toBe("2.0m");
      expect(formatEta(150)).toBe("2.5m");
      expect(formatEta(3599)).toBe("60.0m");
    });

    it("formats hours tier (>=60m)", () => {
      expect(formatEta(3600)).toBe("1.0h");
      expect(formatEta(7200)).toBe("2.0h");
      expect(formatEta(12600)).toBe("3.5h");
    });
  });

  describe("renderProgressBar", () => {
    it("renders filled and empty block characters correctly", () => {
      expect(renderProgressBar(0, 10)).toBe("░░░░░░░░░░");
      expect(renderProgressBar(50, 10)).toBe("▓▓▓▓▓░░░░░");
      expect(renderProgressBar(100, 10)).toBe("▓▓▓▓▓▓▓▓▓▓");
    });
  });

  describe("computeGenTrend", () => {
    it("computes directional trend markers", () => {
      expect(computeGenTrend(50, undefined)).toBe("▸");
      expect(computeGenTrend(50, 40)).toBe("↑");
      expect(computeGenTrend(40, 50)).toBe("↓");
      expect(computeGenTrend(50, 48)).toBe("→");
    });
  });

  describe("formatQueuedProgress & formatQueuedSpinner", () => {
    it("formats queued position and spinner frame", () => {
      expect(formatQueuedProgress({ position: 1, queuedAhead: 0 })).toBe("#1, next");
      expect(formatQueuedProgress({ position: 3, queuedAhead: 2, queuedAt: Date.now() - 5000 })).toContain(
        "#3, 2 ahead",
      );
      expect(formatQueuedSpinner(0)).toBe("|");
      expect(formatQueuedSpinner(250)).toBe("/");
    });
  });

  describe("sanitizeStatusText & formatCwdForFooter", () => {
    it("sanitizes text removing newlines and redundant spaces", () => {
      expect(sanitizeStatusText(" hello \n world\t! ")).toBe("hello world !");
    });

    it("formats cwd relative to home directory", () => {
      expect(formatCwdForFooter("/Users/test/project", "/Users/test")).toBe("~/project");
      expect(formatCwdForFooter("/Users/test", "/Users/test")).toBe("~");
      expect(formatCwdForFooter("/var/log", "/Users/test")).toBe("/var/log");
      expect(formatCwdForFooter("/Users/test/project", undefined)).toBe("/Users/test/project");
    });
  });
});
