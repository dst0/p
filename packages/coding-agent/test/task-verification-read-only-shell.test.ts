import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  beforeAuditTool,
  callTaskVerification,
  createRequirementAuditHarness,
} from "./task-requirement-audit-test-harness.ts";

describe("read-only shell verification integration", () => {
  it("skips workspace snapshots for confidently read-only commands", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-read-only-shell-gate-"));
    try {
      const harness = createRequirementAuditHarness(SessionManager.inMemory(cwd));
      await callTaskVerification(harness.controller, {
        action: "declare_task",
        task_kind: "bug_fix",
        task_summary: "Fix read-only shell passthrough",
      });
      const commands = [
        "ls /tmp",
        "git log --oneline -5",
        "git status",
        "git diff",
        "git show HEAD",
        "find . -name '*.ts' | head",
        "grep 'foo' src/foo.ts",
        "cat README.md",
        "head -50 src/main.ts",
        "tail -20 src/main.ts",
        "curl -s https://example.com/api/status",
        "echo hello",
        "pwd",
      ];

      for (const toolName of ["bash", "ctx_shell"]) {
        for (const command of commands) {
          expect((await beforeAuditTool(harness.agent, toolName, { command }))?.block).not.toBe(true);
        }
      }
      expect(harness.controller.bashFingerprints.size).toBe(6);
      expect(harness.controller.workspaceTestSnapshots.size).toBe(6);
      expect((await beforeAuditTool(harness.agent, "edit", { path: "src/main.ts", edits: [] }))?.block).toBe(true);
      expect((await beforeAuditTool(harness.agent, "write", { path: "config.json", content: "" }))?.block).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("snapshots find output actions that can write files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-find-output-gate-"));
    try {
      const harness = createRequirementAuditHarness(SessionManager.inMemory(cwd));
      const args = { command: "find . -fprint generated.ts" };
      const toolCall = {
        type: "toolCall" as const,
        id: "find-fprint-write",
        name: "bash",
        arguments: args,
      };

      await harness.agent.beforeToolCall?.({
        assistantMessage: {} as never,
        toolCall,
        args,
        context: {} as never,
      });
      expect(harness.controller.bashFingerprints.has(toolCall.id)).toBe(true);
      await writeFile(join(cwd, "generated.ts"), "export const generated = true;\n");
      await harness.agent.afterToolCall?.({
        assistantMessage: {} as never,
        toolCall,
        args,
        result: { content: [{ type: "text", text: "ok" }], details: undefined },
        isError: false,
        context: {} as never,
      });

      expect(harness.controller.currentState.mutationRevision).toBe(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
