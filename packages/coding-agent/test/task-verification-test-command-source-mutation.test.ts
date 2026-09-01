import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Agent } from "@dst0/p-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const BUILTIN_READ_EFFECT = {
  kind: "read" as const,
  risk: "normal" as const,
  domains: [] as const,
  source: "builtin" as const,
};
const BUILTIN_WRITE_EFFECT = {
  kind: "workspace_write" as const,
  risk: "normal" as const,
  domains: [] as const,
  source: "builtin" as const,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("evidence-mode test command source mutations", () => {
  it("records an unexpected pre-checklist test mutation and gates the next write", async () => {
    const cwd = await createRepository();
    const agent = new Agent();
    const controller = createTaskVerificationController(SessionManager.inMemory(cwd), "evidence");
    controller.install(agent);
    controller.state.taskPrompts = [{ id: "user-1", text: "Update the store behavior." }];

    await runTool(agent, "bash", { command: "npm test -- test/store.test.ts" }, BUILTIN_READ_EFFECT, () =>
      writeFile(join(cwd, "src/store.ts"), "export const value = 2;\n"),
    );

    expect(controller.currentState.mutationRevision).toBe(1);
    expect(controller.currentState.taskOwnedPaths).toEqual(["src/store.ts"]);
    const nextWrite = await beforeTool(
      agent,
      "write",
      { path: "docs/guide.md", content: "updated\n" },
      BUILTIN_WRITE_EFFECT,
    );
    expect(nextWrite?.block).toBe(true);
    expect(nextWrite?.reason).toContain("record one completion checklist");
  });

  it("tracks a passing read-like npm test that changes production source and invalidates readiness", async () => {
    const cwd = await createRepository();
    const agent = new Agent();
    const controller = createTaskVerificationController(SessionManager.inMemory(cwd), "evidence");
    controller.install(agent);
    controller.state.taskPrompts = [{ id: "user-1", text: "Update the store behavior." }];
    await recordChecklist(controller);

    await runTool(agent, "write", { path: "docs/guide.md", content: "updated\n" }, BUILTIN_WRITE_EFFECT, () =>
      writeFile(join(cwd, "docs/guide.md"), "updated\n"),
    );
    const verification = await runTool(
      agent,
      "bash",
      { command: "npm test -- test/store.test.ts" },
      BUILTIN_READ_EFFECT,
    );
    const evidenceRef = verification.match(/Verification evidence handle: (verification-evidence-\d+)/u)?.[1];
    expect(evidenceRef).toBeDefined();
    expect(
      await callVerification(controller, {
        action: "ready_to_finish",
        evidence_refs_by_check: [[evidenceRef]],
        unresolved_failures: [],
      }),
    ).toContain("verification_token:");

    const mutation = await runTool(
      agent,
      "bash",
      { command: "npx npm test -- test/store.test.ts" },
      BUILTIN_READ_EFFECT,
      () => writeFile(join(cwd, "src/store.ts"), "export const value = 2;\n"),
    );

    expect(mutation).toContain("test-like read command changed workspace source files");
    expect(mutation).not.toContain("Verification evidence handle:");
    expect(controller.currentState.mutationRevision).toBe(2);
    expect(controller.currentState.taskOwnedPaths).toEqual(["docs/guide.md", "src/store.ts"]);
    expect(controller.currentState.readiness?.status).toBe("pending");
  });
});

async function createRepository(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "p-test-command-source-mutation-"));
  temporaryDirectories.push(cwd);
  await mkdir(join(cwd, "docs"));
  await mkdir(join(cwd, "src"));
  await writeFile(join(cwd, "docs/guide.md"), "original\n");
  await writeFile(join(cwd, "src/store.ts"), "export const value = 1;\n");
  await execFileAsync("git", ["init", "-q"], { cwd });
  await execFileAsync("git", ["config", "maintenance.auto", "false"], { cwd });
  await execFileAsync("git", ["config", "gc.auto", "0"], { cwd });
  await execFileAsync("git", ["config", "gc.autoDetach", "false"], { cwd });
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"],
    { cwd },
  );
  return cwd;
}

async function recordChecklist(controller: TaskVerificationController): Promise<void> {
  await callVerification(controller, {
    action: "record_completion_checklist",
    completion_checklist: ["The store returns the updated value"],
  });
}

async function callVerification(
  controller: TaskVerificationController,
  params: Record<string, unknown>,
): Promise<string> {
  const result = await controller.toolDefinition.execute(
    "verification-call",
    params as never,
    undefined,
    undefined,
    {} as never,
  );
  return result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function runTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  effect: typeof BUILTIN_READ_EFFECT | typeof BUILTIN_WRITE_EFFECT,
  between?: () => Promise<void>,
): Promise<string> {
  const call = { type: "toolCall" as const, id: `${name}-${Math.random()}`, name, arguments: args };
  const before = await beforeTool(agent, name, args, effect, call);
  if (before?.block) throw new Error(before.reason ?? "blocked");
  await between?.();
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect,
    result: { content: [{ type: "text", text: "Tests 1 passed (1)" }], details: undefined },
    isError: false,
    context: {} as never,
  });
  return (result?.content ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function beforeTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  effect: typeof BUILTIN_READ_EFFECT | typeof BUILTIN_WRITE_EFFECT,
  call = { type: "toolCall" as const, id: `${name}-${Math.random()}`, name, arguments: args },
) {
  return agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect,
    context: {} as never,
  });
}
