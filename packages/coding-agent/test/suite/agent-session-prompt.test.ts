import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentTool } from "@dst0/p-agent-core";
import { type AssistantMessage, fauxAssistantMessage, fauxToolCall, type Model } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputEvent } from "../../src/core/extensions/index.ts";
import type { PromptTemplate } from "../../src/core/prompt-templates.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness as createBaseHarness, getMessageText, type Harness, type HarnessOptions } from "./harness.ts";

describe("AgentSession prompt characterization", () => {
	const harnesses: Harness[] = [];
	const tempDirs: string[] = [];
	const createPromptHarness = (options: HarnessOptions = {}) =>
		createBaseHarness({ completionMode: "implicit", ...options });

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		while (tempDirs.length > 0) {
			const tempDir = tempDirs.pop();
			if (tempDir) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		}
	});

	it("prompts while idle and records a single text response", async () => {
		const harness = await createPromptHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("hello")]);

		await harness.session.prompt("hi");

		expect(harness.session.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(getMessageText(harness.session.messages[0]!)).toBe("hi");
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("automatically syncs project memory and injects scoped memory into later prompts", async () => {
		const harness = await createPromptHarness();
		harnesses.push(harness);
		let secondSystemPrompt = "";
		harness.setResponses([
			fauxAssistantMessage("first done"),
			(context) => {
				secondSystemPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("second done");
			},
		]);

		await harness.session.prompt("Fix compaction loops");
		const snapshotPath = join(harness.tempDir, ".pdev/state/session.current.json");
		expect(existsSync(snapshotPath)).toBe(true);
		expect(readFileSync(snapshotPath, "utf8")).toContain("Fix compaction loops");

		await harness.session.prompt("continue compaction work");

		expect(secondSystemPrompt).not.toContain("<project_memory>");
		expect(
			harness.session.messages.some(
				(message) => message.role === "custom" && message.customType === "pi.project-memory",
			),
		).toBe(false);
	});

	it("reuses provider prompt cache across sequential user prompts", async () => {
		const harness = await createPromptHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("first done"), fauxAssistantMessage("second done")]);

		await harness.session.prompt("Fix prompt cache reuse");
		await harness.session.prompt("continue");

		const assistantMessages = harness.session.messages.filter(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(harness.session.agent.sessionId).toBe(harness.session.sessionId);
		expect(assistantMessages).toHaveLength(2);
		expect(assistantMessages[0]?.usage.cacheWrite).toBeGreaterThan(0);
		expect(assistantMessages[1]?.usage.cacheRead).toBeGreaterThan(0);
		expect(assistantMessages[1]?.usage.input).toBeLessThan(assistantMessages[1]?.usage.totalTokens ?? 0);
	});

	it("reuses provider prompt cache after a completed tool loop and ten idle seconds", async () => {
		const toolRuns: string[] = [];
		const echoTool: AgentTool = {
			name: "echo",
			label: "Echo",
			description: "Echo text back",
			parameters: Type.Object({ text: Type.String() }),
			execute: async (_toolCallId, params) => {
				const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
				toolRuns.push(text);
				return {
					content: [{ type: "text", text: `echo:${text}` }],
					details: { text },
				};
			},
		};
		const harness = await createPromptHarness({ tools: [echoTool] });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("echo", { text: "warm-cache" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("first tool loop complete"),
			fauxAssistantMessage("second prompt complete"),
		]);

		await harness.session.prompt("Start a multi-turn tool loop");
		expect(toolRuns).toEqual(["warm-cache"]);
		expect(harness.session.state.isStreaming).toBe(false);
		expect(harness.session.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);

		vi.useFakeTimers();
		try {
			const idleGap = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
			await vi.advanceTimersByTimeAsync(10_000);
			await idleGap;
		} finally {
			vi.useRealTimers();
		}

		await harness.session.prompt("Continue after idle");

		const assistantMessages = harness.session.messages.filter(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(assistantMessages).toHaveLength(3);
		expect(assistantMessages[0]?.usage.cacheWrite).toBeGreaterThan(0);
		expect(assistantMessages[1]?.usage.cacheRead).toBeGreaterThan(0);
		expect(assistantMessages[1]?.usage.input).toBeLessThan(assistantMessages[1]?.usage.totalTokens ?? 0);
		expect(assistantMessages[2]?.usage.cacheRead).toBeGreaterThan(0);
		expect(assistantMessages[2]?.usage.input).toBeLessThan(assistantMessages[2]?.usage.totalTokens ?? 0);
	});

	it("sends bounded tool-result context to the provider without mutating raw session history", async () => {
		const harness = await createPromptHarness({
			models: [{ id: "small-context", contextWindow: 16_000, maxTokens: 1000 }],
			settings: {
				compaction: {
					enabled: true,
					triggerReserveTokens: 1000,
					triggerRatio: 0.9,
					targetContextTokens: 4000,
					keepRecentMinTokens: 500,
					keepRecentMaxTokens: 1000,
				},
			},
		});
		harnesses.push(harness);
		const hugeOutput = Array.from(
			{ length: 3000 },
			(_, index) => `raw-line-${index.toString().padStart(4, "0")} ${"x".repeat(80)}`,
		).join("\n");
		const rawToolResult: AgentMessage = {
			role: "toolResult",
			toolCallId: "call-read-huge",
			toolName: "read",
			content: [{ type: "text", text: hugeOutput }],
			isError: false,
			timestamp: Date.now() - 1000,
		};
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "inspect a large file" }], timestamp: Date.now() - 3000 },
			rawToolResult,
			{
				role: "toolResult",
				toolCallId: "call-read-small",
				toolName: "read",
				content: [{ type: "text", text: "small output" }],
				isError: false,
				timestamp: Date.now() - 500,
			},
		];
		let providerPromptText = "";
		harness.setResponses([
			(context) => {
				providerPromptText = context.messages.map(getMessageText).join("\n");
				return fauxAssistantMessage("bounded");
			},
		]);

		await harness.session.prompt("continue");

		expect(providerPromptText.length).toBeLessThan(hugeOutput.length / 2);
		expect(providerPromptText).toContain("[Tool result stubbed");
		expect(providerPromptText).toContain('session_recall("tool-result:call-read-huge"');
		expect(providerPromptText).not.toContain("raw-line-0100");
		expect(getMessageText(rawToolResult)).toContain("raw-line-0000");
	});

	it("stubs recent long tool results before prompt pressure", async () => {
		const harness = await createPromptHarness({
			models: [{ id: "large-context", contextWindow: 65_536, maxTokens: 1000 }],
			settings: {
				compaction: {
					enabled: true,
					triggerReserveTokens: 16_384,
					triggerRatio: 0.75,
					targetContextTokens: 12_000,
				},
			},
		});
		harnesses.push(harness);
		const longOutput = Array.from(
			{ length: 360 },
			(_, index) => `doc-line-${index.toString().padStart(4, "0")} ${"x".repeat(80)}`,
		).join("\n");
		const rawToolResult: AgentMessage = {
			role: "toolResult",
			toolCallId: "call-read-doc",
			toolName: "read",
			content: [{ type: "text", text: longOutput }],
			isError: false,
			timestamp: Date.now() - 1000,
		};
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "read the architecture doc" }], timestamp: Date.now() - 3000 },
			rawToolResult,
			{
				role: "toolResult",
				toolCallId: "call-read-small",
				toolName: "read",
				content: [{ type: "text", text: "small output" }],
				isError: false,
				timestamp: Date.now() - 500,
			},
		];
		let providerPromptText = "";
		harness.setResponses([
			(context) => {
				providerPromptText = context.messages.map(getMessageText).join("\n");
				return fauxAssistantMessage("bounded");
			},
		]);

		await harness.session.prompt("continue");

		expect(providerPromptText).toContain("[Tool result stubbed");
		expect(providerPromptText).toContain('session_recall("tool-result:call-read-doc"');
		expect(providerPromptText).not.toContain("doc-line-0100");
		expect(getMessageText(rawToolResult)).toContain("doc-line-0000");
	});

	it("handles a tool call turn and waits for the follow-up LLM response", async () => {
		const toolRuns: string[] = [];
		const echoTool: AgentTool = {
			name: "echo",
			label: "Echo",
			description: "Echo text back",
			parameters: Type.Object({ text: Type.String() }),
			execute: async (_toolCallId, params) => {
				const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
				toolRuns.push(text);
				return {
					content: [{ type: "text", text: `echo:${text}` }],
					details: { text },
				};
			},
		};
		const harness = await createPromptHarness({ tools: [echoTool] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("echo", { text: "hello" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("start");

		expect(toolRuns).toEqual(["hello"]);
		expect(harness.session.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
		expect(harness.session.messages[2]?.role).toBe("toolResult");
		expect(harness.session.messages[3]?.role).toBe("assistant");
	});

	it("executes multiple tool calls from one response and continues with a single follow-up response", async () => {
		const toolRuns: string[] = [];
		const makeTool = (name: string, delayMs: number): AgentTool => ({
			name,
			label: name,
			description: `${name} tool`,
			parameters: Type.Object({ value: Type.String() }),
			execute: async (_toolCallId, params) => {
				const value =
					typeof params === "object" && params !== null && "value" in params ? String(params.value) : "";
				await new Promise((resolve) => setTimeout(resolve, delayMs));
				toolRuns.push(`${name}:${value}`);
				return {
					content: [{ type: "text", text: `${name}:${value}` }],
					details: { value },
				};
			},
		});
		const harness = await createPromptHarness({ tools: [makeTool("slow", 25), makeTool("fast", 0)] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("slow", { value: "a" }), fauxToolCall("fast", { value: "b" })], {
				stopReason: "toolUse",
			}),
			(context) => {
				const toolResults = context.messages.filter((message) => message.role === "toolResult");
				return fauxAssistantMessage(`tool results: ${toolResults.length}`);
			},
		]);

		await harness.session.prompt("run tools");

		expect(toolRuns.sort()).toEqual(["fast:b", "slow:a"]);
		expect(harness.session.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
		expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("assistant");
	});

	it("preserves image attachments in the provider context", async () => {
		const harness = await createPromptHarness();
		harnesses.push(harness);
		let sawImage = false;

		harness.setResponses([
			(context) => {
				const user = context.messages.find((message) => message.role === "user");
				sawImage =
					user?.role === "user" &&
					typeof user.content !== "string" &&
					user.content.some((part) => part.type === "image");
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("describe", {
			images: [
				{
					type: "image",
					mimeType: "image/png",
					data: "ZmFrZQ==",
				},
			],
		});

		expect(sawImage).toBe(true);
	});

	it("expands skill commands before sending the prompt", async () => {
		const tempDir = join(tmpdir(), `pi-skill-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);
		const skillPath = join(tempDir, "test-skill.md");
		writeFileSync(skillPath, "# Test Skill\n\nUse the skill body.");

		const resourceLoader = {
			...createTestResourceLoader(),
			getSkills: () => ({
				skills: [
					{
						name: "test",
						description: "Test skill",
						filePath: skillPath,
						disableModelInvocation: false,
						baseDir: tempDir,
						sourceInfo: createSyntheticSourceInfo(skillPath, {
							source: "local",
							scope: "project",
							origin: "top-level",
							baseDir: tempDir,
						}),
					},
				],
				diagnostics: [],
			}),
		};
		const harness = await createPromptHarness({ resourceLoader });
		harnesses.push(harness);
		let expandedPrompt = "";

		harness.setResponses([
			(context) => {
				const user = context.messages.find((message) => message.role === "user");
				expandedPrompt = user ? getMessageText(user) : "";
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("/skill:test explain this");

		expect(expandedPrompt).toContain('<skill name="test" location="');
		expect(expandedPrompt).toContain("Use the skill body.");
		expect(expandedPrompt).toContain("explain this");
	});

	it("expands prompt templates before sending the prompt", async () => {
		const template: PromptTemplate = {
			name: "review",
			description: "Review template",
			content: "Review this code: $1",
			filePath: "/virtual/review.md",
			sourceInfo: createSyntheticSourceInfo("/virtual/review.md", {
				source: "local",
				scope: "temporary",
				origin: "top-level",
			}),
		};
		const resourceLoader = {
			...createTestResourceLoader(),
			getPrompts: () => ({ prompts: [template], diagnostics: [] }),
		};
		const harness = await createPromptHarness({ resourceLoader });
		harnesses.push(harness);
		let expandedPrompt = "";

		harness.setResponses([
			(context) => {
				const user = context.messages.find((message) => message.role === "user");
				expandedPrompt = user ? getMessageText(user) : "";
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("/review src/index.ts");

		expect(expandedPrompt).toBe("Review this code: src/index.ts");
	});

	it("dispatches extension commands without consuming a provider response", async () => {
		const commandRuns: string[] = [];
		const harness = await createPromptHarness({
			extensionFactories: [
				(pi) => {
					pi.registerCommand("testcmd", {
						description: "Test command",
						handler: async (args) => {
							commandRuns.push(args);
						},
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("should stay queued")]);

		await harness.session.prompt("/testcmd hello world");

		expect(commandRuns).toEqual(["hello world"]);
		expect(harness.session.messages).toEqual([]);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("sendUserMessage while idle triggers a turn", async () => {
		const harness = await createPromptHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("response")]);

		await harness.session.sendUserMessage("from extension");

		expect(harness.session.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(getMessageText(harness.session.messages[0]!)).toBe("from extension");
	});

	it("does not report streamingBehavior to input handlers while idle", async () => {
		const inputEvents: InputEvent[] = [];
		const harness = await createPromptHarness({
			extensionFactories: [
				(pi) => {
					pi.on("input", (event) => {
						inputEvents.push(event);
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("idle", { streamingBehavior: "followUp" });

		expect(inputEvents).toHaveLength(1);
		expect(inputEvents[0]?.streamingBehavior).toBeUndefined();
	});

	it("reports streamingBehavior to input handlers while streaming", async () => {
		let releaseToolExecution: (() => void) | undefined;
		const toolRelease = new Promise<void>((resolve) => {
			releaseToolExecution = resolve;
		});
		const inputEvents: InputEvent[] = [];
		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for release",
			parameters: Type.Object({}),
			execute: async () => {
				await toolRelease;
				return {
					content: [{ type: "text", text: "released" }],
					details: {},
				};
			},
		};
		const harness = await createPromptHarness({
			tools: [waitTool],
			extensionFactories: [
				(pi) => {
					pi.on("input", (event) => {
						inputEvents.push(event);
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		const sawToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start") {
					unsubscribe();
					resolve();
				}
			});
		});

		const promptPromise = harness.session.prompt("start");
		await sawToolStart;
		await harness.session.prompt("queued", { streamingBehavior: "followUp" });

		expect(inputEvents.map((event) => event.streamingBehavior)).toEqual([undefined, "followUp"]);

		releaseToolExecution?.();
		await promptPromise;
	});

	it("throws when prompted during streaming without a streamingBehavior", async () => {
		let releaseToolExecution: (() => void) | undefined;
		const toolRelease = new Promise<void>((resolve) => {
			releaseToolExecution = resolve;
		});
		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for release",
			parameters: Type.Object({}),
			execute: async () => {
				await toolRelease;
				return {
					content: [{ type: "text", text: "released" }],
					details: {},
				};
			},
		};
		const harness = await createPromptHarness({ tools: [waitTool] });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		const sawToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start") {
					unsubscribe();
					resolve();
				}
			});
		});

		const promptPromise = harness.session.prompt("start");
		await sawToolStart;

		await expect(harness.session.prompt("second")).rejects.toThrow(
			"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
		);

		releaseToolExecution?.();
		await promptPromise;
	});

	it("throws when prompting without a model", async () => {
		const harness = await createPromptHarness();
		harnesses.push(harness);
		harness.session.agent.state.model = undefined as unknown as Model<any>;

		await expect(harness.session.prompt("hi")).rejects.toThrow("No model selected.");
	});

	it("throws when prompting without configured auth", async () => {
		const harness = await createPromptHarness({ withConfiguredAuth: false });
		harnesses.push(harness);

		await expect(harness.session.prompt("hi")).rejects.toThrow(
			`No API key found for ${harness.getModel().provider}.`,
		);
	});
});
