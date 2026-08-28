import { execFileSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { isConfidentlyReadOnlyShellTool } from "../src/core/task-verification/tool-classification.ts";
import {
  beforeAuditTool,
  callTaskVerification,
  createRequirementAuditHarness,
} from "./task-requirement-audit-test-harness.ts";

async function initializeGitWorkspace(prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(cwd, "README.md"), "fixture\n");
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.name", "P Test"], { cwd });
  execFileSync("git", ["config", "user.email", "p-test@example.invalid"], { cwd });
  execFileSync("git", ["add", "README.md"], { cwd });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd });
  return cwd;
}

describe("read-only shell verification integration", () => {
  it.each([
    ["file --compile magic", false],
    ["file -C magic", false],
    ["file -b sample.bin", true],
    ["diff --output=result.patch before after", false],
    ["diff --output result.patch before after", false],
    ["diff -u before after", true],
  ] as const)("classifies %s as read-only=%s", (command, expected) => {
    expect(isConfidentlyReadOnlyShellTool("bash", { command })).toBe(expected);
  });

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

  it("does not treat the runtime-owned session log as a workspace mutation", async () => {
    const cwd = await initializeGitWorkspace("p-session-log-fingerprint-");
    try {
      const sessionDir = join(cwd, "sessions");
      await mkdir(sessionDir);
      const sessionFile = join(sessionDir, "runtime[1].jsonl");
      await writeFile(sessionFile, "");
      await mkdir(join(cwd, ".pdev"));
      const runtimeStateFile = join(cwd, ".pdev", "state.json");
      await writeFile(runtimeStateFile, "before\n");
      const sessionManager = SessionManager.create(cwd, sessionDir);
      sessionManager.setSessionFile(sessionFile);
      sessionManager.appendCustomEntry("runtime-progress", { phase: "before" });
      const harness = createRequirementAuditHarness(sessionManager);
      const args = { command: "python3 -c 'print(\"ALL CHECKS PASSED\")'" };
      const toolCall = {
        type: "toolCall" as const,
        id: "read-only-runtime-assertion",
        name: "bash",
        arguments: args,
      };

      await harness.agent.beforeToolCall?.({
        assistantMessage: {} as never,
        toolCall,
        args,
        context: {} as never,
      });
      await appendFile(sessionFile, '{"type":"runtime-progress","phase":"during"}\n');
      await writeFile(runtimeStateFile, "during\n");
      await harness.agent.afterToolCall?.({
        assistantMessage: {} as never,
        toolCall,
        args,
        result: { content: [{ type: "text", text: "ALL CHECKS PASSED" }], details: undefined },
        isError: false,
        context: {} as never,
      });

      expect(harness.controller.currentState.mutationRevision).toBe(0);
      expect([...harness.controller.evidence.values()]).toHaveLength(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not let session-path metacharacters mask a user workspace mutation", async () => {
    const cwd = await initializeGitWorkspace("p-session-literal-fingerprint-");
    try {
      const sessionDir = join(cwd, "sessions");
      await mkdir(sessionDir);
      const sessionFile = join(sessionDir, "runtime*.jsonl");
      await writeFile(sessionFile, "runtime\n");
      const sessionManager = SessionManager.create(cwd, sessionDir);
      sessionManager.setSessionFile(sessionFile);
      const harness = createRequirementAuditHarness(sessionManager);
      const args = { command: "python3 -c 'print(\"ALL CHECKS PASSED\")'" };
      const toolCall = {
        type: "toolCall" as const,
        id: "literal-session-path-assertion",
        name: "bash",
        arguments: args,
      };

      await harness.agent.beforeToolCall?.({
        assistantMessage: {} as never,
        toolCall,
        args,
        context: {} as never,
      });
      await appendFile(sessionFile, "runtime-progress\n");
      await writeFile(join(sessionDir, "runtime-user.jsonl"), "user artifact\n");
      await harness.agent.afterToolCall?.({
        assistantMessage: {} as never,
        toolCall,
        args,
        result: { content: [{ type: "text", text: "ALL CHECKS PASSED" }], details: undefined },
        isError: false,
        context: {} as never,
      });

      expect(harness.controller.currentState.mutationRevision).toBe(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
