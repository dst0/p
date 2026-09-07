import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { materializeProjectInstructionCompilerResult } from "../../../packages/coding-agent/dist/core/project-instructions/compiler-validation.js";
import { prepareProjectInstructions } from "../../../packages/coding-agent/dist/core/project-instructions/processor.js";
import { createBenchmarkAuthOutputGuard } from "../../src/harness/auth-output-guard.ts";
import type {
  PairedBenchmarkResourceOperations,
  PairedBenchmarkResources,
} from "../../src/harness/paired-resources.ts";
import {
  createPairedBenchmarkResources,
  finalizePairedBenchmarkResources,
  settlePairedCellEvidence,
} from "../../src/harness/paired-resources.ts";
import { captureVerifiedCompiledCache } from "../../src/project-instructions/cache.ts";

type ResourceFailure = "runtime" | "scratch" | "private" | "dispose-private" | "remove-scratch" | "remove-runtime";

const resourceOptions = {
  repoRoot: "repo",
  temporaryParent: "temporary",
  modelsSource: "models",
  authSource: "auth",
};

function operations(calls: string[], failure: ResourceFailure): PairedBenchmarkResourceOperations {
  return {
    createRuntime: () => {
      calls.push("create-runtime");
      if (failure === "runtime") throw new Error("runtime failed");
      return "runtime";
    },
    createScratch: () => {
      calls.push("create-scratch");
      if (failure === "scratch") throw new Error("scratch failed");
      return "scratch";
    },
    createPrivate: () => {
      calls.push("create-private");
      if (failure === "private") throw new Error("private failed");
      return {
        models: { path: "models", present: false, sha256: "absent", dispose() {} },
        auth: { path: "auth", present: false, dispose() {} },
        dispose: () => {
          calls.push("dispose-private");
          if (failure === "dispose-private") throw new Error("private disposal failed");
        },
      };
    },
    removeRuntime: () => {
      calls.push("remove-runtime");
      if (failure === "remove-runtime") throw new Error("runtime removal failed");
    },
    removeScratch: () => {
      calls.push("remove-scratch");
      if (failure === "remove-scratch") throw new Error("scratch removal failed");
    },
  };
}

for (const [failure, expected] of [
  ["runtime", ["create-runtime"]],
  ["scratch", ["create-runtime", "create-scratch", "remove-runtime"]],
  ["private", ["create-runtime", "create-scratch", "create-private", "remove-scratch", "remove-runtime"]],
] as const) {
  test(`paired resource setup cleans earlier allocations when ${failure} creation fails`, () => {
    const calls: string[] = [];
    assert.throws(
      () => createPairedBenchmarkResources(resourceOptions, operations(calls, failure)),
      new RegExp(`${failure} failed`, "u"),
    );
    assert.deepEqual(calls, expected);
  });
}

for (const failure of ["dispose-private", "remove-scratch", "remove-runtime"] as const) {
  test(`paired resource disposal attempts every cleanup when ${failure} fails`, () => {
    const calls: string[] = [];
    const resources = createPairedBenchmarkResources(resourceOptions, operations(calls, failure));
    assert.throws(() => resources.dispose(), AggregateError);
    assert.deepEqual(calls.slice(-3), ["dispose-private", "remove-scratch", "remove-runtime"]);
  });
}

