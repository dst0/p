import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createFindToolDefinition } from "../src/core/tools/find.ts";
import { createGrepToolDefinition } from "../src/core/tools/grep.ts";

const dummyTheme: any = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
};

const dummyContext: any = {
	cwd: "/test",
	showImages: false,
};

const dummyExtCtx = {} as ExtensionContext;

describe("find tool with custom operations", () => {
	it("throws when path does not exist", async () => {
		const mockOps = {
			exists: async () => false,
			glob: async () => [],
		};

		const toolDef = createFindToolDefinition("/test", { operations: mockOps });
		await expect(
			toolDef.execute("1", { pattern: "*.ts", path: "nonexistent" }, undefined, undefined, dummyExtCtx),
		).rejects.toThrow("Path not found");
	});

	it("returns matches and handles limit notice", async () => {
		const mockOps = {
			exists: async () => true,
			glob: async () => ["/test/src/a.ts", "/test/src/b.ts"],
		};

		const toolDef = createFindToolDefinition("/test", { operations: mockOps });
		const res = await toolDef.execute(
			"1",
			{ pattern: "*.ts", path: ".", limit: 2 },
			undefined,
			undefined,
			dummyExtCtx,
		);

		const text = (res.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("src/a.ts");
		expect(text).toContain("src/b.ts");
		expect(text).toContain("2 results limit reached");
		expect(res.details?.resultLimitReached).toBe(2);

		const rendered = toolDef.renderResult?.(res as any, { expanded: true } as any, dummyTheme, dummyContext);
		expect(rendered).toBeDefined();
	});

	it("returns 'No files found matching pattern' when glob returns empty", async () => {
		const mockOps = {
			exists: async () => true,
			glob: async () => [],
		};

		const toolDef = createFindToolDefinition("/test", { operations: mockOps });
		const res = await toolDef.execute("1", { pattern: "*.xyz", path: "." }, undefined, undefined, dummyExtCtx);
		expect((res.content[0] as { type: "text"; text: string }).text).toBe("No files found matching pattern");
	});
});

describe("grep tool custom operations validation", () => {
	it("throws when isDirectory fails", async () => {
		const mockOps = {
			isDirectory: async () => {
				throw new Error("Missing");
			},
			readFile: async () => "",
		};

		const toolDef = createGrepToolDefinition("/test", { operations: mockOps });
		await expect(
			toolDef.execute("1", { pattern: "foo", path: "missing" }, undefined, undefined, dummyExtCtx),
		).rejects.toThrow("Path not found");
	});

	it("renders grep call and empty result", () => {
		const toolDef = createGrepToolDefinition("/test");
		const callRender = toolDef.renderCall?.({ pattern: "foo", path: "src", glob: "*.ts" }, dummyTheme, dummyContext);
		expect(callRender).toBeDefined();

		const resRender = toolDef.renderResult?.(
			{ content: [{ type: "text", text: "No matches found" }] } as any,
			{ expanded: false } as any,
			dummyTheme,
			dummyContext,
		);
		expect(resRender).toBeDefined();
	});
});
