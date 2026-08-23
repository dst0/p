import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadCachedCompilationFailure,
  persistCompilationFailure,
} from "../src/core/project-instructions/compilation-cache.ts";
import {
  createProjectInstructionCompilerFailure,
  type ProjectInstructionCompilerFailureTelemetry,
} from "../src/core/project-instructions/compiler-attempt-diagnostics.ts";
import { hashText } from "../src/core/project-instructions/content.ts";
import { prepareProjectInstructions } from "../src/core/project-instructions/processor.ts";
import type { ProjectInstructionCompiler } from "../src/core/project-instructions/types.ts";
import { createProjectInstructionCompilation } from "./project-instruction-compiler-fixture.ts";

const temporaryDirectories: string[] = [];
const SOURCE_MARKER = "private-source-marker-must-not-be-persisted";
const RAW_RESPONSE = "private raw compiler response must not be persisted";
const SELECTED_ID = "private-selected-constraint-id";
const PROVIDER_MESSAGE = "short backend diagnostic must not persist";
const aggregateUsage = { input: 200, output: 20, cacheRead: 0, cacheWrite: 0, total: 220 };
const attemptDiagnostics = [
  {
    kind: "grounding-semantic",
    invariant: "body-budget",
    selectedCount: 53,
    materializedBodyChars: 10_721,
    hardLimitChars: 3_500,
    usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, total: 110 },
    elapsedMs: 900,
  },
  {
    kind: "grounding-semantic",
    invariant: "body-budget",
    selectedCount: 41,
    materializedBodyChars: 8_204,
    hardLimitChars: 3_500,
    usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, total: 110 },
    elapsedMs: 1_100,
  },
];
const compilerFailure = {
  attemptCount: 2,
  failureKinds: ["grounding-semantic", "grounding-semantic"],
  attemptDiagnostics,
  usage: aggregateUsage,
  elapsedMs: 2_000,
};

interface StoredFailure {
  schemaVersion: number;
  agentsHash: string;
  compilerVersion: string;
  compilerIdentity: string;
  failedAtMs: number;
  error: string;
  compilerFailure?: {
    attemptCount: number;
    failureKinds: string[];
    attemptDiagnostics: typeof attemptDiagnostics;
  };
  resultHash: string;
}

