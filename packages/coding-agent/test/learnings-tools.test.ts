import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LearningsStore } from "../src/core/learnings/learnings-store.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";
import {
  allToolNames,
  createAllToolDefinitions,
  createAllTools,
  createRecallLearningsTool,
  createRecallLearningsToolDefinition,
  createRecordLearningTool,
  createRecordLearningToolDefinition,
  createTool,
  createToolDefinition,
} from "../src/core/tools/index.ts";

describe("Learnings Tools & Prompt Integration", () => {
  let tempCwd: string;

  beforeEach(() => {
    tempCwd = join(tmpdir(), `p-test-learnings-tools-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(tempCwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempCwd, { recursive: true, force: true });
  });

  it("record_learning tool records entries successfully", async () => {
    const store = new LearningsStore({ cwd: tempCwd });
    const toolDef = createRecordLearningToolDefinition(tempCwd, store);

    expect(toolDef.name).toBe("record_learning");
    expect(toolDef.promptSnippet).toBeDefined();

    const result = await toolDef.execute(
      "call-1",
      {
        trap: "Forgot to mock timer in Vitest",
        fix: "Call vi.useFakeTimers() before the timer starts",
        rule: "Always use fake timers when testing intervals",
        tags: ["vitest", "timers"],
        scope: "project",
      },
      undefined,
      undefined,
      {} as any,
    );

    const firstContent = result.content[0] as { type: "text"; text: string };
    expect(firstContent.type).toBe("text");
    expect(firstContent.text).toContain("Recorded learning for continuous learning memory:");
    expect(firstContent.text).toContain("Always use fake timers when testing intervals");
    expect(result.details.entry?.rule).toBe("Always use fake timers when testing intervals");

    const entries = store.loadAll();
    expect(entries).toHaveLength(1);
  });

  it("recall_learnings tool searches and returns matched learnings", async () => {
    const store = new LearningsStore({ cwd: tempCwd });
    store.record({
      trap: "Uncaught rejection in promise loop",
      fix: "Use Promise.allSettled instead of Promise.all",
      rule: "Use Promise.allSettled for resilient batching",
      tags: ["async", "promises"],
    });

    const toolDef = createRecallLearningsToolDefinition(tempCwd, store);
    expect(toolDef.name).toBe("recall_learnings");

    // Found match
    const matchResult = await toolDef.execute(
      "call-2",
      {
        query: "batching promises rejection",
        tags: ["async"],
        limit: 3,
      },
      undefined,
      undefined,
      {} as any,
    );

    const matchText = (matchResult.content[0] as { type: "text"; text: string }).text;
    expect(matchText).toContain("Found 1 relevant learning(s):");
    expect(matchText).toContain("Use Promise.allSettled for resilient batching");
    expect(matchResult.details.count).toBe(1);

    // No match
    const noMatchResult = await toolDef.execute(
      "call-3",
      {
        query: "completely unrelated query zyxwvu",
      },
      undefined,
      undefined,
      {} as any,
    );
    const noMatchText = (noMatchResult.content[0] as { type: "text"; text: string }).text;
    expect(noMatchText).toContain("No relevant learnings found");
    expect(noMatchResult.details.count).toBe(0);
  });

  it("tool factories create wrappers correctly", () => {
    const recordTool = createRecordLearningTool(tempCwd);
    expect(recordTool.name).toBe("record_learning");

    const recallTool = createRecallLearningsTool(tempCwd);
    expect(recallTool.name).toBe("recall_learnings");

    expect(allToolNames.has("record_learning")).toBe(true);
    expect(allToolNames.has("recall_learnings")).toBe(true);

    const toolDef1 = createToolDefinition("record_learning", tempCwd);
    const toolDef2 = createToolDefinition("recall_learnings", tempCwd);
    expect(toolDef1.name).toBe("record_learning");
    expect(toolDef2.name).toBe("recall_learnings");

    const tool1 = createTool("record_learning", tempCwd);
    const tool2 = createTool("recall_learnings", tempCwd);
    expect(tool1.name).toBe("record_learning");
    expect(tool2.name).toBe("recall_learnings");

    const allDefs = createAllToolDefinitions(tempCwd);
    expect(allDefs.record_learning).toBeDefined();
    expect(allDefs.recall_learnings).toBeDefined();

    const allTools = createAllTools(tempCwd);
    expect(allTools.record_learning).toBeDefined();
    expect(allTools.recall_learnings).toBeDefined();
  });

  it("buildSystemPrompt automatically injects Project Learnings when available", () => {
    // 1. Without learnings
    const promptWithout = buildSystemPrompt({ cwd: tempCwd });
    expect(promptWithout).not.toContain("Project Learnings:");

    // 2. With learnings recorded
    const store = new LearningsStore({ cwd: tempCwd });
    store.record({
      trap: "Deadlock in sqlite mutex",
      fix: "Set busy_timeout = 5000",
      rule: "Always set busy_timeout on sqlite connections",
      tags: ["sqlite", "database"],
    });

    const promptWith = buildSystemPrompt({ cwd: tempCwd });
    expect(promptWith).toContain("Project Learnings:");
    expect(promptWith).toContain("Always set busy_timeout on sqlite connections");
    expect(promptWith).toContain("Trap: Deadlock in sqlite mutex -> Fix: Set busy_timeout = 5000");

    // 3. With customPrompt
    const customPromptWith = buildSystemPrompt({
      cwd: tempCwd,
      customPrompt: "Custom prompt base",
    });
    expect(customPromptWith).toContain("Custom prompt base");
    expect(customPromptWith).toContain("Project Learnings:");
    expect(customPromptWith).toContain("Always set busy_timeout on sqlite connections");
  });
});
