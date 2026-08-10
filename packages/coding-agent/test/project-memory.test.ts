import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProjectMemoryContext,
  forgetProjectMemory,
  initProjectMemory,
  migrateProjectMemory,
  pinProjectMemory,
  searchProjectMemory,
  stripManagedBlocks,
} from "../src/core/project-memory.ts";

const tempDirs: string[] = [];

function createTempProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-project-memory-"));
  tempDirs.push(cwd);
  return cwd;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("project memory", () => {
  it("initializes durable memory folder and files without creating state dir", () => {
    const cwd = createTempProject();

    const result = initProjectMemory(cwd);

    expect(result.created).toContain(".pdev/memory");
    expect(existsSync(join(cwd, ".pdev/memory/active-context.md"))).toBe(true);
    expect(existsSync(join(cwd, ".pdev/memory/gotchas.md"))).toBe(true);
    expect(existsSync(join(cwd, ".pdev/state"))).toBe(false);
  });

  it("searches scoped markdown memory and renders bounded context without checkpoint", () => {
    const cwd = createTempProject();
    initProjectMemory(cwd);
    writeFileSync(
      join(cwd, ".pdev/memory/architecture.md"),
      "# Architecture\n\nCompaction invariants: keep all state protocol tokens intact.\n",
      "utf8",
    );

    const search = searchProjectMemory(cwd, "compaction");
    const context = createProjectMemoryContext(cwd, "compaction", 100);

    expect(search.hits.length).toBeGreaterThan(0);
    expect(context?.content).toContain("<project_memory>");
    expect(context?.content).toContain("keep all state protocol tokens intact");
    expect(context?.content).not.toContain("Current project/session checkpoint:");
  });

  it("supports pin and forget controls without snapshot side effects", () => {
    const cwd = createTempProject();
    const pin = pinProjectMemory(cwd, "Never lose x-unique-active-constraint");
    expect(pin.id).toMatch(/^pin-/);
    expect(existsSync(join(cwd, ".pdev/state/session.current.json"))).toBe(false);

    const searchBefore = searchProjectMemory(cwd, "x-unique-active-constraint");
    expect(searchBefore.hits.length).toBeGreaterThan(0);

    const forget = forgetProjectMemory(cwd, pin.id);
    expect(forget.removed).toBeGreaterThan(0);

    const searchAfter = searchProjectMemory(cwd, "x-unique-active-constraint");
    expect(searchAfter.hits.length).toBe(0);
  });

  it("handles adversarial cross-session pinning and retrieval without state leaks", () => {
    const cwd = createTempProject();
    initProjectMemory(cwd);

    // Session 1 pins a constraint
    const pin1 = pinProjectMemory(cwd, "Session 1 invariant: maintain backward compatibility");
    expect(pin1.id).toBeDefined();

    // Session 2 searches for session 1's pin
    const searchFromSession2 = searchProjectMemory(cwd, "backward compatibility");
    expect(searchFromSession2.hits.length).toBe(1);
    expect(searchFromSession2.hits[0].excerpt).toContain("Session 1 invariant");

    // Session 2 pins another constraint
    const pin2 = pinProjectMemory(cwd, "Session 2 invariant: enforce strict type checks");
    expect(pin2.id).toBeDefined();

    // Both pins survive and coexist cleanly in gotchas.md
    const gotchasContent = readFileSync(join(cwd, ".pdev/memory/gotchas.md"), "utf8");
    expect(gotchasContent).toContain("Session 1 invariant");
    expect(gotchasContent).toContain("Session 2 invariant");

    // No legacy session.current.json was written by pinning
    expect(existsSync(join(cwd, ".pdev/state/session.current.json"))).toBe(false);

    // Session 2 forgets session 1's pin cleanly
    const forget1 = forgetProjectMemory(cwd, pin1.id);
    expect(forget1.removed).toBeGreaterThan(0);

    const finalGotchas = readFileSync(join(cwd, ".pdev/memory/gotchas.md"), "utf8");
    expect(finalGotchas).not.toContain("Session 1 invariant");
    expect(finalGotchas).toContain("Session 2 invariant");
  });

  it("never retrieves legacy state from another session while preserving explicit memory", () => {
    const cwd = createTempProject();
    initProjectMemory(cwd);
    mkdirSync(join(cwd, ".pdev/state"), { recursive: true });
    writeFileSync(
      join(cwd, ".pdev/state/session.current.json"),
      JSON.stringify({ checkpoint: "ALPHA_SESSION_SECRET", goal: "ALPHA_SESSION_SECRET" }),
      "utf8",
    );
    writeFileSync(join(cwd, ".pdev/state/session-a.json"), JSON.stringify({ plan: ["ALPHA_SESSION_SECRET"] }), "utf8");
    pinProjectMemory(cwd, "DURABLE_PROJECT_FACT");

    expect(searchProjectMemory(cwd, "ALPHA_SESSION_SECRET").hits).toHaveLength(0);
    expect(createProjectMemoryContext(cwd, "ALPHA_SESSION_SECRET")).toBeUndefined();
    expect(createProjectMemoryContext(cwd, "DURABLE_PROJECT_FACT")?.content).toContain("DURABLE_PROJECT_FACT");
  });

  it("never retrieves legacy managed session blocks before explicit migration", () => {
    const cwd = createTempProject();
    const memoryDir = join(cwd, ".pdev/memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, "active-context.md"),
      [
        "# Active Context",
        "",
        "Human-authored durable fact.",
        "<!-- p:auto-active-context:begin -->",
        "Goal: ALPHA_SESSION_SECRET",
        "<!-- p:auto-active-context:end -->",
      ].join("\n"),
      "utf8",
    );

    expect(searchProjectMemory(cwd, "ALPHA_SESSION_SECRET").hits).toHaveLength(0);
    expect(createProjectMemoryContext(cwd, "ALPHA_SESSION_SECRET")).toBeUndefined();
    expect(searchProjectMemory(cwd, "durable fact").hits).toHaveLength(1);
  });

  it("uses one canonical project-memory root for nested repository sessions", () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, ".git"), { recursive: true });
    writeFileSync(join(cwd, ".git/HEAD"), "ref: refs/heads/main\n", "utf8");
    const nested = join(cwd, "packages", "feature");
    mkdirSync(nested, { recursive: true });

    const pin = pinProjectMemory(nested, "CANONICAL_PROJECT_MEMORY");

    expect(pin.path).toBe(join(realpathSync(cwd), ".pdev/memory/gotchas.md"));
    expect(existsSync(join(nested, ".pdev"))).toBe(false);
    expect(searchProjectMemory(cwd, "CANONICAL_PROJECT_MEMORY").hits).toHaveLength(1);
  });

  it("migrates managed blocks idempotently while preserving human content and legacy state dirs", () => {
    const cwd = createTempProject();
    const memoryDir = join(cwd, ".pdev/memory");
    const legacyStateDir = join(cwd, ".pdev/state");
    const legacySessionsDir = join(cwd, ".pdev/sessions");
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(legacyStateDir, { recursive: true });
    mkdirSync(legacySessionsDir, { recursive: true });

    // Pre-populate legacy state file and memory file with managed block + human content
    const legacyStateFile = join(legacyStateDir, "session.current.json");
    writeFileSync(legacyStateFile, JSON.stringify({ legacy: true }), "utf8");
    const legacySessionFile = join(legacySessionsDir, "subagent-digests.jsonl");
    writeFileSync(legacySessionFile, '{"summary":"LEGACY_SUBAGENT_SECRET"}\n', "utf8");

    const activeContextFile = join(memoryDir, "active-context.md");
    const originalHumanHeader =
      "# Active Context\n\nImportant human context line 1.\nImportant human context line 2.\n";
    const managedBlock =
      "<!-- p:auto-active-context:begin -->\nUpdated: 2026-08-10\nSession: legacy-123\nGoal: Old goal\n<!-- p:auto-active-context:end -->";
    const originalHumanFooter = "\nHuman footer note.\n";

    writeFileSync(activeContextFile, `${originalHumanHeader}\n${managedBlock}\n${originalHumanFooter}`, "utf8");

    const progressFile = join(memoryDir, "progress.md");
    const progressHuman = "# Plan\n\n- [ ] Human manual plan step 1\n";
    const progressBlock =
      "<!-- p:auto-progress:begin -->\nPlan:\n- [ ] Auto step 1\n- Auto step 2\n<!-- p:auto-progress:end -->";
    writeFileSync(progressFile, `${progressHuman}\n${progressBlock}`, "utf8");

    // Run migration
    const migratedFiles = migrateProjectMemory(cwd);
    expect(migratedFiles).toContain(".pdev/memory/active-context.md");
    expect(migratedFiles).toContain(".pdev/memory/progress.md");

    // Verify generated blocks are stripped while human content is preserved
    const migratedActiveContext = readFileSync(activeContextFile, "utf8");
    expect(migratedActiveContext).toBe(`${originalHumanHeader}${originalHumanFooter}`);
    expect(migratedActiveContext).toContain("Important human context line 1.");
    expect(migratedActiveContext).toContain("Important human context line 2.");
    expect(migratedActiveContext).toContain("Human footer note.");
    expect(migratedActiveContext).not.toContain("auto-active-context");
    expect(migratedActiveContext).not.toContain("Old goal");

    const migratedProgress = readFileSync(progressFile, "utf8");
    expect(migratedProgress).toContain("Human manual plan step 1");
    expect(migratedProgress).not.toContain("auto-progress");
    expect(migratedProgress).not.toContain("Auto step 1");

    // Idempotency: running migration again changes nothing
    const secondMigration = migrateProjectMemory(cwd);
    expect(secondMigration).toHaveLength(0);

    // Legacy state directory and file are NOT deleted
    expect(existsSync(legacyStateDir)).toBe(true);
    expect(existsSync(legacyStateFile)).toBe(true);
    expect(existsSync(legacySessionsDir)).toBe(true);
    expect(existsSync(legacySessionFile)).toBe(true);
  });

  it("stripManagedBlocks handles all 4 auto managed block IDs cleanly", () => {
    const raw = [
      "# Test",
      "<!-- p:auto-active-context:begin -->\nactive\n<!-- p:auto-active-context:end -->",
      "Human middle",
      "<!-- p:auto-progress:begin -->\nprogress\n<!-- p:auto-progress:end -->",
      "<!-- p:auto-decisions:begin -->\ndecisions\n<!-- p:auto-decisions:end -->",
      "<!-- p:auto-context-budget:begin -->\nbudget\n<!-- p:auto-context-budget:end -->",
      "Human end",
    ].join("\n");

    const stripped = stripManagedBlocks(raw);
    expect(stripped).toContain("# Test");
    expect(stripped).toContain("Human middle");
    expect(stripped).toContain("Human end");
    expect(stripped).not.toContain("auto-active-context");
    expect(stripped).not.toContain("auto-progress");
    expect(stripped).not.toContain("auto-decisions");
    expect(stripped).not.toContain("auto-context-budget");
  });

  it("does not traverse state or cache subdirectories during search", () => {
    const cwd = createTempProject();
    initProjectMemory(cwd);
    mkdirSync(join(cwd, ".pdev/memory/state"), { recursive: true });
    mkdirSync(join(cwd, ".pdev/memory/cache"), { recursive: true });

    writeFileSync(join(cwd, ".pdev/memory/state/secret.md"), "Compaction state secret keyword", "utf8");
    writeFileSync(join(cwd, ".pdev/memory/cache/temp.md"), "Compaction cache keyword", "utf8");
    writeFileSync(join(cwd, ".pdev/memory/architecture.md"), "Compaction architecture keyword", "utf8");

    const search = searchProjectMemory(cwd, "Compaction");
    expect(search.hits).toHaveLength(1);
    expect(search.hits[0].path).toBe(".pdev/memory/architecture.md");
  });
});
