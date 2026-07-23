import { describe, expect, it } from "vitest";
import { createFinishWorkTool } from "../src/completion-protocol.ts";

describe("finish_work completion protocol tool", () => {
	it("rejects an empty summary", async () => {
		const tool = createFinishWorkTool();

		await expect(
			tool.execute(
				"finish-empty-summary",
				{
					status: "success",
					summary: "   ",
				},
				undefined,
				undefined,
			),
		).rejects.toThrow("finish_work validation error: summary is required and must not be empty");
	});

	it("rejects success with remaining work", async () => {
		const tool = createFinishWorkTool();

		await expect(
			tool.execute(
				"finish-invalid-success",
				{
					status: "success",
					summary: "Done",
					remaining_work: ["Run verification"],
				},
				undefined,
				undefined,
			),
		).rejects.toThrow(
			'finish_work validation error: status "success" is incompatible with non-empty remaining_work',
		);
	});

	it("allows partial completion with remaining work", async () => {
		const tool = createFinishWorkTool();
		const result = await tool.execute(
			"finish-partial",
			{
				status: "partial",
				summary: "Partially complete",
				remaining_work: ["Run verification"],
			},
			undefined,
			undefined,
		);

		expect(result.details).toEqual({
			status: "partial",
			summary: "Partially complete",
			remaining_work: ["Run verification"],
		});
		expect(result.terminate).toBe(true);
	});
});
