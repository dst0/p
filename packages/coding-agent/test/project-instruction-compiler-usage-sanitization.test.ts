import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadCachedCompilationFailure,
  persistCompilationFailure,
} from "../src/core/project-instructions/compilation-cache.ts";
import type {
  ProjectInstructionCompilerAttemptDiagnostic,
  ProjectInstructionCompilerFailureTelemetry,
} from "../src/core/project-instructions/compiler-attempt-diagnostics.ts";
import { validateProjectInstructionCompilerResult } from "../src/core/project-instructions/compiler-validation.ts";
import { hashText } from "../src/core/project-instructions/content.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction compiler usage sanitization", () => {
  it("projects custom compiler usage onto the public numeric fields", () => {
    const privateMarker = "private-provider-payload";
    const contaminatedUsage = {
      input: 10,
      output: 2,
      cacheRead: 3,
      cacheWrite: 1,
      total: 16,
      rawResponse: privateMarker,
    };
    const validated = validateProjectInstructionCompilerResult(
      {
        body: "No source constraints apply to every task.",
        triggers: {},
        classifications: { modules: { rules: "always-on" }, constraints: {} },
        alwaysOn: {},
        usage: contaminatedUsage,
      },
      [{ id: "rules", link: "rules/rules.md", title: "Rules", sourcePath: "/workspace/AGENTS.md", content: "" }],
      [],
    );

    expect(validated.usage).toEqual({ input: 10, output: 2, cacheRead: 3, cacheWrite: 1, total: 16 });
    expect(JSON.stringify(validated)).not.toContain(privateMarker);
  });

  it("rejects hash-valid cached telemetry with mismatched attempts, malformed diagnostics, or negative usage", () => {
    const root = mkdtempSync(join(tmpdir(), "p-compiler-usage-cache-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, ".git"));
    const workspaceRoot = realpathSync(root);
    const cacheDir = join(workspaceRoot, ".pdev", "instructions");
    const options = {
      cacheDir,
      workspaceRoot,
      agentsHash: "a".repeat(64),
      compilerVersion: "test",
      compilerIdentity: "test",
    };
    const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 };
    const attempt: ProjectInstructionCompilerAttemptDiagnostic = {
      kind: "grounding-semantic",
      usage,
      elapsedMs: 1,
    };
    const compilerFailure: ProjectInstructionCompilerFailureTelemetry = {
      attemptCount: 2,
      failureKinds: ["grounding-semantic", "grounding-semantic"],
      attemptDiagnostics: [attempt, attempt],
      usage,
      elapsedMs: 2,
    };
    const mutations: Array<(record: StoredFailureRecord) => void> = [
      (record) => {
        record.compilerFailure.failureKinds = ["grounding-semantic"];
      },
      (record) => {
        record.compilerFailure.attemptDiagnostics[0] = null as unknown as ProjectInstructionCompilerAttemptDiagnostic;
      },
      (record) => {
        record.compilerFailure.usage.input = -1;
      },
    ];

    for (const mutate of mutations) {
      persistCompilationFailure(options, {
        failedAtMs: Date.now() - 1,
        error: "Error: Instruction compiler failed",
        compilerFailure,
      });
      const failureName = readdirSync(join(cacheDir, "compilations")).find((name) => name.endsWith(".failure.json"));
      expect(failureName).toBeDefined();
      const failurePath = join(cacheDir, "compilations", failureName!);
      const record = JSON.parse(readFileSync(failurePath, "utf8")) as StoredFailureRecord;
      mutate(record);
      record.resultHash = undefined;
      record.resultHash = hashText(JSON.stringify(recordWithoutUndefined(record)));
      writeFileSync(failurePath, `${JSON.stringify(record, null, 2)}\n`);

      expect(loadCachedCompilationFailure(options)).toBeUndefined();
    }
  });
});

interface StoredFailureRecord {
  schemaVersion: number;
  agentsHash: string;
  compilerVersion: string;
  compilerIdentity: string;
  failedAtMs: number;
  error: string;
  compilerFailure: ProjectInstructionCompilerFailureTelemetry & {
    attemptDiagnostics: ProjectInstructionCompilerAttemptDiagnostic[];
  };
  resultHash?: string;
}

function recordWithoutUndefined(record: StoredFailureRecord): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
