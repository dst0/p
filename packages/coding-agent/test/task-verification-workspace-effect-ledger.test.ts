import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Agent } from "@dst0/p-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const UNKNOWN_BASH_EFFECT = {
  kind: "unknown" as const,
  risk: "high" as const,
  domains: [] as const,
  source: "builtin" as const,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createRepository(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "p-evidence-ledger-"));
  temporaryDirectories.push(cwd);
  await mkdir(join(cwd, "docs"));
  await mkdir(join(cwd, "public"));
  await writeFile(join(cwd, "README.md"), "original\n");
  await writeFile(join(cwd, "docs/guide.md"), "old guide\n");
  await writeFile(join(cwd, "settings.json"), "{}\n");
  await writeFile(join(cwd, "public/logo.svg"), "<svg/>\n");
  await execFileAsync("git", ["init"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd });
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd });
  return cwd;
}

function toolCall(name: string, args: Record<string, unknown>) {
  return { type: "toolCall" as const, id: `${name}-${Math.random()}`, name, arguments: args };
}

async function runTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  between?: () => Promise<void>,
  effect?: typeof UNKNOWN_BASH_EFFECT,
): Promise<string> {
  const call = toolCall(name, args);
  const before = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect,
    context: {} as never,
  } as never);
  if (before?.block) throw new Error(before.reason ?? "blocked");
  await between?.();
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect,
    result: { content: [{ type: "text", text: "verified" }], details: undefined },
    isError: false,
    context: {} as never,
  } as never);
  return (result?.content ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
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
    .filter((part): part is Extract<(typeof result.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function beforeFinish(agent: Agent, args: Record<string, unknown>) {
  const call = toolCall("finish_work", args);
  return agent.beforeToolCall?.({ assistantMessage: {} as never, toolCall: call, args, context: {} as never });
}

function evidenceHandle(text: string): string {
  const handle = text.match(/Verification evidence handle: (verification-evidence-\d+)/u)?.[1];
  if (!handle) throw new Error(`missing evidence handle: ${text}`);
  return handle;
}

async function recordWorkspaceChecklist(controller: TaskVerificationController, taskText = "Update the workspace.") {
  controller.state.taskPrompts = [{ id: "user-1", text: taskText }];
  await callVerification(controller, {
    action: "record_completion_checklist",
    completion_checklist: ["The requested workspace update behaves correctly"],
  });
}

async function readyEvidenceTask(cwd: string, sessionManager = SessionManager.inMemory(cwd)) {
  const agent = new Agent();
  const controller = createTaskVerificationController(sessionManager, "evidence");
  controller.install(agent);
  await recordWorkspaceChecklist(controller);
  await writeFile(join(cwd, "README.md"), "pre-existing dirty change\n");
  await runTool(
    agent,
    "bash",
    { command: "node update-workspace.js" },
    async () => {
      await Promise.all([
        writeFile(join(cwd, "docs/guide.md"), "new guide\n"),
        writeFile(join(cwd, "settings.json"), '{"enabled":true}\n'),
        writeFile(join(cwd, "public/logo.svg"), "<svg><path/></svg>\n"),
      ]);
    },
    UNKNOWN_BASH_EFFECT,
  );
  const evidenceRef = evidenceHandle(
    await runTool(agent, "bash", { command: "node verify-workspace.js" }, undefined, UNKNOWN_BASH_EFFECT),
  );
  const ready = await callVerification(controller, {
    action: "ready_to_finish",
    unresolved_failures: [],
  });
  expect(controller.currentState.readiness?.acceptanceChecks[0]?.evidenceRefs).toContain(evidenceRef);
  return { agent, controller, ready, sessionManager };
}

describe("evidence-mode workspace effect ledger", () => {
  it("tracks actual task-owned docs, config, and assets without claiming pre-existing dirty files", async () => {
    const cwd = await createRepository();
    const { controller, ready } = await readyEvidenceTask(cwd);
    expect(controller.currentState.taskOwnedPaths).toEqual(["docs/guide.md", "public/logo.svg", "settings.json"]);
    expect(controller.currentState.taskOwnedPathOverflow).toBe(false);
    expect(controller.currentState.taskOwnedPathTrackingFailed).toBe(false);
    expect(controller.currentState.externalEffectReceipts).toEqual([]);
    expect(controller.currentState.readiness?.effectStateHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(ready).toContain("verification_token:");
  });

  it("requires exact files_changed and invalidates readiness when a recorded path changes", async () => {
    const cwd = await createRepository();
    const { agent, controller } = await readyEvidenceTask(cwd);
    const token = controller.currentState.readiness?.token;
    const exact = ["settings.json", "docs/guide.md", "public/logo.svg"];
    expect(
      (await beforeFinish(agent, { status: "success", verification_token: token, files_changed: exact }))?.block,
    ).not.toBe(true);
    expect(
      (await beforeFinish(agent, { status: "success", verification_token: token, files_changed: exact.slice(1) }))
        ?.block,
    ).toBe(true);
    expect(
      (
        await beforeFinish(agent, {
          status: "success",
          verification_token: token,
          files_changed: [...exact, "README.md"],
        })
      )?.block,
    ).toBe(true);
    await writeFile(join(cwd, "settings.json"), '{"enabled":false}\n');
    const changed = await beforeFinish(agent, { status: "success", verification_token: token, files_changed: exact });
    expect(changed?.block).toBe(true);
    expect(changed?.reason).toContain("task effect hash changed");
    expect(controller.currentState.readiness?.status).toBe("pending");
  });

  it("restores persisted evidence readiness with its workspace hash", async () => {
    const cwd = await createRepository();
    const sessionManager = SessionManager.inMemory(cwd);
    const initial = await readyEvidenceTask(cwd, sessionManager);
    const restoredAgent = new Agent();
    const restored = createTaskVerificationController(sessionManager, "evidence");
    restored.install(restoredAgent);
    expect(restored.restoreError).toBeUndefined();
    expect(restored.currentState.readiness).toEqual(initial.controller.currentState.readiness);
    const finish = await beforeFinish(restoredAgent, {
      status: "success",
      verification_token: restored.currentState.readiness?.token,
      files_changed: ["public/logo.svg", "settings.json", "docs/guide.md"],
    });
    expect(finish?.block).not.toBe(true);
  });

  it("tracks bounded non-Git docs, config, and assets through readiness and completion", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-evidence-non-git-"));
    temporaryDirectories.push(cwd);
    await mkdir(join(cwd, "docs"));
    await mkdir(join(cwd, "public"));
    await Promise.all([
      writeFile(join(cwd, "README.md"), "pre-existing state\n"),
      writeFile(join(cwd, "docs/guide.md"), "old guide\n"),
      writeFile(join(cwd, "settings.json"), "{}\n"),
      writeFile(join(cwd, "public/logo.svg"), "<svg/>\n"),
      writeFile(join(cwd, "public/logo-next.svg"), "<svg><path/></svg>\n"),
    ]);
    await symlink("logo.svg", join(cwd, "public/current-logo.svg"));
    const agent = new Agent();
    const controller = createTaskVerificationController(SessionManager.inMemory(cwd), "evidence");
    controller.install(agent);
    await recordWorkspaceChecklist(controller);
    await runTool(
      agent,
      "bash",
      { command: "node update-workspace.js" },
      async () => {
        await Promise.all([
          writeFile(join(cwd, "docs/guide.md"), "new guide\n"),
          writeFile(join(cwd, "settings.json"), '{"enabled":true}\n'),
          writeFile(join(cwd, "public/logo.svg"), "<svg><path/></svg>\n"),
          rm(join(cwd, "public/current-logo.svg")),
        ]);
        await symlink("logo-next.svg", join(cwd, "public/current-logo.svg"));
      },
      UNKNOWN_BASH_EFFECT,
    );
    const evidenceRef = evidenceHandle(
      await runTool(agent, "bash", { command: "node verify-workspace.js" }, undefined, UNKNOWN_BASH_EFFECT),
    );
    const ready = await callVerification(controller, {
      action: "ready_to_finish",
      unresolved_failures: [],
    });
    expect(controller.currentState.readiness?.acceptanceChecks[0]?.evidenceRefs).toContain(evidenceRef);
    const exact = ["settings.json", "docs/guide.md", "public/logo.svg", "public/current-logo.svg"];
    const token = controller.currentState.readiness?.token;
    expect(controller.currentState.taskOwnedPaths).toEqual([
      "docs/guide.md",
      "public/current-logo.svg",
      "public/logo.svg",
      "settings.json",
    ]);
    expect(controller.currentState.taskOwnedPathTrackingFailed).toBe(false);
    expect(controller.currentState.readiness?.effectStateHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(ready).toContain("verification_token:");
    expect(
      (await beforeFinish(agent, { status: "success", verification_token: token, files_changed: exact }))?.block,
    ).not.toBe(true);
    expect(
      (await beforeFinish(agent, { status: "success", verification_token: token, files_changed: exact.slice(1) }))
        ?.block,
    ).toBe(true);
    expect(
      (
        await beforeFinish(agent, {
          status: "success",
          verification_token: token,
          files_changed: [...exact, "README.md"],
        })
      )?.block,
    ).toBe(true);
    await rm(join(cwd, "public/current-logo.svg"));
    await symlink("logo.svg", join(cwd, "public/current-logo.svg"));
    const stale = await beforeFinish(agent, { status: "success", verification_token: token, files_changed: exact });
    expect(stale?.block).toBe(true);
    expect(stale?.reason).toContain("task effect hash changed");
    expect(controller.currentState.readiness?.status).toBe("pending");
  });

  it("rejects zero-exit requested-test evidence without a positive passing result", async () => {
    const cwd = await createRepository();
    const agent = new Agent();
    const controller = createTaskVerificationController(SessionManager.inMemory(cwd), "evidence");
    controller.install(agent);
    await recordWorkspaceChecklist(controller, "Update the guide and run tests.");
    await runTool(agent, "write", { path: "docs/guide.md", content: "updated\n" }, () =>
      writeFile(join(cwd, "docs/guide.md"), "updated\n"),
    );
    const evidenceRef = evidenceHandle(await runTool(agent, "bash", { command: "npm test" }, undefined));
    expect(controller.evidence.get(evidenceRef)?.testOutcome).toBe("unconfirmed");
    const ready = await callVerification(controller, {
      action: "ready_to_finish",
      unresolved_failures: [],
    });
    expect(ready).toContain("no successful current-revision test evidence is available");
    expect(ready).not.toContain("verification_token:");
    expect(controller.currentState.readiness?.status).not.toBe("completion_ready");
  });
});
