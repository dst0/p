import assert from "node:assert/strict";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { captureProjectInstructionEvidence } from "../../src/project-instructions/evidence.ts";
import { createCompiledFixture } from "./evidence-fixture.ts";

type FixtureManifest = {
  compilerUsage: { total: number };
  rules: Array<{ trigger: string; routable: boolean }>;
};

const corruptions: Array<[string, (manifest: FixtureManifest) => void]> = [
  [
    "compiler usage",
    (manifest) => {
      manifest.compilerUsage.total += 1;
    },
  ],
  [
    "rule trigger",
    (manifest) => {
      manifest.rules[0].trigger = "release deployment";
    },
  ],
  [
    "rule routability",
    (manifest) => {
      manifest.rules[0].routable = false;
    },
  ],
  ["marker input hash", () => {}],
];

for (const [label, corrupt] of corruptions) {
  test(`rejects compiled cache with corrupted ${label}`, () => {
    const fixture = createCompiledFixture(
      label === "marker input hash" ? { markerInputHash: "d".repeat(64) } : undefined,
    );
    try {
      const manifest = JSON.parse(readFileSync(fixture.manifestFile, "utf8")) as FixtureManifest;
      corrupt(manifest);
      writeFileSync(fixture.manifestFile, `${JSON.stringify(manifest)}\n`);
      const evidence = captureProjectInstructionEvidence({
        workspace: fixture.root,
        mode: "compiled",
        sourceFile: fixture.sourceFile,
        runtimeContexts: [],
        userTurns: [],
      });
      assert.equal(
        label === "marker input hash" ? evidence.cache?.promptMarkerVerified : evidence.cache,
        label === "marker input hash" ? false : undefined,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test("rejects a corrupted rule artifact even when the manifest is unchanged", () => {
  const fixture = createCompiledFixture();
  try {
    writeFileSync(join(fixture.versionDir, "rules/testing.md"), "corrupted\n");
    const evidence = captureProjectInstructionEvidence({
      workspace: fixture.root,
      mode: "compiled",
      sourceFile: fixture.sourceFile,
      runtimeContexts: [],
      userTurns: [],
    });
    assert.equal(evidence.cache, undefined);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a symlinked compiled-cache root without changing its external target", () => {
  const fixture = createCompiledFixture();
  const external = createCompiledFixture();
  try {
    const cacheRoot = join(fixture.root, ".pdev", "instructions");
    const externalRoot = join(external.root, ".pdev", "instructions");
    const sentinel = readFileSync(join(externalRoot, "current.json"), "utf8");
    rmSync(cacheRoot, { recursive: true });
    symlinkSync(externalRoot, cacheRoot);
    const evidence = captureProjectInstructionEvidence({
      workspace: fixture.root,
      mode: "compiled",
      sourceFile: fixture.sourceFile,
      runtimeContexts: [],
      userTurns: [],
    });
    assert.equal(evidence.cache, undefined);
    assert.equal(readFileSync(join(externalRoot, "current.json"), "utf8"), sentinel);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(external.root, { recursive: true, force: true });
  }
});
