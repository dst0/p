import { describe, expect, it } from "vitest";
import { PROJECT_INSTRUCTION_COMPILER_VERSION } from "../src/core/project-instructions/index.ts";
import {
  computeProjectInstructionResultHash,
  parseProjectInstructionManifest,
} from "../src/core/project-instructions/manifest.ts";
import type { ProjectInstructionManifest } from "../src/core/project-instructions/types.ts";

describe("project instruction manifest result hash", () => {
  it("binds compiler usage and routed-rule metadata", () => {
    const base = {
      schemaVersion: 1,
      compilerVersion: PROJECT_INSTRUCTION_COMPILER_VERSION,
      agentsHash: "a".repeat(64),
      inputHash: "b".repeat(64),
      promptHash: "c".repeat(64),
      rulesCatalogHash: "d".repeat(64),
      skillsCatalogHash: "e".repeat(64),
      rulesCatalogPages: [],
      skillsCatalogPages: [],
      mode: "compiled",
      compilerStatus: "success",
      compilerUsage: { input: 10, output: 2, cacheRead: 3, cacheWrite: 1, total: 16 },
      promptFile: "prompt.md",
      rulesCatalogFile: "rules/catalog.md",
      skillsCatalogFile: "skills/catalog.md",
      sources: [],
      rules: [
        {
          id: "testing",
          link: "rules/testing.md",
          file: "rules/testing.md",
          title: "Testing",
          trigger: "When tests change",
          routable: true,
          sourcePath: "/workspace/AGENTS.md",
          contentHash: "f".repeat(64),
        },
      ],
      skills: [],
    } satisfies Omit<ProjectInstructionManifest, "resultHash">;
    const original = computeProjectInstructionResultHash(base);

    expect(
      computeProjectInstructionResultHash({
        ...base,
        compilerUsage: { ...base.compilerUsage, output: 3, total: 17 },
      }),
    ).not.toBe(original);
    expect(
      computeProjectInstructionResultHash({
        ...base,
        rules: [{ ...base.rules[0], trigger: "When releases change", routable: false }],
      }),
    ).not.toBe(original);
    const failedBase = { ...base, compilerStatus: "failed" as const };
    expect(
      computeProjectInstructionResultHash({
        ...failedBase,
        compilerDiagnostic: "project instruction compiler output validation failed",
      }),
    ).not.toBe(
      computeProjectInstructionResultHash({
        ...failedBase,
        compilerDiagnostic: "project instruction compiler provider call failed",
      }),
    );
  });

  it("requires a valid diagnostic exactly when compilation failed", () => {
    const base = {
      schemaVersion: 1 as const,
      compilerVersion: PROJECT_INSTRUCTION_COMPILER_VERSION,
      agentsHash: "a".repeat(64),
      inputHash: "b".repeat(64),
      resultHash: "c".repeat(64),
      promptHash: "d".repeat(64),
      rulesCatalogHash: "e".repeat(64),
      skillsCatalogHash: "f".repeat(64),
      rulesCatalogPages: [],
      skillsCatalogPages: [],
      mode: "fallback" as const,
      compilerStatus: "failed" as const,
      promptFile: "prompt.md" as const,
      rulesCatalogFile: "rules/catalog.md" as const,
      skillsCatalogFile: "skills/catalog.md" as const,
      sources: [],
      rules: [],
      skills: [],
    };
    expect(parseProjectInstructionManifest(base)).toBeUndefined();
    expect(
      parseProjectInstructionManifest({ ...base, compilerDiagnostic: "project instruction compiler failed" }),
    ).toBeDefined();
    expect(
      parseProjectInstructionManifest({
        ...base,
        compilerStatus: "success",
        compilerDiagnostic: "project instruction compiler failed",
      }),
    ).toBeUndefined();

    const success = {
      ...base,
      mode: "compiled" as const,
      compilerStatus: "success" as const,
      compilerUsage: { input: 10, output: 2, cacheRead: 3, cacheWrite: 1, total: 16 },
    };
    expect(parseProjectInstructionManifest(success)?.compilerUsage).toEqual(success.compilerUsage);
    expect(
      parseProjectInstructionManifest({
        ...success,
        compilerUsage: { ...success.compilerUsage, rawResponse: "private-provider-payload" },
      }),
    ).toBeUndefined();
  });
});
