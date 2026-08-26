import { describe, expect, it } from "vitest";
import {
  requirementClauseConceptNames,
  uncoveredRequirementClauseConceptNames,
} from "../src/core/task-verification/requirement-clause-concepts.ts";

describe("referenced requirement critical concepts", () => {
  it("does not invent event-log or dependency-graph concepts from paths and dependency-free constraints", () => {
    expect(
      requirementClauseConceptNames(
        "Implement a dependency-free Node.js module in `src/log.js` with `test/log.test.js` coverage.",
      ),
    ).toEqual([]);
    expect(requirementClauseConceptNames("Implement log.js, src/log, and C:\\src\\log.ts.")).toEqual([]);
    expect(requirementClauseConceptNames("Update dag.js and package dependencies without lifecycle cycles.")).toEqual(
      [],
    );
  });

  it.each([
    "Preserve the event log and reject cycles in the dependency graph.",
    "Reject dependency cycles.",
    "Dependencies must remain acyclic.",
    "Topologically order dependencies.",
    "A task becomes runnable only after all dependencies succeed.",
    "Reject self-dependencies and invalid dependsOn references.",
  ])("retains explicit event-log or dependency-graph semantics: %s", (source) => {
    expect(requirementClauseConceptNames(source)).toContain("dependency graph");
    if (source.includes("event log")) expect(requirementClauseConceptNames(source)).toContain("event log");
  });

  it("does not let a filename discharge an explicit event-log guarantee", () => {
    expect(uncoveredRequirementClauseConceptNames("Preserve the event log.", "Update src/log.js.")).toEqual([
      "event log",
    ]);
    expect(
      uncoveredRequirementClauseConceptNames("Preserve the event log.", "The event log remains unchanged."),
    ).toEqual([]);
  });

  it("does not let a DAG filename discharge an explicit dependency-graph guarantee", () => {
    expect(uncoveredRequirementClauseConceptNames("Reject cycles in the dependency DAG.", "Update dag.js.")).toEqual([
      "dependency graph",
    ]);
    expect(
      uncoveredRequirementClauseConceptNames(
        "Reject cycles in the dependency DAG.",
        "The dependency DAG rejects every cycle.",
      ),
    ).toEqual([]);
  });
});
