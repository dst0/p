import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";
import { PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS } from "../../../packages/coding-agent/src/core/project-instructions/types.ts";
import { captureVerifiedCompiledCache } from "../../src/project-instructions/cache.ts";
import { BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS } from "../../src/project-instructions/diagnostics.ts";
import { createCompiledFixture } from "./evidence-fixture.ts";

const sourceScenarios: Array<[NonNullable<Parameters<typeof createCompiledFixture>[0]>["sourceScenario"], boolean]> = [
  [undefined, true],
  ["wrong-path", false],
  ["wrong-hash", false],
  ["duplicate", false],
];
for (const [sourceScenario, expected] of sourceScenarios) {
  test(`compiled cache ${expected ? "accepts" : "rejects"} ${sourceScenario ?? "multi-source"} task-source identity`, () => {
    const fixture = createCompiledFixture({ sourceScenario });
    try {
      const captured = captureVerifiedCompiledCache(fixture.root, fixture.sourceSha256);
      assert.ok(captured);
      assert.equal(captured.evidence.sourceHashVerified, expected);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test("compiled cache rejects unknown persisted compiler-usage fields", () => {
  const fixture = createCompiledFixture({ compilerUsageExtra: { rawResponse: { source: "private-marker" } } });
  try {
    assert.equal(captureVerifiedCompiledCache(fixture.root, fixture.sourceSha256), undefined);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("compiled cache rejects unknown current-pointer fields", () => {
  const fixture = createCompiledFixture({ currentExtra: { rawResponse: { source: "private-marker" } } });
  try {
    assert.equal(captureVerifiedCompiledCache(fixture.root, fixture.sourceSha256), undefined);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

const compilerDiagnostics: Array<
  NonNullable<NonNullable<Parameters<typeof createCompiledFixture>[0]>["compilerDiagnostic"]>
> = [
  "project instruction compiler model does not support thinking off",
  "project instruction compiler model lacks explicit thinking-disable compatibility",
];
for (const compilerDiagnostic of compilerDiagnostics) {
  test(`compiled cache accepts production diagnostic: ${compilerDiagnostic}`, () => {
    const fixture = createCompiledFixture({ compilerStatus: "failed", compilerDiagnostic });
    try {
      const captured = captureVerifiedCompiledCache(fixture.root, fixture.sourceSha256);
      assert.equal(captured?.evidence.manifest.compilerDiagnostic, compilerDiagnostic);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test("benchmark compiler diagnostics stay in exact production parity", () => {
  assert.deepEqual(BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS, [...PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS]);
});

test("compiled cache rejects manifest-bound canonical prompt with malformed reader guidance", () => {
  const fixture = createCompiledFixture({ malformedGuidance: true });
  try {
    assert.equal(captureVerifiedCompiledCache(fixture.root, fixture.sourceSha256), undefined);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
