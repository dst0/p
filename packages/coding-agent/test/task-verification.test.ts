import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
	createTaskVerificationController,
	TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE,
	TASK_VERIFICATION_TOOL_NAME,
	type TaskVerificationController,
} from "../src/core/task-verification.ts";

function createInstalledController(): {
	agent: Agent;
	controller: TaskVerificationController;
	sessionManager: SessionManager;
} {
	const agent = new Agent();
	const sessionManager = SessionManager.inMemory();
	const controller = createTaskVerificationController(sessionManager);
	controller.install(agent);
	return { agent, controller, sessionManager };
}

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
		const text = result.content
			.filter((part): part is Extract<(typeof result.content)[number], { type: "text" }> => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		return { isError: false, text };
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

async function beforeTool(
	agent: Agent,
	name: string,
	args: Record<string, unknown>,
): Promise<{ block?: boolean; reason?: string } | undefined> {
	const toolCall = createToolCall(name, args);
	return agent.beforeToolCall?.({
		assistantMessage: {} as never,
		toolCall,
		args,
		context: {} as never,
	});
}

async function afterTool(
	agent: Agent,
	name: string,
	args: Record<string, unknown>,
	options: { isError?: boolean; text?: string } = {},
): Promise<string | undefined> {
	const toolCall = createToolCall(name, args);
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

describe("task verification controller", () => {
	it("blocks mutation until the task and required baseline are verified", async () => {
		const { agent, controller } = createInstalledController();

		const undeclared = await beforeTool(agent, "edit", { path: "a.ts", edits: [] });
		expect(undeclared?.block).toBe(true);
		expect(undeclared?.reason).toContain(TASK_VERIFICATION_TOOL_NAME);

		const declared = await callVerificationTool(controller, {
			action: "declare_task",
			task_kind: "bug_fix",
			task_summary: "Fix refresh state loss after daemon restart",
		});
		expect(declared.isError).toBe(false);

		const withoutBaseline = await beforeTool(agent, "edit", { path: "a.ts", edits: [] });
		expect(withoutBaseline?.block).toBe(true);
		expect(withoutBaseline?.reason).toContain("baseline");

		const reproduction = evidenceHandle(
			await afterTool(agent, "bash", { command: "node test/reproduce-restart.mjs" }, { text: "reproduced" }),
		);
		const baseline = await callVerificationTool(controller, {
			action: "record_baseline",
			baseline_method: "runtime_reproduction",
			hypothesis: "SIGTERM interrupts the active refresh before durable state is committed",
			conclusion: "The restart begins from the prior manifest and repeats the interrupted refresh",
			evidence_refs: [reproduction],
			unresolved_assumptions: [],
		});
		expect(baseline.isError).toBe(false);
		expect((await beforeTool(agent, "edit", { path: "a.ts", edits: [] }))?.block).not.toBe(true);
	});

	it("allows only explicitly authorized regression-test edits before baseline", async () => {
		const { agent, controller } = createInstalledController();
		await callVerificationTool(controller, {
			action: "declare_task",
			task_kind: "bug_fix",
			task_summary: "Fix completion without semantic verification",
		});

		expect((await beforeTool(agent, "edit", { path: "src/completion.ts", edits: [] }))?.block).toBe(true);
		const authorized = await callVerificationTool(controller, {
			action: "authorize_baseline_test",
			test_paths: ["test/completion-regression.test.ts"],
		});
		expect(authorized.isError).toBe(false);
		expect(
			(await beforeTool(agent, "edit", { path: "test/completion-regression.test.ts", edits: [] }))?.block,
		).not.toBe(true);
		expect((await beforeTool(agent, "write", { path: "src/not-a-test.ts", content: "" }))?.block).toBe(true);

		await afterTool(agent, "edit", {
			path: "test/completion-regression.test.ts",
			edits: [{ oldText: "old", newText: "failing regression" }],
		});
		expect(controller.currentState.mutationRevision).toBe(0);
		expect(controller.currentState.baseline.testSetupChanged).toBe(true);

		const failingTest = evidenceHandle(
			await afterTool(
				agent,
				"bash",
				{ command: "vitest --run test/completion-regression.test.ts" },
				{ isError: true, text: "expected failure" },
			),
		);
		const baseline = await callVerificationTool(controller, {
			action: "record_baseline",
			baseline_method: "failing_regression_test",
			hypothesis: "Successful completion accepts generic checks without behavioral evidence",
			conclusion: "The focused regression fails against the current implementation",
			evidence_refs: [failingTest],
			unresolved_assumptions: [],
		});
		expect(baseline.isError).toBe(false);
		expect((await beforeTool(agent, "edit", { path: "src/completion.ts", edits: [] }))?.block).not.toBe(true);
	});

	it("rejects static baseline evidence for lifecycle and persistence work", async () => {
		const { agent, controller } = createInstalledController();
		await callVerificationTool(controller, {
			action: "declare_task",
			task_kind: "bug_fix",
			task_summary: "Fix SIGTERM restart recovery for persisted indexing manifests",
		});
		const firstRead = evidenceHandle(await afterTool(agent, "read", { path: "daemon.ts" }));
		const secondRead = evidenceHandle(await afterTool(agent, "read", { path: "manifest.ts" }));

		const staticBaseline = await callVerificationTool(controller, {
			action: "record_baseline",
			baseline_method: "static_trace",
			hypothesis: "The signal bypasses the normal completion path",
			conclusion: "The manifest write occurs only after refresh completion",
			evidence_refs: [firstRead, secondRead],
			unresolved_assumptions: [],
		});
		expect(staticBaseline.isError).toBe(true);
		expect(staticBaseline.text).toContain("Static trace is insufficient");
	});

	it("requires fresh semantic evidence after the final mutation", async () => {
		const { agent, controller } = createInstalledController();
		await callVerificationTool(controller, {
			action: "declare_task",
			task_kind: "feature",
			task_summary: "Add a deterministic verification gate",
		});

		await afterTool(agent, "edit", { path: "gate.ts", edits: [{ oldText: "a", newText: "b" }] });
		const unfinished = await beforeTool(agent, "finish_work", { status: "success" });
		expect(unfinished?.block).toBe(true);
		expect(unfinished?.reason).toContain("semantic verification");

		const reproduction = evidenceHandle(
			await afterTool(agent, "bash", { command: "node test/manual-gate-check.mjs" }, { text: "gate passed" }),
		);
		const final = await callVerificationTool(controller, {
			action: "record_final",
			final_method: "manual_reproduction",
			final_status: "passed",
			expected_behavior: "Mutations remain blocked until the required verification state is satisfied",
			observed_behavior: "The manual gate check passed for the current implementation",
			evidence_refs: [reproduction],
			unresolved_failures: [],
		});
		expect(final.isError).toBe(false);
		expect((await beforeTool(agent, "finish_work", { status: "success" }))?.block).not.toBe(true);
		expect((await beforeTool(agent, "bash", { command: "git commit -m test" }))?.block).not.toBe(true);

		await afterTool(agent, "edit", { path: "gate.ts", edits: [{ oldText: "b", newText: "c" }] });
		expect((await beforeTool(agent, "finish_work", { status: "success" }))?.block).toBe(true);

		const staleFinal = await callVerificationTool(controller, {
			action: "record_final",
			final_method: "manual_reproduction",
			final_status: "passed",
			expected_behavior: "The gate remains correct",
			observed_behavior: "Only evidence from the previous mutation revision is available",
			evidence_refs: [reproduction],
			unresolved_failures: [],
		});
		expect(staleFinal.isError).toBe(true);
		expect(staleFinal.text).toContain("stale");
	});

	it("does not accept generic checks as behavioral verification", async () => {
		const { agent, controller } = createInstalledController();
		await callVerificationTool(controller, {
			action: "declare_task",
			task_kind: "bug_fix",
			task_summary: "Fix an incorrect completion gate",
		});
		const baseline = evidenceHandle(
			await afterTool(agent, "bash", { command: "node test/reproduce-completion.mjs" }, { text: "reproduced" }),
		);
		await callVerificationTool(controller, {
			action: "record_baseline",
			baseline_method: "runtime_reproduction",
			hypothesis: "The current gate accepts incomplete verification",
			conclusion: "The reproduction completed without a semantic check",
			evidence_refs: [baseline],
			unresolved_assumptions: [],
		});
		await afterTool(agent, "edit", { path: "completion.ts", edits: [{ oldText: "old", newText: "new" }] });
		const genericCheck = evidenceHandle(await afterTool(agent, "bash", { command: "npm run check" }, { text: "ok" }));

		const final = await callVerificationTool(controller, {
			action: "record_final",
			final_method: "manual_reproduction",
			final_status: "passed",
			expected_behavior: "Incomplete semantic verification is rejected",
			observed_behavior: "Only the generic repository check was executed",
			evidence_refs: [genericCheck],
			unresolved_failures: [],
		});
		expect(final.isError).toBe(true);
		expect(final.text).toContain("non-generic bash evidence");
	});

	it("restores verification state and evidence from durable session entries", async () => {
		const sessionManager = SessionManager.inMemory();
		const firstAgent = new Agent();
		const first = createTaskVerificationController(sessionManager);
		first.install(firstAgent);
		await callVerificationTool(first, {
			action: "declare_task",
			task_kind: "feature",
			task_summary: "Persist verification state",
		});
		const handle = evidenceHandle(await afterTool(firstAgent, "read", { path: "state.ts" }));
		expect(handle).toBe("verification-evidence-1");

		const restored = createTaskVerificationController(sessionManager);
		const status = await callVerificationTool(restored, { action: "status" });
		expect(status.text).toContain("Persist verification state");
		expect(status.text).toContain(handle);
		expect(
			sessionManager
				.getBranch()
				.some((entry) => entry.type === "custom" && entry.customType === TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE),
		).toBe(true);
	});
});
