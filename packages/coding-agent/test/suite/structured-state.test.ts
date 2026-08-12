import { describe, expect, it } from "vitest";
import type { EvidencePointer } from "../../src/core/compaction/compaction.ts";
import {
  createInitialStructuredSessionState,
  createStatePatchFromSessionStateUpdate,
  createStructuredSessionState,
  getOrderedPlanTree,
  mergeStructuredSessionState,
  renderWorkingSessionState,
  mergePlan,
} from "../../src/core/compaction/structured-state.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";

function makeEntry(overrides?: Partial<SessionEntry>): SessionEntry {
  return {
    id: "entry-1",
    parentId: null,
    type: "message",
    message: {
      role: "user",
      content: "test",
      timestamp: Date.now(),
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  } as SessionEntry;
}

describe("structured-state normalization", () => {
  it("filters /tmp/ scratch files from touchedFiles", () => {
    const previous = createInitialStructuredSessionState("test");
    previous.codebase.touchedFiles = [
      { path: "/tmp/test-scratch.ts", status: "modified", summary: "temp file" },
      { path: "packages/foo/src/bar.ts", status: "read", summary: "real file" },
    ];

    const state = createStructuredSessionState({
      sessionId: "test",
      previous,
      summary: "Goal: test\n\nPlan:\n- [ ] test",
      entries: [makeEntry()],
      modifiedFiles: [],
    });

    const paths = state.codebase.touchedFiles.map((f) => f.path);
    expect(paths).not.toContain("/tmp/test-scratch.ts");
    expect(paths).toContain("packages/foo/src/bar.ts");
  });

  it("filters /var/folders/ scratch files from touchedFiles", () => {
    const previous = createInitialStructuredSessionState("test");
    previous.codebase.touchedFiles = [
      { path: "/var/folders/ab12/cd34/T/tmp-123.ts", status: "modified", summary: "scratch" },
    ];

    const state = createStructuredSessionState({
      sessionId: "test",
      previous,
      summary: "Goal: test\n\nPlan:\n- [ ] test",
      entries: [makeEntry()],
      modifiedFiles: [],
    });

    expect(state.codebase.touchedFiles).toHaveLength(0);
  });

  it("normalizes absolute paths to relative", () => {
    const previous = createInitialStructuredSessionState("test");
    previous.codebase.touchedFiles = [
      {
        path: "/Users/dst/dev/p/packages/coding-agent/src/core/compaction/structured-state.ts",
        status: "read",
        summary: "deep absolute",
      },
    ];

    const state = createStructuredSessionState({
      sessionId: "test",
      previous,
      summary: "Goal: test\n\nPlan:\n- [ ] test",
      entries: [makeEntry()],
      modifiedFiles: [],
    });

    const path = state.codebase.touchedFiles[0]?.path;
    expect(path).toBe("structured-state.ts");
  });

  it("deduplicates touched files by normalized path", () => {
    const previous = createInitialStructuredSessionState("test");
    previous.codebase.touchedFiles = [{ path: "packages/foo.ts", status: "read", summary: "short" }];

    const state = createStructuredSessionState({
      sessionId: "test",
      previous,
      summary: "Goal: test\n\nPlan:\n- [ ] test",
      entries: [makeEntry()],
      modifiedFiles: ["packages/foo.ts"],
    });

    const matches = state.codebase.touchedFiles.filter((f) => f.path === "packages/foo.ts");
    expect(matches).toHaveLength(1);
    // Should keep the entry with more detailed summary
    expect(matches[0]!.summary).toContain("Modified");
  });

  it("filters dead evidence references", () => {
    const previous = createInitialStructuredSessionState("test");
    previous.evidence = [
      {
        id: "tool-result:real1",
        kind: "tool_result",
        summary: "real result",
        path: "packages/foo.ts",
        retrieveWhen: "",
      },
      {
        id: "tool-result:dead1",
        kind: "tool_result",
        summary: "dead ref",
        path: "",
        retrieveWhen: "when verifying X",
      },
    ];

    const state = createStructuredSessionState({
      sessionId: "test",
      previous,
      summary: "Goal: test\n\nPlan:\n- [ ] test",
      entries: [makeEntry()],
    });

    const ids = state.evidence.map((e) => e.id);
    expect(ids).toContain("tool-result:real1");
    expect(ids).not.toContain("tool-result:dead1");
  });

  it("prunes evidence to max 50 entries", () => {
    const previous = createInitialStructuredSessionState("test");
    const evidence: EvidencePointer[] = [];
    for (let i = 0; i < 60; i++) {
      evidence.push({
        id: `tool-result:${i}`,
        kind: "tool_result",
        summary: `result ${i}`,
        path: `packages/file${i}.ts`,
        retrieveWhen: "",
      });
    }
    previous.evidence = evidence;

    const state = createStructuredSessionState({
      sessionId: "test",
      previous,
      summary: "Goal: test\n\nPlan:\n- [ ] test",
      entries: [makeEntry()],
    });

    expect(state.evidence.length).toBeLessThanOrEqual(50);
  });

  it("prunes dead evidenceEntryIds from plan items", () => {
    // Plan items are no longer re-parsed from compaction summaries.
    // Existing plan items and their evidenceEntryIds are preserved as-is through compaction.
    const previous = createInitialStructuredSessionState("test");
    previous.plan = [{ id: "p1", text: "Step one", status: "done", evidenceEntryIds: ["e1", "e2", "e3"] }];
    previous.evidence = [
      { id: "e1", kind: "file", summary: "exists", path: "packages/foo.ts", retrieveWhen: "" },
      { id: "e2", kind: "file", summary: "exists", path: "packages/bar.ts", retrieveWhen: "" },
      // e3 is not in evidence
    ];

    const state = createStructuredSessionState({
      sessionId: "test",
      previous,
      summary: "Goal: test\n\nPlan:\n- [x] Step one",
      entries: [makeEntry()],
    });

    // Plan should be preserved from previous state, including original evidenceEntryIds
    expect(state.plan[0]?.evidenceEntryIds).toEqual(["e1", "e2", "e3"]);
  });

  it("preserves previous goal when no new goal is provided", () => {
    const previous = createInitialStructuredSessionState("test");
    previous.canonicalRequest.current = "Fix the session state bugs and write tests";

    const state = createStructuredSessionState({
      sessionId: "test",
      previous,
      summary: "Plan:\n- [ ] Fix bugs\n- [ ] Write tests",
      entries: [makeEntry()],
    });

    expect(state.canonicalRequest.current).toBe("Fix the session state bugs and write tests");
  });

  it("merges originalRequests without duplicates", () => {
    const previous = createInitialStructuredSessionState("test");
    previous.canonicalRequest.current = "Fix bugs";
    previous.canonicalRequest.originalRequests = [
      {
        id: "req-1",
        entryId: "entry-1",
        timestamp: "2024-01-01T00:00:00Z",
        text: "First request",
        summary: "First request",
        kind: "request",
      },
    ];

    const entry2 = makeEntry({
      id: "entry-2",
      message: {
        role: "user",
        content: "Second request",
        timestamp: Date.now(),
      },
    });

    const state = createStructuredSessionState({
      sessionId: "test",
      previous,
      summary: "Goal: Fix bugs",
      entries: [entry2],
    });

    const ids = state.canonicalRequest.originalRequests.map((r) => r.id);
    expect(ids).toContain("req-1");
    expect(ids).toContain("req-2");
    expect(state.canonicalRequest.originalRequests.length).toBe(2);
  });

  it("keeps the entry with more detailed summary when deduplicating touched files", () => {
    const previous = createInitialStructuredSessionState("test");
    previous.codebase.touchedFiles = [
      { path: "packages/foo.ts", status: "read", summary: "short" },
      {
        path: "packages/foo.ts",
        status: "modified",
        summary: "very detailed summary of what was changed in this file",
      },
    ];

    const state = createStructuredSessionState({
      sessionId: "test",
      previous,
      summary: "Goal: test\n\nPlan:\n- [ ] test",
      entries: [makeEntry()],
    });

    const matches = state.codebase.touchedFiles.filter((f) => f.path === "packages/foo.ts");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.summary).toBe("very detailed summary of what was changed in this file");
  });

  it("orders plan tree depth-first, highlights deepest active subtask, and handles cycles", () => {
    const plan = [
      { id: "parent1", text: "Top task 1", status: "in_progress" as const, evidenceEntryIds: [] },
      { id: "sub1.1", text: "Subtask 1.1", status: "done" as const, parentId: "parent1", evidenceEntryIds: [] },
      { id: "sub1.2", text: "Subtask 1.2", status: "in_progress" as const, parentId: "parent1", evidenceEntryIds: [] },
      { id: "parent2", text: "Top task 2", status: "not_started" as const, evidenceEntryIds: [] },
    ];

    const ordered = getOrderedPlanTree(plan);
    expect(ordered.map((o) => o.item.id)).toEqual(["parent1", "sub1.1", "sub1.2", "parent2"]);
    expect(ordered.find((o) => o.item.id === "sub1.2")?.depth).toBe(1);
    expect(ordered.find((o) => o.item.id === "parent1")?.active).toBe(false);
    expect(ordered.find((o) => o.item.id === "sub1.2")?.active).toBe(true);

    const state = createInitialStructuredSessionState("test");
    state.canonicalRequest.current = "Test Goal";
    state.plan = plan;

    const rendered = renderWorkingSessionState(state, 1000);
    expect(rendered!).toContain("⏳ Top task 1");
    expect(rendered!).toContain("├─ ✅ Subtask 1.1");
    expect(rendered!).toContain("└─ ⏳ Subtask 1.2 👈 (active)");

    // Test cycle protection: A -> B -> A should not throw stack overflow
    const cyclicPlan = [
      { id: "A", text: "Task A", status: "in_progress" as const, parentId: "B", evidenceEntryIds: [] },
      { id: "B", text: "Task B", status: "not_started" as const, parentId: "A", evidenceEntryIds: [] },
    ];
    expect(() => getOrderedPlanTree(cyclicPlan)).not.toThrow();
  });

  it("reorders plan even for a single-item add", () => {
    const state = createInitialStructuredSessionState("test");
    state.canonicalRequest.current = "Test Goal";
    state.plan = [
      { id: "a", text: "Task A", status: "done" as const, evidenceEntryIds: [] },
      { id: "b", text: "Task B", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "c", text: "Task C", status: "not_started" as const, evidenceEntryIds: [] },
    ];

    // Single-item add that matches existing item by text should reorder it
    const merged = mergeStructuredSessionState(
      state,
      createStatePatchFromSessionStateUpdate({ type: "patch", plan: [{ text: "Task C", status: "in_progress" }] }, [])!,
    );

    // Task C should now be before Task B (since it's the only item in orderedIds)
    const ids = merged.plan.map((p) => p.id);
    expect(ids).toEqual(["c", "a", "b"]);
  });

  it("maintains execution order across multiple single-item adds", () => {
    const state = createInitialStructuredSessionState("test");
    state.canonicalRequest.current = "Test Goal";
    state.plan = [
      { id: "a", text: "Task A", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "b", text: "Task B", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "c", text: "Task C", status: "not_started" as const, evidenceEntryIds: [] },
    ];

    // Simulate agent adding items one at a time, each matching existing by text
    let merged = mergeStructuredSessionState(
      state,
      createStatePatchFromSessionStateUpdate({ type: "patch", plan: [{ text: "Task B", status: "in_progress" }] }, [])!,
    );
    merged = mergeStructuredSessionState(
      merged,
      createStatePatchFromSessionStateUpdate({ type: "patch", plan: [{ text: "Task C", status: "in_progress" }] }, [])!,
    );

    // After single-item adds, the array should be reordered
    // Task B was added first (moved to front), then Task C was added (moved to front)
    const ids = merged.plan.map((p) => p.id);
    expect(ids).toEqual(["c", "b", "a"]);
  });

  it("should handle plan item removals via mergePlan", () => {
    const state = createInitialStructuredSessionState("test");
    state.plan = [{ id: "test-id", text: "Test Item", status: "not_started", evidenceEntryIds: [] }];
    mergePlan(state, {
      remove: ["Test Item"]
    });
    expect(state.plan).toHaveLength(0);
  });

  it("renders plan with tree indentation for parent-child relationships", () => {
    const plan = [
      { id: "parent", text: "Parent task", status: "in_progress" as const, evidenceEntryIds: [] },
      { id: "child1", text: "Child 1", status: "done" as const, parentId: "parent", evidenceEntryIds: [] },
      { id: "child2", text: "Child 2", status: "in_progress" as const, parentId: "parent", evidenceEntryIds: [] },
      { id: "sibling", text: "Sibling task", status: "not_started" as const, evidenceEntryIds: [] },
    ];

    const state = createInitialStructuredSessionState("test");
    state.canonicalRequest.current = "Test Goal";
    state.plan = plan;

    const rendered = renderWorkingSessionState(state, 1000)!;
    // Tree-ordered: parent, child1, child2, sibling
    expect(rendered).toContain("⏳ Parent task");
    expect(rendered).toContain("├─ ✅ Child 1");
    expect(rendered).toContain("└─ ⏳ Child 2 👈 (active)");
    expect(rendered).toContain("• Sibling task");

    // Verify tree order: parent comes before children, sibling comes after parent subtree
    const parentIdx = rendered.indexOf("Parent task");
    const child1Idx = rendered.indexOf("Child 1");
    const child2Idx = rendered.indexOf("Child 2");
    const siblingIdx = rendered.indexOf("Sibling task");
    expect(parentIdx).toBeLessThan(child1Idx);
    expect(child1Idx).toBeLessThan(child2Idx);
    expect(child2Idx).toBeLessThan(siblingIdx);
  });

  it("getOrderedPlanTree preserves sibling order from flat array", () => {
    const plan = [
      { id: "a", text: "Task A", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "b", text: "Task B", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "c", text: "Task C", status: "not_started" as const, evidenceEntryIds: [] },
    ];

    const ordered = getOrderedPlanTree(plan);
    expect(ordered.map((o) => o.item.id)).toEqual(["a", "b", "c"]);
    expect(ordered.every((o) => o.depth === 0)).toBe(true);
  });

  it("getOrderedPlanTree orders children after their parent in DFS", () => {
    const plan = [
      { id: "root", text: "Root", status: "in_progress" as const, evidenceEntryIds: [] },
      { id: "sub1", text: "Sub 1", status: "done" as const, parentId: "root", evidenceEntryIds: [] },
      { id: "sub2", text: "Sub 2", status: "not_started" as const, parentId: "root", evidenceEntryIds: [] },
      { id: "peer", text: "Peer", status: "not_started" as const, evidenceEntryIds: [] },
    ];

    const ordered = getOrderedPlanTree(plan);
    // DFS order: root -> sub1 -> sub2 -> peer
    expect(ordered.map((o) => o.item.id)).toEqual(["root", "sub1", "sub2", "peer"]);
    expect(ordered.find((o) => o.item.id === "root")?.depth).toBe(0);
    expect(ordered.find((o) => o.item.id === "sub1")?.depth).toBe(1);
    expect(ordered.find((o) => o.item.id === "sub2")?.depth).toBe(1);
    expect(ordered.find((o) => o.item.id === "peer")?.depth).toBe(0);
  });

  it("reorders plan when LLM sends full plan in execution order", () => {
    const state = createInitialStructuredSessionState("test");
    state.canonicalRequest.current = "Test Goal";
    state.plan = [
      { id: "a", text: "Task A", status: "done" as const, evidenceEntryIds: [] },
      { id: "b", text: "Task B", status: "done" as const, evidenceEntryIds: [] },
      { id: "c", text: "Task C", status: "not_started" as const, evidenceEntryIds: [] },
    ];

    // LLM sends all 3 items in a different execution order: C > B > A
    const merged = mergeStructuredSessionState(
      state,
      createStatePatchFromSessionStateUpdate(
        {
          type: "patch",
          plan: [
            { text: "Task C", status: "in_progress" },
            { text: "Task B", status: "done" },
            { text: "Task A", status: "done" },
          ],
        },
        [],
      )!,
    );

    const ids = merged.plan.map((p) => p.id);
    expect(ids).toEqual(["c", "b", "a"]);
  });

  it("/state rendering uses tree order with indentation for parent-child plans", () => {
    const state = createInitialStructuredSessionState("test");
    state.canonicalRequest.current = "Investigate ordering bug";
    state.plan = [
      { id: "1", text: "Research codebase", status: "done" as const, evidenceEntryIds: [] },
      { id: "2", text: "Implement fix", status: "in_progress" as const, evidenceEntryIds: [] },
      { id: "3", text: "Find root cause", status: "done" as const, parentId: "2", evidenceEntryIds: [] },
      { id: "4", text: "Write tests", status: "not_started" as const, evidenceEntryIds: [] },
    ];

    const rendered = renderWorkingSessionState(state, 1000)!;
    // "Find root cause" is a child of "Implement fix", so it should be indented
    const implementIdx = rendered.indexOf("Implement fix");
    const rootCauseIdx = rendered.indexOf("Find root cause");
    expect(rootCauseIdx).toBeGreaterThan(implementIdx);
    // Child should have tree connector
    expect(rendered).toContain("└─");
  });

  it("getOrderedPlanTree sorts siblings by status: done first, then in_progress, then not_started", () => {
    const plan = [
      { id: "c", text: "Task C", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "a", text: "Task A", status: "done" as const, evidenceEntryIds: [] },
      { id: "b", text: "Task B", status: "in_progress" as const, evidenceEntryIds: [] },
    ];

    const ordered = getOrderedPlanTree(plan);
    expect(ordered.map((o) => o.item.id)).toEqual(["a", "b", "c"]);
  });

  it("getOrderedPlanTree sorts all status values: done > in_progress > failed > blocked > not_started", () => {
    const plan = [
      { id: "e", text: "E", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "d", text: "D", status: "blocked" as const, evidenceEntryIds: [] },
      { id: "a", text: "A", status: "done" as const, evidenceEntryIds: [] },
      { id: "b", text: "B", status: "in_progress" as const, evidenceEntryIds: [] },
      { id: "c", text: "C", status: "failed" as const, evidenceEntryIds: [] },
    ];

    const ordered = getOrderedPlanTree(plan);
    expect(ordered.map((o) => o.item.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("getOrderedPlanTree sorts children within each parent by status", () => {
    const plan = [
      { id: "root", text: "Root", status: "in_progress" as const, evidenceEntryIds: [] },
      { id: "child3", text: "Child 3", status: "not_started" as const, parentId: "root", evidenceEntryIds: [] },
      { id: "child1", text: "Child 1", status: "done" as const, parentId: "root", evidenceEntryIds: [] },
      { id: "child2", text: "Child 2", status: "in_progress" as const, parentId: "root", evidenceEntryIds: [] },
    ];

    const ordered = getOrderedPlanTree(plan);
    expect(ordered.map((o) => o.item.id)).toEqual(["root", "child1", "child2", "child3"]);
    expect(ordered.find((o) => o.item.id === "child1")?.depth).toBe(1);
    expect(ordered.find((o) => o.item.id === "child2")?.depth).toBe(1);
    expect(ordered.find((o) => o.item.id === "child3")?.depth).toBe(1);
  });

  it("getOrderedPlanTree preserves order for siblings with same status", () => {
    const plan = [
      { id: "a", text: "Task A", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "b", text: "Task B", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "c", text: "Task C", status: "not_started" as const, evidenceEntryIds: [] },
    ];

    const ordered = getOrderedPlanTree(plan);
    expect(ordered.map((o) => o.item.id)).toEqual(["a", "b", "c"]);
  });

  it("getOrderedPlanTree sorts orphans by status", () => {
    const plan = [
      { id: "a", text: "A", status: "in_progress" as const, evidenceEntryIds: [] },
      { id: "b", text: "B", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "c", text: "C", status: "done" as const, evidenceEntryIds: [], parentId: "nonexistent" },
    ];

    const ordered = getOrderedPlanTree(plan);
    // "c" references nonexistent parent, becomes orphan
    // Sorted by status: done(c), in_progress(a), not_started(b)
    const ids = ordered.map((o) => o.item.id);
    const doneIdx = ids.indexOf("c");
    const inProgressIdx = ids.indexOf("a");
    const notStartedIdx = ids.indexOf("b");
    expect(doneIdx).toBeLessThan(inProgressIdx);
    expect(inProgressIdx).toBeLessThan(notStartedIdx);
  });

  it("renderWorkingSessionState displays plan items sorted by status", () => {
    const state = createInitialStructuredSessionState("test");
    state.canonicalRequest.current = "Test status sorting";
    state.plan = [
      { id: "3", text: "Write tests", status: "not_started" as const, evidenceEntryIds: [] },
      { id: "1", text: "Research", status: "done" as const, evidenceEntryIds: [] },
      { id: "2", text: "Implement", status: "in_progress" as const, evidenceEntryIds: [] },
    ];

    const rendered = renderWorkingSessionState(state, 1000)!;
    const researchIdx = rendered.indexOf("Research");
    const implementIdx = rendered.indexOf("Implement");
    const testsIdx = rendered.indexOf("Write tests");
    expect(researchIdx).toBeLessThan(implementIdx);
    expect(implementIdx).toBeLessThan(testsIdx);
  });
});
