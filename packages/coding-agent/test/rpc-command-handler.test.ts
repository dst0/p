import type { ThinkingLevel } from "@dst0/p-agent-core";
import { getModel } from "@dst0/p-ai";
import { describe, expect, test, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { handleRpcCommand } from "../src/modes/rpc/rpc-mode/rpc-command-handler.ts";
import type { RpcCommand, RpcResponse } from "../src/modes/rpc/rpc-types.ts";

function createHarness() {
  const model = getModel("anthropic", "claude-sonnet-4-5");
  if (!model) throw new Error("Expected Anthropic test model");

  const session = {
    model,
    thinkingLevel: "medium" as ThinkingLevel,
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all" as const,
    followUpMode: "one-at-a-time" as const,
    sessionFile: "/tmp/session.jsonl",
    sessionId: "session-id",
    sessionName: "Session",
    autoCompactionEnabled: true,
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }],
    pendingMessageCount: 2,
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    modelRegistry: { getAvailable: vi.fn(async () => [model]) },
    setModel: vi.fn(async () => {}),
    cycleModel: vi.fn(
      async (): Promise<{ model: typeof model; thinkingLevel: ThinkingLevel; isScoped: boolean } | undefined> => ({
        model,
        thinkingLevel: "medium" as ThinkingLevel,
        isScoped: true,
      }),
    ),
    setThinkingLevel: vi.fn(),
    cycleThinkingLevel: vi.fn((): ThinkingLevel | undefined => "high"),
    setSteeringMode: vi.fn(),
    setFollowUpMode: vi.fn(),
    compact: vi.fn(async () => ({ summary: "summary", firstKeptEntryId: "entry", tokensBefore: 10 })),
    setAutoCompactionEnabled: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    abortRetry: vi.fn(),
    executeBash: vi.fn(async () => ({ output: "ok", exitCode: 0, cancelled: false, truncated: false })),
    abortBash: vi.fn(),
    getSessionStats: vi.fn(() => ({ sessionId: "session-id" })),
    exportToHtml: vi.fn(async () => "/tmp/export.html"),
    sessionManager: { getLeafId: vi.fn((): string | undefined => "leaf-id") },
    getUserMessagesForForking: vi.fn(() => [{ entryId: "entry", text: "hello" }]),
    getLastAssistantText: vi.fn(() => "answer"),
    setSessionName: vi.fn(),
    extensionRunner: {
      getRegisteredCommands: vi.fn(() => [
        { invocationName: "extension", description: "Extension", sourceInfo: { path: "extension.ts" } },
      ]),
    },
    promptTemplates: [{ name: "prompt", description: "Prompt", sourceInfo: { path: "prompt.md" } }],
    resourceLoader: {
      getSkills: vi.fn(() => ({
        skills: [{ name: "review", description: "Review", sourceInfo: { path: "SKILL.md" } }],
      })),
    },
  };
  const runtimeHost = {
    session,
    newSession: vi.fn(async () => ({ cancelled: false })),
    switchSession: vi.fn(async () => ({ cancelled: false })),
    fork: vi.fn(async () => ({ cancelled: false, selectedText: "selected" })),
  } as unknown as AgentSessionRuntime;
  const rebindSession = vi.fn(async () => {});

  return { model, rebindSession, runtimeHost, session };
}

async function run(
  harness: ReturnType<typeof createHarness>,
  command: RpcCommand | { id?: string; type: string },
): Promise<RpcResponse | undefined> {
  return handleRpcCommand(
    { output: vi.fn(), rebindSession: harness.rebindSession, runtimeHost: harness.runtimeHost },
    command as RpcCommand,
  );
}

