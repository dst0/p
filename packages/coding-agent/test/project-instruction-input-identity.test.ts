import { describe, expect, it } from "vitest";
import {
  computeInputHash,
  hashText,
  PROJECT_INSTRUCTION_ARTIFACT_RENDERER_VERSION,
} from "../src/core/project-instructions/content.ts";

describe("project instruction input identity", () => {
  it("binds artifact renderer changes independently from compiler identity", () => {
    const agentsHash = hashText("agents");
    const first = computeInputHash(agentsHash, [], "compiler-a", "renderer-a");

    expect(computeInputHash(agentsHash, [], "compiler-a", "renderer-b")).not.toBe(first);
    expect(computeInputHash(agentsHash, [], "compiler-b", "renderer-a")).not.toBe(first);
    expect(computeInputHash(agentsHash, [], "compiler-a", "renderer-a")).toBe(first);
  });

  it("defaults new artifacts to the list_skills renderer identity instead of a stale prompt identity", () => {
    const agentsHash = hashText("agents");
    const current = computeInputHash(agentsHash, [], "compiler-a");

    expect(current).toBe(computeInputHash(agentsHash, [], "compiler-a", PROJECT_INSTRUCTION_ARTIFACT_RENDERER_VERSION));
    expect(current).not.toBe(computeInputHash(agentsHash, [], "compiler-a", "project-instructions-artifact-v1"));
  });
});