function createWorkspace(): { root: string; agentsPath: string; cacheDir: string; content: string } {
  const root = mkdtempSync(join(tmpdir(), "p-compiler-failure-telemetry-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const content = Array.from(
    { length: 90 },
    (_, index) =>
      `## Activity ${index}\n\nWhen editing activity ${index}, preserve its local invariant. ${SOURCE_MARKER}. ${"detail ".repeat(16)}\n`,
  ).join("");
  const agentsPath = join(root, "AGENTS.md");
  writeFileSync(agentsPath, content);
  return { root, agentsPath, cacheDir: join(root, ".pdev", "instructions"), content };
}

function contaminatedCompilerFailure(): ProjectInstructionCompilerFailureTelemetry {
  const contaminatedAttempts = attemptDiagnostics.map((attempt) => ({
    ...attempt,
    rawResponse: RAW_RESPONSE,
    sourceText: SOURCE_MARKER,
    selectedIds: [SELECTED_ID],
    providerMessage: PROVIDER_MESSAGE,
  }));
  return {
    ...structuredClone(compilerFailure),
    attemptDiagnostics: contaminatedAttempts,
    rawResponse: RAW_RESPONSE,
    sourceText: SOURCE_MARKER,
    selectedIds: [SELECTED_ID],
    providerMessage: PROVIDER_MESSAGE,
  } as ProjectInstructionCompilerFailureTelemetry;
}

function telemetryError(): Error {
  const contaminatedTelemetry = contaminatedCompilerFailure();
  const error = createProjectInstructionCompilerFailure(contaminatedTelemetry);
  error.message = `Instruction compiler output validation failed: ${PROVIDER_MESSAGE}`;
  return Object.assign(error, {
    rawResponse: RAW_RESPONSE,
    sourceText: SOURCE_MARKER,
    selectedIds: [SELECTED_ID],
    providerMessage: PROVIDER_MESSAGE,
  });
}

function findFailurePath(cacheDir: string): string {
  const directory = join(cacheDir, "compilations");
  const name = readdirSync(directory).find((entry) => entry.endsWith(".failure.json"));
  if (!name) throw new Error("Expected a compiler failure sidecar");
  return join(directory, name);
}

function cacheOptions(root: string, cacheDir: string, record: StoredFailure) {
  return {
    cacheDir: realpathSync(cacheDir),
    workspaceRoot: realpathSync(root),
    agentsHash: record.agentsHash,
    compilerVersion: record.compilerVersion,
    compilerIdentity: record.compilerIdentity,
  };
}

function parseFailure(path: string): StoredFailure {
  return JSON.parse(readFileSync(path, "utf8")) as StoredFailure;
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction compiler failure telemetry cache", () => {
  it("persists and reuses only safe ordered attempt evidence until a later success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00Z"));
    const workspace = createWorkspace();
    let shouldFail = true;
    const compiler = vi.fn<ProjectInstructionCompiler>(async (request) => {
      if (shouldFail) throw telemetryError();
      return createProjectInstructionCompilation(request);
    });
    const options = {
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content: workspace.content }],
      skills: [],
      compiler,
      compilerIdentity: "test/compiler-safe-telemetry",
      compilerFailureBackoffMs: 300_000,
    };

    expect((await prepareProjectInstructions(options)).manifest.mode).toBe("fallback");
    expect(compiler).toHaveBeenCalledOnce();
    const failurePath = findFailurePath(workspace.cacheDir);
    const serialized = readFileSync(failurePath, "utf8");
    const stored = parseFailure(failurePath);
    expect(statSync(failurePath).mode & 0o777).toBe(0o600);
    expect(stored.schemaVersion).toBe(2);
    expect(stored.error).toBe("Error: Instruction compiler output validation failed");
    expect(stored.compilerFailure).toEqual(compilerFailure);
    expect(stored.resultHash).toMatch(/^[a-f0-9]{64}$/u);
    for (const privateValue of [SOURCE_MARKER, RAW_RESPONSE, SELECTED_ID, PROVIDER_MESSAGE]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(loadCachedCompilationFailure(cacheOptions(workspace.root, workspace.cacheDir, stored))).toMatchObject({
      failedAtMs: Date.now(),
      compilerFailure,
    });

    shouldFail = false;
    expect((await prepareProjectInstructions(options)).manifest.mode).toBe("fallback");
    expect(compiler).toHaveBeenCalledOnce();
    expect(readFileSync(failurePath, "utf8")).toBe(serialized);

    vi.advanceTimersByTime(300_001);
    expect((await prepareProjectInstructions(options)).manifest.mode).toBe("compiled");
    expect(compiler).toHaveBeenCalledTimes(2);
    expect(existsSync(failurePath)).toBe(false);
  });

  it("rejects stale-hash tampering and hash-valid non-allowlisted diagnostics", async () => {
    const workspace = createWorkspace();
    const compiler = vi.fn<ProjectInstructionCompiler>(async () => {
      throw telemetryError();
    });
    await prepareProjectInstructions({
      cwd: workspace.root,
      cacheDir: workspace.cacheDir,
      contextFiles: [{ path: workspace.agentsPath, content: workspace.content }],
      skills: [],
      compiler,
      compilerIdentity: "test/compiler-safe-telemetry",
    });
    const failurePath = findFailurePath(workspace.cacheDir);
    const original = parseFailure(failurePath);
    const options = cacheOptions(workspace.root, workspace.cacheDir, original);
    expect(original.schemaVersion).toBe(2);
    expect(original.compilerFailure).toBeDefined();
    if (!original.compilerFailure) return;

    const staleHash = structuredClone(original);
    staleHash.compilerFailure!.attemptDiagnostics[0]!.selectedCount += 1;
    writeFileSync(failurePath, `${JSON.stringify(staleHash, null, 2)}\n`);
    expect(loadCachedCompilationFailure(options)).toBeUndefined();

    const hashValidAllowlisted = structuredClone(original);
    hashValidAllowlisted.compilerFailure!.attemptDiagnostics[0]!.selectedCount += 1;
    const allowlistedWithoutHash = Object.fromEntries(
      Object.entries(hashValidAllowlisted).filter(([key]) => key !== "resultHash"),
    );
    hashValidAllowlisted.resultHash = hashText(JSON.stringify(allowlistedWithoutHash));
    writeFileSync(failurePath, `${JSON.stringify(hashValidAllowlisted, null, 2)}\n`);
    expect(loadCachedCompilationFailure(options)?.compilerFailure?.attemptDiagnostics?.[0]?.selectedCount).toBe(54);

    const impossibleAttemptCount = structuredClone(original);
    impossibleAttemptCount.compilerFailure!.attemptCount = 3;
    impossibleAttemptCount.compilerFailure!.failureKinds.push("grounding-semantic");
    impossibleAttemptCount.compilerFailure!.attemptDiagnostics.push(
      structuredClone(impossibleAttemptCount.compilerFailure!.attemptDiagnostics[0]!),
    );
    const impossibleWithoutHash = Object.fromEntries(
      Object.entries(impossibleAttemptCount).filter(([key]) => key !== "resultHash"),
    );
    impossibleAttemptCount.resultHash = hashText(JSON.stringify(impossibleWithoutHash));
    writeFileSync(failurePath, `${JSON.stringify(impossibleAttemptCount, null, 2)}\n`);
    expect(loadCachedCompilationFailure(options)).toBeUndefined();
    const futureFailure = structuredClone(original);
    futureFailure.failedAtMs = Date.now() + 60_000;
    const futureWithoutHash = Object.fromEntries(Object.entries(futureFailure).filter(([key]) => key !== "resultHash"));
    futureFailure.resultHash = hashText(JSON.stringify(futureWithoutHash));
    writeFileSync(failurePath, `${JSON.stringify(futureFailure, null, 2)}\n`);
    expect(loadCachedCompilationFailure(options)).toBeUndefined();
    const zeroLimit = structuredClone(original);
    zeroLimit.compilerFailure!.attemptDiagnostics[0]!.hardLimitChars = 0;
    const zeroLimitWithoutHash = Object.fromEntries(Object.entries(zeroLimit).filter(([key]) => key !== "resultHash"));
    zeroLimit.resultHash = hashText(JSON.stringify(zeroLimitWithoutHash));
    writeFileSync(failurePath, `${JSON.stringify(zeroLimit, null, 2)}\n`);
    expect(loadCachedCompilationFailure(options)).toBeUndefined();

    const withinBudget = structuredClone(original);
    withinBudget.compilerFailure!.attemptDiagnostics[0]!.materializedBodyChars = 3_500;
    const withinBudgetWithoutHash = Object.fromEntries(
      Object.entries(withinBudget).filter(([key]) => key !== "resultHash"),
    );
    withinBudget.resultHash = hashText(JSON.stringify(withinBudgetWithoutHash));
    writeFileSync(failurePath, `${JSON.stringify(withinBudget, null, 2)}\n`);
    expect(loadCachedCompilationFailure(options)).toBeUndefined();

    const nonAllowlisted = structuredClone(original);
    nonAllowlisted.compilerFailure!.attemptDiagnostics[0]!.invariant = PROVIDER_MESSAGE;
    const withoutHash = Object.fromEntries(Object.entries(nonAllowlisted).filter(([key]) => key !== "resultHash"));
    nonAllowlisted.resultHash = hashText(JSON.stringify(withoutHash));
    writeFileSync(failurePath, `${JSON.stringify(nonAllowlisted, null, 2)}\n`);
    expect(loadCachedCompilationFailure(options)).toBeUndefined();
  });

  it("strictly projects direct persistence input before hashing it", () => {
    const workspace = createWorkspace();
    const cacheDir = join(realpathSync(workspace.root), ".pdev", "instructions");
    const options = {
      cacheDir,
      workspaceRoot: realpathSync(workspace.root),
      agentsHash: "a".repeat(64),
      compilerVersion: "test-compiler-v2",
      compilerIdentity: "test/direct-persistence",
    };

    persistCompilationFailure(options, {
      failedAtMs: 123,
      error: `Error: ${PROVIDER_MESSAGE}`,
      compilerFailure: contaminatedCompilerFailure(),
    });

    const failurePath = findFailurePath(cacheDir);
    const serialized = readFileSync(failurePath, "utf8");
    expect(parseFailure(failurePath).error).toBe("Error: Instruction compiler failed");
    expect(parseFailure(failurePath).compilerFailure).toEqual(compilerFailure);
    expect(loadCachedCompilationFailure(options)?.compilerFailure).toEqual(compilerFailure);
    for (const privateValue of [SOURCE_MARKER, RAW_RESPONSE, SELECTED_ID, PROVIDER_MESSAGE]) {
      expect(serialized).not.toContain(privateValue);
    }
  });
});
