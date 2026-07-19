import { describe, expect, it } from "vitest";
import type { IndexStatus } from "../../../src/core/indexing-service.ts";
import { formatIndexingStatus } from "../../../src/modes/interactive/components/footer.ts";

describe("indexing regressions", () => {
	describe("formatIndexingStatus", () => {
		it("shows ON! when daemon is dead and status is queued", () => {
			const status: IndexStatus = {
				decision: "enabled",
				indexed: true,
				serviceRunning: false,
				ragState: "queued",
			};
			expect(formatIndexingStatus(status)).toBe("🔎 ON!");
		});

		it("shows queued when daemon is running and status is queued", () => {
			const status: IndexStatus = {
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "queued",
			};
			expect(formatIndexingStatus(status)).toBe("🔎 queued");
		});

		it("shows ON! when daemon is dead and status is updating", () => {
			const status: IndexStatus = {
				decision: "enabled",
				indexed: true,
				serviceRunning: false,
				ragState: "updating",
				progress: { phase: "indexing", percent: 42 },
			};
			expect(formatIndexingStatus(status)).toBe("🔎 ON!");
		});

		it("shows percent when daemon is running and status is updating", () => {
			const status: IndexStatus = {
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "updating",
				progress: { phase: "indexing", percent: 42 },
			};
			expect(formatIndexingStatus(status)).toBe("🔎 42%");
		});

		it("shows init when daemon is running and status is initializing", () => {
			const status: IndexStatus = {
				decision: "enabled",
				indexed: true,
				serviceRunning: true,
				ragState: "initializing",
			};
			expect(formatIndexingStatus(status)).toBe("🔎 init");
		});

		it("shows ON! when daemon is dead and status is initializing", () => {
			const status: IndexStatus = {
				decision: "enabled",
				indexed: true,
				serviceRunning: false,
				ragState: "initializing",
			};
			expect(formatIndexingStatus(status)).toBe("🔎 ON!");
		});
	});
});
