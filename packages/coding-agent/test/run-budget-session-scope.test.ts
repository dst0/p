import { agentLoop } from "@dst0/p-agent-core";
import {
  type AssistantMessage,
  completeSimple,
  createAssistantMessageEventStream,
  type Message,
  type Model,
  registerApiProvider,
  unregisterApiProviders,
} from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { SessionRunBudget } from "../src/core/run-budget/session-run-budget.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const model: Model<"budget-scope"> = {
  id: "scope",
  name: "scope",
  api: "budget-scope",
  provider: "budget-scope",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  maxTokens: 100,
  contextWindow: 1000,
};
afterEach(() => unregisterApiProviders("budget-scope"));

function installProvider(finalCall: number) {
  let calls = 0;
  const dispatch = () => {
    calls++;
    const message: AssistantMessage = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [{ type: "text", text: `Distinct output segment ${calls}` }],
      stopReason: calls >= finalCall ? "stop" : "length",
      timestamp: Date.now(),
      usage: {
        input: 2,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0.000002, output: 0.000001, cacheRead: 0, cacheWrite: 0, total: 0.000003 },
      },
    };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: "done", reason: message.stopReason === "length" ? "length" : "stop", message });
      stream.end();
    });
    return stream;
  };
  registerApiProvider({ api: model.api, stream: dispatch, streamSimple: dispatch }, "budget-scope");
  return () => calls;
}

