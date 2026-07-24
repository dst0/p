import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
} from "../src/core/agent-session-services.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { TASK_VERIFICATION_TOOL_NAME } from "../src/core/task-verification.ts";

describe("task verification session wiring", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `p-task-verification-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	async function createSession(
		overrides: Pick<CreateAgentSessionFromServicesOptions, "tools" | "excludeTools" | "noTools"> = {},
	) {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.inMemory(tempDir);
		const services = await createAgentSessionServices({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		return createAgentSessionFromServices({
			services,
			sessionManager,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			...overrides,
		});
	}

	it("automatically registers and activates verification with mutating tools", async () => {
		const { session } = await createSession();
		try {
			expect(session.getAllTools().map((tool) => tool.name)).toContain(TASK_VERIFICATION_TOOL_NAME);
			expect(session.getActiveToolNames()).toContain(TASK_VERIFICATION_TOOL_NAME);
			expect(session.systemPrompt).toContain(TASK_VERIFICATION_TOOL_NAME);
		} finally {
			session.dispose();
		}
	});

	it("does not register verification when built-in tools are disabled", async () => {
		const { session } = await createSession({ noTools: "builtin" });
		try {
			expect(session.getAllTools().map((tool) => tool.name)).not.toContain(TASK_VERIFICATION_TOOL_NAME);
			expect(session.getActiveToolNames()).not.toContain(TASK_VERIFICATION_TOOL_NAME);
			expect(session.systemPrompt).not.toContain(TASK_VERIFICATION_TOOL_NAME);
		} finally {
			session.dispose();
		}
	});

	it("honors an explicit verification-tool exclusion", async () => {
		const { session } = await createSession({ excludeTools: [TASK_VERIFICATION_TOOL_NAME] });
		try {
			expect(session.getAllTools().map((tool) => tool.name)).not.toContain(TASK_VERIFICATION_TOOL_NAME);
			expect(session.getActiveToolNames()).not.toContain(TASK_VERIFICATION_TOOL_NAME);
			expect(session.getActiveToolNames()).toContain("edit");
		} finally {
			session.dispose();
		}
	});
});
