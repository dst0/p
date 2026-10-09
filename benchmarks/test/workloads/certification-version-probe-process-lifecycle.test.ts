import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bindCertifiedHarness } from "../../src/workloads/certification-binding.ts";
import { verifyCertifiedCandidateVersions } from "../../src/workloads/certification-version-probes.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

function markedChildPids(marker: string): number[] {
  const result = spawnSync("ps", ["-axo", "pid=,stat=,command="], { encoding: "utf8" });
  assert.equal(result.status, 0);
  return result.stdout.split("\n").flatMap((line) => {
    if (!line.includes(marker)) return [];
    const match = /^\s*(\d+)\s+(\S+)\s+/u.exec(line);
    return match && !match[2].startsWith("Z") ? [Number(match[1])] : [];
  });
}

test(
  "certified version probes reject forking binaries without leaving a child",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "certified-version-child-"));
    const marker = `p-certified-version-child-${randomUUID()}`;
    try {
      const runtime = join(root, "runtime");
      mkdirSync(runtime);
      writeFileSync(join(runtime, "package.json"), JSON.stringify({ version: "5.0.2" }));
      const pi = join(runtime, "pi");
      writeFileSync(
        pi,
        [
          "#!/bin/sh",
          `'${process.execPath}' -e 'setInterval(() => {}, 1000)' '${marker}' >/dev/null 2>&1 &`,
          "printf '1.0.0\\n'",
          "",
        ].join("\n"),
      );
      chmodSync(pi, 0o755);
      const kilo = join(runtime, "kilo");
      writeFileSync(kilo, "#!/bin/sh\nprintf '2.0.0\\n'\n");
      chmodSync(kilo, 0o755);
      const instructions = join(root, "AGENTS.md");
      writeFileSync(instructions, "# Neutral instructions\n");
      const binding = bindCertifiedHarness({
        pSnapshotPath: runtime,
        pSnapshotSha256: "a".repeat(64),
        pVersion: "5.0.2",
        piExecutable: pi,
        piVersion: "1.0.0",
        kiloExecutable: kilo,
        kiloVersion: "2.0.0",
        projectInstructionsFile: instructions,
      });
      const options = parseRunnerArgs([
        "--certified",
        "--model",
        "surface/model",
        "--expected-resolved-model",
        "backend/model",
        "--runs",
        "3",
        "--p-cli",
        pi,
        "--pi-executable",
        pi,
        "--kilo-executable",
        kilo,
      ]);
      options.candidateRuntimePath = runtime;

      await assert.rejects(verifyCertifiedCandidateVersions(options, binding), /failed or timed out/u);
      assert.deepEqual(markedChildPids(marker), [], "candidate --version left a background child running");
    } finally {
      for (const pid of markedChildPids(marker)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Child already exited.
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "certified Kilo version probe runs its frozen companion without forking",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "certified-kilo-version-child-"));
    try {
      const runtime = join(root, "runtime");
      mkdirSync(runtime);
      writeFileSync(join(runtime, "package.json"), JSON.stringify({ version: "5.0.2" }));
      const pi = join(runtime, "pi");
      writeFileSync(pi, "#!/bin/sh\nprintf '1.0.0\\n'\n");
      chmodSync(pi, 0o755);
      const kilo = join(runtime, "kilo");
      const inner = join(runtime, ".kilo");
      const outside = join(root, "outside-private-data");
      writeFileSync(outside, "test-only value\n");
      writeFileSync(
        inner,
        [
          "#!/usr/bin/env node",
          'const { readFileSync } = require("node:fs");',
          'const { spawnSync } = require("node:child_process");',
          `try { readFileSync(${JSON.stringify(outside)}); process.exit(13); } catch {}`,
          'const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);',
          'if (child.error?.code !== "EPERM") process.exit(14);',
          "process.stdout.write('2.0.0\\n');",
          "",
        ].join("\n"),
      );
      chmodSync(inner, 0o755);
      writeFileSync(
        kilo,
        [
          "#!/usr/bin/env node",
          'const { spawnSync } = require("node:child_process");',
          `const child = spawnSync(process.execPath, [${JSON.stringify(inner)}], { stdio: "inherit" });`,
          "process.exit(child.status ?? 1);",
          "",
        ].join("\n"),
      );
      chmodSync(kilo, 0o755);
      const instructions = join(root, "AGENTS.md");
      writeFileSync(instructions, "# Neutral instructions\n");
      const binding = bindCertifiedHarness({
        pSnapshotPath: runtime,
        pSnapshotSha256: "a".repeat(64),
        pVersion: "5.0.2",
        piExecutable: pi,
        piVersion: "1.0.0",
        kiloExecutable: kilo,
        kiloVersion: "2.0.0",
        projectInstructionsFile: instructions,
      });
      const options = parseRunnerArgs([
        "--certified",
        "--model",
        "surface/model",
        "--expected-resolved-model",
        "backend/model",
        "--runs",
        "3",
        "--pi-executable",
        pi,
        "--pi-version",
        "1.0.0",
        "--kilo-executable",
        kilo,
        "--kilo-version",
        "2.0.0",
      ]);
      options.candidateRuntimePath = runtime;

      await verifyCertifiedCandidateVersions(options, binding);
      writeFileSync(inner, "#!/usr/bin/env node\nprocess.stdout.write('2.0.0\\n');\n");
      await assert.rejects(
        verifyCertifiedCandidateVersions(options, binding),
        /Frozen kilo version probe executable changed before certified verification/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
