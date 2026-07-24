import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const agentSessionSource = readFileSync(
	fileURLToPath(new URL("../../../src/core/agent-session.ts", import.meta.url)),
	"utf8",
);

describe("session-state guard reminder wording", () => {
	it("anchors the instruction to receipt of a user message, not the attempted tool", () => {
		expect(agentSessionSource).toContain(
			"After receiving the latest user message, call ${UPDATE_SESSION_STATE_TOOL_NAME} first",
		);
		expect(agentSessionSource).toContain("before attempting any other tool call");
		expect(agentSessionSource).not.toContain("Before calling ${toolCall.name}, call ${UPDATE_SESSION_STATE_TOOL_NAME}");
	});
});
