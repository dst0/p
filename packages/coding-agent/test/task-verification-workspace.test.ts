import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";

const execFileAsync = promisify(execFile);

async function callVerificationTool(
	controller: TaskVerificationController,
	params: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
	try {
		const result = await controller.toolDefinition.execute(
			"verification-call",
			params as never,
			undefined,
			undefined,
			{} as never,
		);
		return {
			isError: false,
			text: result.content
				.filter((part): part is Extract<(typeof result.content)[number], { type: "text" }> => part.type === "text")
				.map((part) => part.text)
				.join("\n"),
		};
	} catch (error) {
		return { isError: true, text: error instanceof Error ? error.message : String(error) };
	}
}

function createToolCall(name: string, args: Record<string, unknown>) {
	return {
		type: "toolCall" as const,
		id: `${name}-${Math.random()}`,
		name,
		arguments: args,
	};
}

async function runHookedTool(
	agent: Agent,
	name: string,
	args: Record<string, unknown>,
	options: {
		isError?: boolean;
		text?: string;
		between?: () => Promise<void>;
	} = {},
): Promise<string | undefined> {
	const toolCall = createToolCall(name, args);
	const beforeResult = await agent.beforeToolCall?.({
		assistantMessage: {} as never,
		toolCall,
		args,
		context: {} as never,
	});
	if (beforeResult?.block) throw new Error(beforeResult.reason ?? "blocked");
	await options.between?.();
	const result = await agent.afterToolCall?.({
		assistantMessage: {} as never,
		toolCall,
		args,
		result: {
			content: [{ type: "text", text: options.text ?? "ok" }],
			details: undefined,
		},
		isError: options.isError ?? false,
		context: {} as never,
	});
	return result?.content
		?.filter(
			(part): part is Extract<NonNullable<typeof result.content>[number], { type: "text" }> => part.type === "text",
		)
		.map((part) => part.text)
		.join("\n");
}

function evidenceHandle(text: string | undefined): string {
	const match = text?.match(/Verification evidence handle: (verification-evidence-\d+)/u);
	if (!match) throw new Error(`Missing evidence handle in: ${text ?? "<empty>"}`);
	return match[1];
}

describe("task verification workspace enforcement", () => {
	it("detects workspace mutation from an arbitrary shell command", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "p-verification-workspace-"));
		try {
			await execFileAsync("git", ["init"], { cwd });
			await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd });
			await execFileAsync("git", ["config", "user.name", "Test"], { cwd });
			await writeFile(join(cwd, "source.ts"), "export const value = 1;\n");
			await execFileAsync("git", ["add", "source.ts"], { cwd });
			await execFileAsync("git", ["commit", "-m", "initial"], { cwd });

			const agent = new Agent();
			const controller = createTaskVerificationController(SessionManager.inMemory(cwd));
			controller.install(agent);
			await callVerificationTool(controller, {
				action: "declare_task",
				task_kind: "feature",
				task_summary: "Track shell-driven workspace mutations",
			});

			await runHookedTool(
				agent,
				"bash",
				{ command: "node scripts/change-source.mjs" },
				{
					between: async () => {
						await writeFile(join(cwd, "source.ts"), "export const value = 2;\n");
					},
				},
			);
			expect(controller.currentState.mutationRevision).toBe(1);
			expect(controller.currentState.final.status).toBe("pending");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("requires final verification to replay the baseline scenario", async () => {
		const agent = new Agent();
		const controller = createTaskVerificationController(SessionManager.inMemory());
		controller.install(agent);
		await callVerificationTool(controller, {
			action: "declare_task",
			task_kind: "bug_fix",
			task_summary: "Fix refresh recovery after daemon restart",
		});

		const baselineCommand = "node test/reproduce-refresh-restart.mjs";
		const baselineEvidence = evidenceHandle(
			await runHookedTool(agent, "bash", { command: baselineCommand }, { text: "reproduced" }),
		);
		const baseline = await callVerificationTool(controller, {
			action: "record_baseline",
			baseline_method: "runtime_reproduction",
			hypothesis: "Restart repeats an interrupted refresh from the previous manifest",
			conclusion: "The reproduction confirms repeated work after restart",
			evidence_refs: [baselineEvidence],
			unresolved_assumptions: [],
		});
		expect(baseline.isError).toBe(false);

		await runHookedTool(agent, "edit", {
			path: "src/refresh.ts",
			edits: [{ oldText: "old", newText: "new" }],
		});
		const unrelatedEvidence = evidenceHandle(
			await runHookedTool(agent, "bash", { command: "node test/other-check.mjs" }, { text: "passed" }),
		);
		const unrelatedFinal = await callVerificationTool(controller, {
			action: "record_final",
			final_method: "manual_reproduction",
			final_status: "passed",
			expected_behavior: "Restart no longer repeats completed refresh work",
			observed_behavior: "A different check passed",
			evidence_refs: [unrelatedEvidence],
			unresolved_failures: [],
		});
		expect(unrelatedFinal.isError).toBe(true);
		expect(unrelatedFinal.text).toContain("same command");

		const replayEvidence = evidenceHandle(
			await runHookedTool(agent, "bash", { command: baselineCommand }, { text: "no repeated work" }),
		);
		const replayedFinal = await callVerificationTool(controller, {
			action: "record_final",
			final_method: "manual_reproduction",
			final_status: "passed",
			expected_behavior: "Restart no longer repeats completed refresh work",
			observed_behavior: "The original reproduction now completes without repeated work",
			evidence_refs: [replayEvidence],
			unresolved_failures: [],
		});
		expect(replayedFinal.isError).toBe(false);
	});
});
