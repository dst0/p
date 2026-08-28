import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_REQUIREMENT_SOURCE_BYTES,
  MAX_REQUIREMENT_SOURCE_CANDIDATES,
  MAX_REQUIREMENT_SOURCE_TOTAL_BYTES,
  MAX_SELECTED_REQUIREMENT_SOURCES,
  normalizeRequirementSourcePath,
  prepareReferencedRequirementSources,
} from "../src/core/task-verification/referenced-requirement-sources.ts";
import { inspectRequirementSourceFile } from "../src/core/task-verification/requirement-source-file.ts";
import type { TaskVerificationRequirementSourceRef } from "../src/core/task-verification/types.ts";

describe("requirement-source selection boundaries", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("counts reused snapshots toward the aggregate source-size limit", () => {
    const paths = ["A.md", "B.md", "C.md"];
    const prompts = [{ id: "user-1", text: `Use ${paths.join(", ")} as the complete specification.` }];
    const byteLength = Math.floor(MAX_REQUIREMENT_SOURCE_TOTAL_BYTES / 3) + 1;

    const result = prepareReferencedRequirementSources(
      "/unused",
      prompts,
      paths,
      [],
      paths.map((path, index) => reference(path, index, byteLength)),
    );

    expect(result).toBe(
      `Selected requirement sources exceed the ${MAX_REQUIREMENT_SOURCE_TOTAL_BYTES}-byte total limit.`,
    );
  });

  it("rejects candidate and selected-source cardinality overflow before filesystem access", () => {
    const overflowPaths = Array.from(
      { length: MAX_REQUIREMENT_SOURCE_CANDIDATES + 1 },
      (_, index) => `spec-${index}.md`,
    );
    expect(
      prepareReferencedRequirementSources(
        "/unused",
        [{ id: "user-1", text: `Use ${overflowPaths.join(" ")}.` }],
        [],
        [],
      ),
    ).toContain(`More than ${MAX_REQUIREMENT_SOURCE_CANDIDATES} requirement-source candidates`);

    const selectedPaths = Array.from(
      { length: MAX_SELECTED_REQUIREMENT_SOURCES + 1 },
      (_, index) => `selected-${index}.md`,
    );
    expect(
      prepareReferencedRequirementSources(
        "/unused",
        [{ id: "user-1", text: `Follow ${selectedPaths.join(" ")}.` }],
        selectedPaths,
        [],
      ),
    ).toBe(`Select at most ${MAX_SELECTED_REQUIREMENT_SOURCES} requirement sources.`);
  });

  it.each(["", "../SPEC.md", "/tmp/SPEC.md", "nested//SPEC.md", "SPEC*.md"])(
    "rejects unsafe normalized source path %j",
    (path) => {
      expect(normalizeRequirementSourcePath(path)).toBeUndefined();
    },
  );

  it("rejects invalid UTF-8, non-files, and workspace escapes without reading arbitrary bytes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "p-requirement-source-selection-"));
    workspaces.push(workspace);
    await writeFile(join(workspace, "INVALID.md"), Buffer.from([0xff]));
    await mkdir(join(workspace, "DIRECTORY.md"));
    execFileSync("git", ["init", "-q"], { cwd: workspace });
    execFileSync("git", ["add", "INVALID.md"], { cwd: workspace });

    expect(inspectRequirementSourceFile(workspace, "INVALID.md", MAX_REQUIREMENT_SOURCE_BYTES)).toBe(
      "Requirement source is not valid UTF-8 text.",
    );
    expect(inspectRequirementSourceFile(workspace, "DIRECTORY.md", MAX_REQUIREMENT_SOURCE_BYTES)).toContain(
      "is not an isolated regular file",
    );
    expect(inspectRequirementSourceFile(workspace, "../outside.md", MAX_REQUIREMENT_SOURCE_BYTES)).toContain(
      "escapes the workspace",
    );
  });
});

function reference(path: string, index: number, byteLength: number): TaskVerificationRequirementSourceRef {
  return {
    id: `source-${index}`,
    path,
    sha256: String(index).padStart(64, "a"),
    byteLength,
    snapshotEntryId: `snapshot-${index}`,
    referencedByPromptIds: ["user-1"],
    capturedAtMutationRevision: 0,
    origin: "requirement_audit.prepare_definition",
    policyVersion: 1,
  };
}
