import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { benchmarkSandboxExecutable } from "../../src/harness/benchmark-isolation.ts";
import { commandForAgent, sandboxedCommandIfNeeded } from "../../src/workloads/agent-command.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

function certifiedFixture(root: string) {
  const runtime = join(root, "runtime");
  const workspace = join(root, "workspace");
  const config = join(root, "config");
  for (const path of [runtime, workspace, config]) mkdirSync(path);
  const options = parseRunnerArgs([
    "--certified",
    "--model",
    "provider/model",
    "--expected-resolved-model",
    "provider/model",
    "--runs",
    "3",
  ]);
  options.candidateRuntimePath = runtime;
  return { options, workspace, config };
}

test("certified P commands do not inherit a foreign extra CA path", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-inherited-ca-"));
  const previousHome = process.env.HOME;
  const previousCa = process.env.NODE_EXTRA_CA_CERTS;
  try {
    process.env.HOME = root;
    const foreignCa = join(root, "foreign-ca.pem");
    writeFileSync(foreignCa, "unrelated fixture\n");
    process.env.NODE_EXTRA_CA_CERTS = foreignCa;
    const { options, workspace, config } = certifiedFixture(root);
    const command = commandForAgent("p", options, { prompt: "fixture", timeoutSeconds: 30 }, config, workspace);
    assert.equal(command.env.NODE_EXTRA_CA_CERTS, undefined);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = previousCa;
    rmSync(root, { recursive: true, force: true });
  }
});

test("certified sandbox rejects a foreign CA path supplied by another command", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-command-ca-"));
  try {
    const foreignCa = join(root, "foreign-ca.pem");
    writeFileSync(foreignCa, "unrelated fixture\n");
    const { options, workspace, config } = certifiedFixture(root);
    const command = {
      executable: process.execPath,
      args: [],
      env: { NODE_EXTRA_CA_CERTS: foreignCa },
      cwd: workspace,
    };
    assert.throws(() => sandboxedCommandIfNeeded(command, options, workspace, config), /Certified extra CA/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("certified commands reject symlinked and non-file canonical CA paths", () => {
  for (const kind of ["symlink", "directory"] as const) {
    const root = mkdtempSync(join(tmpdir(), `benchmark-${kind}-ca-`));
    const previousHome = process.env.HOME;
    const previousCa = process.env.NODE_EXTRA_CA_CERTS;
    try {
      process.env.HOME = root;
      delete process.env.NODE_EXTRA_CA_CERTS;
      const caDir = join(root, ".p", "agent");
      mkdirSync(caDir, { recursive: true });
      const caPath = join(caDir, "ca.pem");
      if (kind === "symlink") {
        writeFileSync(join(caDir, "auth.json"), "unrelated fixture\n");
        symlinkSync("auth.json", caPath);
      } else {
        mkdirSync(caPath);
      }
      const { options, workspace, config } = certifiedFixture(root);
      assert.throws(
        () => commandForAgent("pi", options, { prompt: "fixture", timeoutSeconds: 30 }, config, workspace),
        /Certified extra CA/u,
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
      else process.env.NODE_EXTRA_CA_CERTS = previousCa;
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("certified commands reject a CA path hard-linked to a sibling credential", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-hardlink-ca-"));
  const previousHome = process.env.HOME;
  const previousCa = process.env.NODE_EXTRA_CA_CERTS;
  try {
    process.env.HOME = root;
    delete process.env.NODE_EXTRA_CA_CERTS;
    const caDir = join(root, ".p", "agent");
    mkdirSync(caDir, { recursive: true });
    const authPath = join(caDir, "auth.json");
    writeFileSync(authPath, "synthetic credential fixture\n");
    linkSync(authPath, join(caDir, "ca.pem"));
    const { options, workspace, config } = certifiedFixture(root);
    assert.throws(
      () => commandForAgent("p", options, { prompt: "fixture", timeoutSeconds: 30 }, config, workspace),
      /Certified extra CA/u,
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = previousCa;
    rmSync(root, { recursive: true, force: true });
  }
});

test("certified Kilo replaces inherited foreign CA with the canonical CA", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-kilo-ca-"));
  const previousHome = process.env.HOME;
  const previousCa = process.env.NODE_EXTRA_CA_CERTS;
  try {
    process.env.HOME = root;
    const caDir = join(root, ".p", "agent");
    mkdirSync(caDir, { recursive: true });
    const caPath = join(caDir, "ca.pem");
    writeFileSync(caPath, "synthetic CA fixture\n");
    process.env.NODE_EXTRA_CA_CERTS = join(root, "foreign-ca.pem");
    const { options, workspace, config } = certifiedFixture(root);
    options.kiloModel = "provider/model";
    const command = commandForAgent("kilo", options, { prompt: "fixture", timeoutSeconds: 30 }, config, workspace);
    assert.equal(command.env.NODE_EXTRA_CA_CERTS, caPath);
    if (benchmarkSandboxExecutable()) {
      assert.doesNotThrow(() => sandboxedCommandIfNeeded(command, options, workspace, config));
    }
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = previousCa;
    rmSync(root, { recursive: true, force: true });
  }
});
