import { describe, expect, it } from "vitest";
import type { FinishWorkInput } from "../../../src/core/tools/finish-work.ts";
import { createFinishWorkToolDefinition } from "../../../src/core/tools/finish-work.ts";

function getTextContent(content: { type: string; text?: string }[] | undefined): string | undefined {
	const textItem = content?.find((c) => c.type === "text");
	return textItem?.text;
}

describe("finish_work tool", () => {
	const tool = createFinishWorkToolDefinition();

	it("has correct metadata", () => {
		expect(tool.name).toBe("finish_work");
		expect(tool.label).toBe("Finish Work");
		expect(tool.description).toContain("Terminate the agent run");
	});

	it("has promptSnippet", () => {
		expect(tool.promptSnippet).toBeDefined();
		expect(tool.promptSnippet).toContain("terminate the task");
	});

	it("has promptGuidelines", () => {
		expect(tool.promptGuidelines).toBeDefined();
		expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
		expect(tool.promptGuidelines!.some((g) => g.includes("success"))).toBe(true);
	});

	it("has parameter schema with required fields", () => {
		expect(tool.parameters.properties.status).toBeDefined();
		expect(tool.parameters.properties.summary).toBeDefined();
	});

	it("executes successfully with valid success payload", async () => {
		const input: FinishWorkInput = {
			status: "success",
			summary: "All done",
			files_changed: ["src/main.ts"],
			tests_run: ["test/main.test.ts"],
		};
		const result = await tool.execute("test-1", input, undefined, undefined, {} as any);

		expect(getTextContent(result.content)).toContain("success");
		expect((result.details as FinishWorkInput).status).toBe("success");
		expect((result.details as FinishWorkInput).summary).toBe("All done");
		expect((result.details as FinishWorkInput).files_changed).toEqual(["src/main.ts"]);
	});

	it("executes successfully with partial status and remaining_work", async () => {
		const input: FinishWorkInput = {
			status: "partial",
			summary: "Completed some items",
			remaining_work: ["PR3 not started", "PR4 not started"],
		};
		const result = await tool.execute("test-2", input, undefined, undefined, {} as any);

		expect(getTextContent(result.content)).toContain("partial");
		expect((result.details as FinishWorkInput).remaining_work).toEqual(["PR3 not started", "PR4 not started"]);
	});

	it("executes successfully with failed status", async () => {
		const input: FinishWorkInput = {
			status: "failed",
			summary: "Unrecoverable error",
			notes: "Environment misconfigured",
		};
		const result = await tool.execute("test-3", input, undefined, undefined, {} as any);

		expect(getTextContent(result.content)).toContain("failed");
		expect((result.details as FinishWorkInput).notes).toBe("Environment misconfigured");
	});

	it("rejects empty summary", async () => {
		const input: FinishWorkInput = {
			status: "success",
			summary: "",
		};
		await expect(tool.execute("test-4", input, undefined, undefined, {} as any)).rejects.toThrow(
			"finish_work validation error: summary is required and must not be empty",
		);
	});

	it("rejects whitespace-only summary", async () => {
		const input: FinishWorkInput = {
			status: "success",
			summary: "   ",
		};
		await expect(tool.execute("test-5", input, undefined, undefined, {} as any)).rejects.toThrow(
			"finish_work validation error: summary is required and must not be empty",
		);
	});

	it("rejects success status with non-empty remaining_work", async () => {
		const input: FinishWorkInput = {
			status: "success",
			summary: "Done",
			remaining_work: ["something left"],
		};
		await expect(tool.execute("test-6", input, undefined, undefined, {} as any)).rejects.toThrow(
			'finish_work validation error: status "success" is incompatible with non-empty remaining_work',
		);
	});

	it("allows partial status with remaining_work", async () => {
		const input: FinishWorkInput = {
			status: "partial",
			summary: "Partially done",
			remaining_work: ["item 1"],
		};
		const result = await tool.execute("test-7", input, undefined, undefined, {} as any);
		expect(getTextContent(result.content)).toContain("partial");
	});

	it("allows failed status with remaining_work", async () => {
		const input: FinishWorkInput = {
			status: "failed",
			summary: "Failed mid-way",
			remaining_work: ["item 1", "item 2"],
		};
		const result = await tool.execute("test-8", input, undefined, undefined, {} as any);
		expect(getTextContent(result.content)).toContain("failed");
	});

	it("allows success with empty remaining_work array", async () => {
		const input: FinishWorkInput = {
			status: "success",
			summary: "Done",
			remaining_work: [],
		};
		const result = await tool.execute("test-9", input, undefined, undefined, {} as any);
		expect(getTextContent(result.content)).toContain("success");
	});

	it("exposes renderCall", () => {
		expect(typeof tool.renderCall).toBe("function");
	});

	it("exposes renderResult", () => {
		expect(typeof tool.renderResult).toBe("function");
	});
});