describe("session model budget scope", () => {
  it.each(["tokens", "usd"] as const)(
    "persists and resumes a %s threshold across real session files and switches",
    async (unit) => {
      const root = mkdtempSync(join(tmpdir(), "p-budget-resume-"));
      try {
        const calls = installProvider(1);
        const manager = SessionManager.create(root, join(root, "sessions"));
        const budget = new SessionRunBudget(manager, {
          runBudget: { mode: "limited", unit, limit: unit === "tokens" ? 2 : 0.000002 },
        });
        const message = await budget.run(() => completeSimple(model, { messages: [] }));
        manager.appendMessage(message);
        const path = manager.getSessionFile();
        if (!path) throw new Error("Expected persisted session");
        const before = budget.snapshot();
        const resumed = new SessionRunBudget(SessionManager.open(path, manager.getSessionDir()), {
          defaultRunBudget: { mode: "unlimited" },
        });
        expect(resumed.snapshot()).toEqual(before);
        expect((await resumed.run(() => completeSimple(model, { messages: [] }))).errorMessage).toMatch(
          /^budget_exhausted:/,
        );
        expect(calls()).toBe(1);
        manager.newSession();
        expect(budget.snapshot().requests).toBe(0);
        manager.setSessionFile(path);
        expect(budget.snapshot()).toEqual(before);
        resumed.setPolicy({ mode: "unlimited" });
        expect(budget.policy).toEqual({ mode: "unlimited" });
        await budget.run(() => completeSimple(model, { messages: [] }));
        expect(resumed.snapshot().requests).toBe(2);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["tokens", "usd"] as const)(
    "blocks concurrent unresolved %s spend but admits again after settlement",
    async (unit) => {
      const calls = installProvider(1);
      const budget = new SessionRunBudget(SessionManager.inMemory(), {
        runBudget: { mode: "limited", unit, limit: unit === "tokens" ? 100 : 1 },
      });
      const [first, second] = await budget.run(() =>
        Promise.all([completeSimple(model, { messages: [] }), completeSimple(model, { messages: [] })]),
      );
      expect(first.stopReason).toBe("stop");
      expect(second.errorMessage).toMatch(/^budget_uncertain:/);
      expect(calls()).toBe(1);
      expect(budget.snapshot()).toMatchObject({ pending: 0, status: "ready" });
      expect((await budget.run(() => completeSimple(model, { messages: [] }))).stopReason).toBe("stop");
      expect(calls()).toBe(2);
    },
  );
  it("retains extension-initialization spend across two controllers for one in-memory session", async () => {
    const calls = installProvider(1);
    const manager = SessionManager.inMemory();
    const startup = new SessionRunBudget(manager, {
      defaultRunBudget: { mode: "limited", unit: "requests", limit: 1 },
    });
    await startup.run(() => completeSimple(model, { messages: [] }));
    const session = new SessionRunBudget(manager);
    expect(session.snapshot()).toMatchObject({ requests: 1, status: "exhausted" });
    expect((await session.run(() => completeSimple(model, { messages: [] }))).errorMessage).toMatch(
      /^budget_exhausted:/,
    );
    expect(calls()).toBe(1);
    session.setPolicy({ mode: "unlimited" });
    expect(startup.policy).toEqual({ mode: "unlimited" });
    manager.newSession();
    expect(startup.snapshot()).toMatchObject({ requests: 0, policy: { mode: "unlimited" } });
  });
  it("stops provider-length continuation exactly at the explicit request limit", async () => {
    const calls = installProvider(20);
    const budget = new SessionRunBudget(SessionManager.inMemory(), {
      runBudget: { mode: "limited", unit: "requests", limit: 4 },
    });
    const messages = await budget.run(async () => {
      const stream = agentLoop(
        [{ role: "user", content: "Complete a multi-segment analysis", timestamp: 0 }],
        { systemPrompt: "", messages: [], tools: [] },
        { model, completionMode: "implicit", convertToLlm: (items) => items as Message[] },
      );
      for await (const _event of stream) {
        /* Drain the real agent loop. */
      }
      return stream.result();
    });
    expect(calls()).toBe(4);
    expect(budget.snapshot()).toMatchObject({ requests: 4, tokens: 12, pending: 0, status: "exhausted" });
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "error",
      errorMessage: expect.stringContaining("budget_exhausted"),
    });
  });

  it("retains Unlimited continuation and allows a valid finish on the last budgeted call", async () => {
    const calls = installProvider(7);
    const budget = new SessionRunBudget(SessionManager.inMemory());
    const result = await budget.run(async () => {
      for (let index = 0; index < 6; index++) await completeSimple(model, { messages: [] });
      budget.setPolicy({ mode: "limited", unit: "requests", limit: 7 });
      return completeSimple(model, { messages: [] });
    });
    expect(calls()).toBe(7);
    expect(result.stopReason).toBe("stop");
    expect(budget.snapshot().requests).toBe(7);
  });

  it("isolates concurrent sessions, auxiliary direct calls, and unscoped background work", async () => {
    const calls = installProvider(1);
    const first = new SessionRunBudget(SessionManager.inMemory(), {
      runBudget: { mode: "limited", unit: "requests", limit: 1 },
    });
    const second = new SessionRunBudget(SessionManager.inMemory(), {
      runBudget: { mode: "limited", unit: "requests", limit: 2 },
    });
    await Promise.all([
      first.run(() => completeSimple(model, { messages: [] })),
      second.run(async () => {
        await completeSimple(model, { messages: [] });
        await completeSimple(model, { messages: [] });
      }),
    ]);
    await completeSimple(model, { messages: [] });
    expect(first.snapshot().requests).toBe(1);
    expect(second.snapshot().requests).toBe(2);
    expect(calls()).toBe(4);
    expect((await first.run(() => completeSimple(model, { messages: [] }))).stopReason).toBe("error");
    expect(calls()).toBe(4);
  });

  it("preserves spend until an explicit new session", async () => {
    installProvider(1);
    const manager = SessionManager.inMemory();
    const budget = new SessionRunBudget(manager, { runBudget: { mode: "limited", unit: "requests", limit: 1 } });
    await budget.run(() => completeSimple(model, { messages: [] }));
    const originalScope = budget.snapshot().scopeId;
    manager.newSession();
    expect(budget.snapshot()).toMatchObject({ requests: 0, status: "ready" });
    expect(budget.snapshot().scopeId).not.toBe(originalScope);
    await budget.run(() => completeSimple(model, { messages: [] }));
    expect(budget.snapshot().requests).toBe(1);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