describe("RPC command handler", () => {
  test("executes state, model, queue, compaction, retry, bash, and message commands", async () => {
    const harness = createHarness();
    const commands: RpcCommand[] = [
      { id: "1", type: "steer", message: "steer" },
      { id: "2", type: "follow_up", message: "follow" },
      { id: "3", type: "abort" },
      { id: "4", type: "get_state" },
      { id: "5", type: "set_model", provider: harness.model.provider, modelId: harness.model.id },
      { id: "6", type: "cycle_model" },
      { id: "7", type: "get_available_models" },
      { id: "8", type: "set_thinking_level", level: "high" },
      { id: "9", type: "cycle_thinking_level" },
      { id: "10", type: "set_steering_mode", mode: "one-at-a-time" },
      { id: "11", type: "set_follow_up_mode", mode: "all" },
      { id: "12", type: "compact", customInstructions: "compact" },
      { id: "13", type: "set_auto_compaction", enabled: false },
      { id: "14", type: "set_auto_retry", enabled: false },
      { id: "15", type: "abort_retry" },
      { id: "16", type: "bash", command: "echo ok", excludeFromContext: true },
      { id: "17", type: "abort_bash" },
      { id: "18", type: "get_session_stats" },
      { id: "19", type: "export_html", outputPath: "/tmp/export.html" },
      { id: "20", type: "get_fork_messages" },
      { id: "21", type: "get_last_assistant_text" },
      { id: "22", type: "set_session_name", name: " Renamed " },
      { id: "23", type: "get_messages" },
      { id: "24", type: "get_commands" },
    ];

    const responses = await Promise.all(commands.map((command) => run(harness, command)));

    expect(responses.every((response) => response?.success === true)).toBe(true);
    expect(responses[3]).toMatchObject({ data: { messageCount: 1, pendingMessageCount: 2 } });
    expect(responses[23]).toMatchObject({
      data: {
        commands: [
          { name: "extension", source: "extension" },
          { name: "prompt", source: "prompt" },
          { name: "skill:review", source: "skill" },
        ],
      },
    });
    expect(harness.session.setSessionName).toHaveBeenCalledWith("Renamed");
    expect(harness.session.executeBash).toHaveBeenCalledWith("echo ok", undefined, { excludeFromContext: true });
  });

  test("rebinds successful session changes and preserves cancellation results", async () => {
    const harness = createHarness();

    expect(await run(harness, { id: "new", type: "new_session", parentSession: "parent" })).toMatchObject({
      success: true,
      data: { cancelled: false },
    });
    expect(await run(harness, { id: "switch", type: "switch_session", sessionPath: "/tmp/session" })).toMatchObject({
      success: true,
      data: { cancelled: false },
    });
    expect(await run(harness, { id: "fork", type: "fork", entryId: "entry" })).toMatchObject({
      success: true,
      data: { text: "selected", cancelled: false },
    });
    expect(await run(harness, { id: "clone", type: "clone" })).toMatchObject({
      success: true,
      data: { cancelled: false },
    });
    expect(harness.rebindSession).toHaveBeenCalledTimes(4);

    harness.runtimeHost.newSession = vi.fn(async () => ({ cancelled: true }));
    harness.runtimeHost.switchSession = vi.fn(async () => ({ cancelled: true }));
    harness.runtimeHost.fork = vi.fn(async () => ({ cancelled: true, selectedText: "" }));
    await run(harness, { type: "new_session" });
    await run(harness, { type: "switch_session", sessionPath: "/tmp/session" });
    await run(harness, { type: "fork", entryId: "entry" });
    expect(harness.rebindSession).toHaveBeenCalledTimes(4);
  });

  test("returns errors and nullable cycle results for rejected commands", async () => {
    const harness = createHarness();
    harness.session.modelRegistry.getAvailable.mockResolvedValue([]);
    harness.session.cycleModel.mockResolvedValue(undefined);
    harness.session.cycleThinkingLevel.mockReturnValue(undefined);

    expect(await run(harness, { type: "set_model", provider: "missing", modelId: "missing" })).toMatchObject({
      success: false,
      error: "Model not found: missing/missing",
    });
    expect(await run(harness, { type: "cycle_model" })).toMatchObject({ success: true, data: null });
    expect(await run(harness, { type: "cycle_thinking_level" })).toMatchObject({ success: true, data: null });
    expect(await run(harness, { type: "set_session_name", name: "  " })).toMatchObject({
      success: false,
      error: "Session name cannot be empty",
    });
    harness.session.sessionManager.getLeafId.mockReturnValue(undefined);
    expect(await run(harness, { type: "clone" })).toMatchObject({
      success: false,
      error: "Cannot clone session: no current entry selected",
    });
    expect(await run(harness, { id: "unknown", type: "future_command" })).toEqual({
      id: undefined,
      type: "response",
      command: "future_command",
      success: false,
      error: "Unknown command: future_command",
    });
  });
});
