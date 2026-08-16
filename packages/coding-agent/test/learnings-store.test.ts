import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LearningsDistiller } from "../src/core/learnings/learnings-distiller.ts";
import { LearningsStore } from "../src/core/learnings/learnings-store.ts";
import type { LearningEntry } from "../src/core/learnings/types.ts";

describe("LearningsStore & LearningsDistiller", () => {
  let tempCwd: string;
  let tempGlobal: string;

  beforeEach(() => {
    tempCwd = join(tmpdir(), `p-test-cwd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    tempGlobal = join(tmpdir(), `p-test-global-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(tempCwd, { recursive: true });
    mkdirSync(tempGlobal, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempCwd, { recursive: true, force: true });
    rmSync(tempGlobal, { recursive: true, force: true });
  });

  it("records and loads entries into project and global stores", () => {
    const store = new LearningsStore({ cwd: tempCwd, globalDir: tempGlobal });

    const p1 = store.record({
      trap: "Running tests in parallel broke port binding",
      fix: "Use random available ports with get-port",
      rule: "Always allocate ephemeral ports for concurrent test suites",
      tags: ["testing", "network"],
      cwd: tempCwd,
    });

    const g1 = store.record(
      {
        trap: "V8 memory leak when mocking global fetch without restoring",
        fix: "Always call vi.restoreAllMocks() in afterEach",
        rule: "Restore mocked globals in afterEach teardown",
        tags: ["vitest", "memory"],
      },
      "global",
    );

    expect(p1.timestamp).toBeDefined();
    expect(g1.timestamp).toBeDefined();

    const projectOnly = store.loadAll("project");
    expect(projectOnly).toHaveLength(1);
    expect(projectOnly[0].rule).toBe(p1.rule);

    const globalOnly = store.loadAll("global");
    expect(globalOnly).toHaveLength(1);
    expect(globalOnly[0].rule).toBe(g1.rule);

    const all = store.loadAll("all");
    expect(all).toHaveLength(2);
  });

  it("handles corrupted lines, empty lines, and non-existent files gracefully", () => {
    const store = new LearningsStore({ cwd: tempCwd, globalDir: tempGlobal });
    const agentsDir = join(tempCwd, ".agents");
    mkdirSync(agentsDir, { recursive: true });

    const corruptedContent = [
      '{"trap":"valid","fix":"valid","rule":"Rule 1","tags":["a"]}',
      "NOT_VALID_JSON_LINE",
      "",
      '{"rule":"Rule 2","trap":"t2","fix":"f2","tags":["b"]}',
      "{incomplete",
    ].join("\n");

    writeFileSync(join(agentsDir, "learnings.jsonl"), corruptedContent, "utf8");

    const loaded = store.loadAll("project");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].rule).toBe("Rule 1");
    expect(loaded[1].rule).toBe("Rule 2");
  });

  it("performs fast scoring and query matching in < 2ms", () => {
    const store = new LearningsStore({ cwd: tempCwd, globalDir: tempGlobal });

    for (let i = 0; i < 50; i++) {
      store.record({
        trap: `Generic issue #${i} with database locks`,
        fix: `Apply advisory lock #${i}`,
        rule: `Rule #${i}: lock properly`,
        tags: [i % 2 === 0 ? "database" : "frontend", "concurrency"],
      });
    }

    const start = performance.now();
    const matches = store.query({
      queryText: "database advisory lock",
      tags: ["database"],
      limit: 5,
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches[0].score).toBeGreaterThan(0);
    expect(matches[0].matchedTags).toContain("database");
  });

  it("formats recent project learnings for system prompt correctly", () => {
    const store = new LearningsStore({ cwd: tempCwd, globalDir: tempGlobal });
    expect(store.formatForPrompt()).toBeUndefined();

    store.record({
      trap: "Unclosed DB handle",
      fix: "Use using/dispose",
      rule: "Always dispose DB connections",
      tags: ["db"],
    });

    const promptText = store.formatForPrompt();
    expect(promptText).toBeDefined();
    expect(promptText).toContain("Project Learnings:");
    expect(promptText).toContain(
      "- Always dispose DB connections (Trap: Unclosed DB handle -> Fix: Use using/dispose)",
    );
  });

  it("distills clusters and promotes to AGENTS.md and skills tree", () => {
    const distiller = new LearningsDistiller();
    const entries: LearningEntry[] = [
      {
        timestamp: "2026-01-01",
        trap: "Async error unhandled in fastify",
        fix: "Wrap route handler in try-catch or fastify errorHandler",
        rule: "Always register central errorHandler in Fastify",
        tags: ["fastify", "backend"],
      },
      {
        timestamp: "2026-01-02",
        trap: "Fastify schema validation bypass",
        fix: "Define strict TypeBox schemas on routes",
        rule: "Strict TypeBox validation on all Fastify endpoints",
        tags: ["fastify", "security"],
      },
    ];

    const clusters = distiller.distillClusters(entries, 2);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].tag).toBe("fastify");
    expect(clusters[0].rules).toHaveLength(2);

    const promoteRes = distiller.promoteToAgentsMd(tempCwd, entries);
    expect(promoteRes.success).toBe(true);
    expect(promoteRes.addedRules).toHaveLength(2);

    const agentsMdContent = readFileSync(promoteRes.filePath, "utf8");
    expect(agentsMdContent).toContain("## Project Learnings");
    expect(agentsMdContent).toContain("Always register central errorHandler in Fastify");

    // Re-promoting should not duplicate
    const promoteAgain = distiller.promoteToAgentsMd(tempCwd, entries);
    expect(promoteAgain.addedRules).toHaveLength(0);

    const skillsDir = join(tempCwd, ".agents", "skills");
    const skillRes = distiller.promoteToSkill(
      skillsDir,
      clusters[0].suggestedSkillName,
      clusters[0].suggestedDescription,
      entries,
    );
    expect(skillRes.success).toBe(true);
    expect(existsSync(skillRes.skillFilePath)).toBe(true);

    const skillContent = readFileSync(skillRes.skillFilePath, "utf8");
    expect(skillContent).toContain("name: fastify-best-practices");
    expect(skillContent).toContain("Distilled rules and pitfall mitigations for fastify");
    expect(skillContent).toContain("## Rules and Mitigations");
  });
});
