import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LearningsDistiller } from "../src/core/learnings/learnings-distiller.ts";
import { LearningsStore } from "../src/core/learnings/learnings-store.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";
import {
  createRecallLearningsToolDefinition,
  createRecordLearningToolDefinition,
} from "../src/core/tools/learnings.ts";

describe("Continuous Learnings System", () => {
  let tempCwd: string;
  let tempGlobal: string;

  beforeEach(() => {
    tempCwd = join(tmpdir(), `p-learnings-main-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    tempGlobal = join(tmpdir(), `p-learnings-global-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(tempCwd, { recursive: true });
    mkdirSync(tempGlobal, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempCwd, { recursive: true, force: true });
    rmSync(tempGlobal, { recursive: true, force: true });
  });

  it("records learnings, queries with scoring, and handles corrupted JSON lines", async () => {
    const store = new LearningsStore({ cwd: tempCwd, globalDir: tempGlobal });

    // 1. Record project learning
    const entry1 = store.record({
      trap: "Uncaught rejection in fetch handler",
      fix: "Add response.ok check and try-catch around body json() call",
      rule: "Always validate response.ok and wrap json() deserialization",
      tags: ["fetch", "network", "error-handling"],
    });
    expect(entry1.timestamp).toBeDefined();

    // 2. Record global learning
    const entry2 = store.record(
      {
        trap: "OOM when buffering huge stream in memory",
        fix: "Pipe stream directly to disk with pipeline()",
        rule: "Stream large responses directly to filesystem",
        tags: ["stream", "memory", "node"],
      },
      "global",
    );
    expect(entry2.timestamp).toBeDefined();

    // 3. Query with tags & text scoring
    const matches = store.query({
      queryText: "huge stream memory buffer",
      tags: ["memory"],
      limit: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].entry.rule).toBe("Stream large responses directly to filesystem");
    expect(matches[0].matchedTags).toContain("memory");

    // 4. Fault tolerance: inject invalid line into project file
    const projectPath = store.getProjectFilePath();
    const currentLines = readFileSync(projectPath, "utf8");
    writeFileSync(projectPath, `${currentLines}\n{invalid-json\n\n`, "utf8");

    const loaded = store.loadAll("project");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].rule).toBe(entry1.rule);
  });

  it("tools execute properly and interact with store", async () => {
    const store = new LearningsStore({ cwd: tempCwd, globalDir: tempGlobal });
    const recordTool = createRecordLearningToolDefinition(tempCwd, store);
    const recallTool = createRecallLearningsToolDefinition(tempCwd, store);

    // Record via tool
    const recordRes = await recordTool.execute(
      "t1",
      {
        trap: "Stale closure in React useEffect",
        fix: "Add missing dependencies or use functional state updater",
        rule: "Include all referenced state in useEffect dependency array",
        tags: ["react", "hooks"],
      },
      undefined,
      undefined,
      {} as any,
    );
    expect(recordRes.details.entry?.rule).toContain("useEffect");

    // Recall via tool
    const recallRes = await recallTool.execute(
      "t2",
      {
        query: "react hook closure",
        tags: ["react"],
      },
      undefined,
      undefined,
      {} as any,
    );
    const recallText = (recallRes.content[0] as { type: "text"; text: string }).text;
    expect(recallText).toContain("Found 1 relevant learning(s):");
    expect(recallText).toContain("useEffect dependency array");
  });

  it("auto-recalls project learnings into system prompt", () => {
    const store = new LearningsStore({ cwd: tempCwd, globalDir: tempGlobal });
    store.record({
      trap: "Missing transaction rollback on error",
      fix: "Use try/finally or transaction wrapper with automatic rollback",
      rule: "Guarantee rollback for every database transaction on error",
      tags: ["database", "transaction"],
    });

    const prompt = buildSystemPrompt({ cwd: tempCwd });
    expect(prompt).toContain("Project Learnings:");
    expect(prompt).toContain("Guarantee rollback for every database transaction on error");
  });

  it("distills rules and promotes to AGENTS.md and skills directory", () => {
    const distiller = new LearningsDistiller();
    const store = new LearningsStore({ cwd: tempCwd, globalDir: tempGlobal });

    const e1 = store.record({
      trap: "Port collision in vitest",
      fix: "Use get-port for dynamic binding",
      rule: "Allocate ephemeral ports for tests",
      tags: ["vitest", "network"],
    });
    const e2 = store.record({
      trap: "Vitest timers leak between tests",
      fix: "Call vi.useRealTimers() in afterEach",
      rule: "Restore real timers after test completion",
      tags: ["vitest", "timers"],
    });

    // Distill
    const clusters = distiller.distillClusters([e1, e2], 2);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].tag).toBe("vitest");

    // Promote to AGENTS.md
    const agentsRes = distiller.promoteToAgentsMd(tempCwd, [e1, e2]);
    expect(agentsRes.success).toBe(true);
    expect(existsSync(agentsRes.filePath)).toBe(true);
    const agentsMd = readFileSync(agentsRes.filePath, "utf8");
    expect(agentsMd).toContain("## Project Learnings");
    expect(agentsMd).toContain("Allocate ephemeral ports for tests");

    // Promote to skill
    const skillsDir = join(tempCwd, "skills");
    const skillRes = distiller.promoteToSkill(skillsDir, "vitest-patterns", "Vitest testing patterns and pitfalls", [
      e1,
      e2,
    ]);
    expect(skillRes.success).toBe(true);
    expect(existsSync(skillRes.skillFilePath)).toBe(true);
    const skillMd = readFileSync(skillRes.skillFilePath, "utf8");
    expect(skillMd).toContain("name: vitest-patterns");
    expect(skillMd).toContain("## Rules and Mitigations");
  });
});