test("paired resources preserve path-bound cache identity across canonical child cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-canonical-scratch-"));
  let resources: PairedBenchmarkResources | undefined;
  try {
    const physicalParent = join(root, "physical");
    const aliasParent = join(root, "alias");
    mkdirSync(physicalParent);
    symlinkSync(physicalParent, aliasParent, process.platform === "win32" ? "junction" : "dir");
    assert.notEqual(aliasParent, realpathSync(aliasParent));
    resources = createPairedBenchmarkResources(
      { ...resourceOptions, temporaryParent: aliasParent },
      {
        createRuntime: () => "runtime",
        createPrivate: () => ({
          models: { path: "models", present: false, sha256: "absent", dispose() {} },
          auth: { path: "auth", present: false, dispose() {} },
          dispose() {},
        }),
        removeRuntime() {},
      },
    );
    assert.equal(resources.scratchRoot, realpathSync(resources.scratchRoot));
    assert.equal(resources.scratchRoot.startsWith(`${realpathSync(physicalParent)}${sep}`), true);
    const workspace = join(resources.scratchRoot, "workspace");
    const agentsPath = join(workspace, "AGENTS.md");
    const content = `# Rules\n${Array.from({ length: 240 }, (_, index) => `- When code changes, run check ${index}.`).join("\n")}\n`;
    mkdirSync(workspace);
    writeFileSync(agentsPath, content);
    let compilerCalls = 0;
    const compiler: NonNullable<Parameters<typeof prepareProjectInstructions>[0]["compiler"]> = async ({
      modules,
      constraints,
    }) => {
      compilerCalls += 1;
      return materializeProjectInstructionCompilerResult(
        {
          modules: Object.fromEntries(modules.map((module) => [module.id, "routed"])),
          constraints: Object.fromEntries(constraints.map((constraint) => [constraint.id, "routed"])),
        },
        Object.fromEntries(modules.map((module) => [module.id, "code changes"])),
        constraints,
      );
    };
    const prepare = (cwd: string, path: string) =>
      prepareProjectInstructions({
        cwd,
        cacheDir: join(cwd, ".pdev", "instructions"),
        contextFiles: [{ path, content }],
        skills: [],
        compilerIdentity: "paired-path-regression",
        compiler,
      });
    await prepare(workspace, agentsPath);
    const seeded = captureVerifiedCompiledCache(workspace, createHash("sha256").update(content).digest("hex"));
    assert.ok(seeded);
    const canonicalWorkspace = realpathSync(workspace);
    await prepare(canonicalWorkspace, join(canonicalWorkspace, "AGENTS.md"));
    const reused = captureVerifiedCompiledCache(workspace, createHash("sha256").update(content).digest("hex"));
    assert.ok(reused);
    assert.equal(compilerCalls, 1);
    assert.equal(reused.evidence.cacheClosureSha256, seeded.evidence.cacheClosureSha256);
  } finally {
    resources?.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const initialState of ["absent", "present", "symlinked"]) {
  const article = initialState === "absent" ? "an" : "a";
  test(`paired finalization recaptures ${article} ${initialState} auth source after live rotation`, () => {
    const root = mkdtempSync(join(tmpdir(), "benchmark-auth-finalize-"));
    const source = join(root, "auth.json");
    const snapshot = join(root, "snapshot", "auth.json");
    const output = join(root, "output");
    if (initialState === "present") writeFileSync(source, '{"token":"initial"}\n');
    if (initialState === "symlinked") {
      const target = join(root, "live-auth.json");
      writeFileSync(target, '{"token":"initial"}\n');
      symlinkSync(target, source);
    }
    mkdirSync(join(root, "snapshot"));
    mkdirSync(output);
    const guard = createBenchmarkAuthOutputGuard([source, snapshot]);
    const rotated = `${JSON.stringify({ token: `${initialState}-rotated-secret` })}\n`;
    writeFileSync(source, rotated);
    const rotatedHash = createHash("sha256").update(rotated).digest("hex");
    writeFileSync(join(output, "artifact.log"), `${rotated}${rotatedHash}\n`);
    let disposed = false;
    finalizePairedBenchmarkResources(
      {
        dispose: () => {
          disposed = true;
        },
      },
      guard,
      output,
      [source, snapshot],
    );
    const retained = readFileSync(join(output, "artifact.log"), "utf8");
    assert.equal(retained.includes(rotated), false);
    assert.equal(retained.includes(rotatedHash), false);
    assert.equal(disposed, true);
    rmSync(root, { recursive: true, force: true });
  });
}

test("paired finalization attempts capture, sanitization, and disposal after failures", () => {
  const calls: string[] = [];
  assert.throws(
    () =>
      finalizePairedBenchmarkResources(
        {
          dispose: () => {
            calls.push("dispose");
            throw new Error("dispose failed");
          },
        },
        {
          capture: (path) => {
            calls.push(`capture-${path}`);
            throw new Error("capture failed");
          },
          sanitizeTree: () => {
            calls.push("sanitize");
            throw new Error("sanitize failed");
          },
          retainTree: () => {
            throw new Error("retain should not run");
          },
        },
        "output",
        ["source", "snapshot"],
      ),
    AggregateError,
  );
  assert.deepEqual(calls, ["capture-source", "capture-snapshot", "sanitize", "dispose"]);
});

test("an untrusted crashed child leaves no scratch or retained cell evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-crashed-child-"));
  const script = join(root, "crash-child.js");
  const scratch = join(root, "scratch");
  const cell = join(root, "cell");
  writeFileSync(
    script,
    'import { mkdirSync, writeFileSync } from "node:fs";\nmkdirSync(process.argv[2]);\nwriteFileSync(process.argv[2] + "/leak.log", "refreshed-secret\\n/private/cell/auth.json\\n");\nprocess.kill(process.pid, "SIGKILL");\n',
  );
  const child = spawnSync(process.execPath, [script, scratch]);
  assert.notEqual(child.status, 0);
  settlePairedCellEvidence(undefined, [], scratch, cell, false);
  assert.equal(existsSync(scratch), false);
  assert.equal(existsSync(cell), false);
  rmSync(root, { recursive: true, force: true });
});

test("a rotated live auth source is redacted before the cell becomes retained", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-cell-recapture-"));
  const source = join(root, "auth.json");
  const snapshot = join(root, "snapshot-auth.json");
  const scratch = join(root, "scratch");
  const cell = join(root, "cell");
  const rotated = '{"token":"per-cell-rotated-secret"}\n';
  writeFileSync(source, '{"token":"initial"}\n');
  writeFileSync(snapshot, '{"token":"initial"}\n');
  const guard = createBenchmarkAuthOutputGuard([source, snapshot]);
  writeFileSync(source, rotated);
  mkdirSync(scratch);
  writeFileSync(join(scratch, "artifact.log"), `${rotated}${createHash("sha256").update(rotated).digest("hex")}\n`);
  settlePairedCellEvidence(guard, [source, snapshot], scratch, cell, true);
  const retained = readFileSync(join(cell, "artifact.log"), "utf8");
  assert.equal(retained.includes("per-cell-rotated-secret"), false);
  assert.equal(existsSync(scratch), false);
  rmSync(root, { recursive: true, force: true });
});
