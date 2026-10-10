import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bindCertifiedHarness } from "../../src/workloads/certification-binding.ts";
import { verifyCertifiedCandidateVersions } from "../../src/workloads/certification-version-probes.ts";
import { resolveAgentVersions } from "../../src/workloads/installed-agent-versions.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

function versionExecutable(root: string, name: string, version: string, marker: string): string {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${name}' >> '${marker}'\nprintf '%s\\n' '${version}'\n`);
  chmodSync(path, 0o755);
  return path;
}

test("certified version discovery never executes candidate binaries before containment", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-versions-"));
  try {
    const marker = join(root, "executed");
    const pi = versionExecutable(root, "pi", "1.0.0", marker);
    const kilo = versionExecutable(root, "kilo", "2.0.0", marker);
    const pPackage = join(root, "p");
    mkdirSync(join(pPackage, "dist"), { recursive: true });
    writeFileSync(join(pPackage, "package.json"), JSON.stringify({ version: "5.0.2" }));
    const options = parseRunnerArgs([
      "--certified",
      "--model",
      "surface/model",
      "--expected-resolved-model",
      "backend/model",
      "--runs",
      "3",
      "--p-cli",
      join(pPackage, "dist", "cli.js"),
      "--pi-executable",
      pi,
      "--pi-version",
      "1.0.0",
      "--kilo-executable",
      kilo,
      "--kilo-version",
      "2.0.0",
    ]);

    assert.deepEqual(resolveAgentVersions(options), { pi: "1.0.0", p: "5.0.2", kilo: "2.0.0" });
    assert.equal(existsSync(marker), false, "candidate --version executed with ambient process authority");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("certified binding freezes executable identity without running candidate code", async () => {
  const root = mkdtempSync(join(tmpdir(), "certified-binding-"));
  try {
    const marker = join(root, "executed");
    const pi = versionExecutable(root, "pi", "1.0.0", marker);
    const kilo = versionExecutable(root, "kilo", "2.0.0", marker);
    const pSnapshot = join(root, "p-snapshot");
    mkdirSync(pSnapshot);
    writeFileSync(join(pSnapshot, "package.json"), JSON.stringify({ version: "5.0.2" }));
    const instructions = join(root, "AGENTS.md");
    writeFileSync(instructions, "# Neutral instructions\n");
    const inputs = {
      pSnapshotPath: pSnapshot,
      pSnapshotSha256: "a".repeat(64),
      pVersion: "5.0.2",
      piExecutable: pi,
      piVersion: "1.0.0",
      kiloExecutable: kilo,
      kiloVersion: "2.0.0",
      projectInstructionsFile: instructions,
    };

    const binding = bindCertifiedHarness(inputs);
    assert.equal(binding.pi.version, "1.0.0");
    assert.equal(binding.kilo.version, "2.0.0");
    assert.equal(existsSync(marker), false, "binding executed candidate --version outside sandbox");
    assert.equal(readFileSync(binding.pi.path).length > 0, true);
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
    options.candidateRuntimePath = pSnapshot;
    chmodSync(pi, 0o777);
    await assert.rejects(verifyCertifiedCandidateVersions(options, binding), /group- or world-writable/u);
    assert.equal(existsSync(marker), false, "unsafe executable ran before safety rejection");
    chmodSync(pi, 0o755);
    writeFileSync(pi, "#!/bin/sh\nprintf 'changed\\n'\n");
    chmodSync(pi, 0o755);
    await assert.rejects(verifyCertifiedCandidateVersions(options, binding), /changed before certified version probe/u);
    assert.equal(existsSync(marker), false, "tampered executable ran before hash rejection");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("certified binding refuses an alternate Node executable without running it", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-node-binding-"));
  try {
    const marker = join(root, "executed");
    const alternateNode = versionExecutable(root, "node", "v99.0.0", marker);
    const pi = versionExecutable(root, "pi", "1.0.0", marker);
    const kilo = versionExecutable(root, "kilo", "2.0.0", marker);
    const pSnapshot = join(root, "p-snapshot");
    mkdirSync(pSnapshot);
    writeFileSync(join(pSnapshot, "package.json"), JSON.stringify({ version: "5.0.2" }));
    const instructions = join(root, "AGENTS.md");
    writeFileSync(instructions, "# Neutral instructions\n");

    assert.throws(
      () =>
        bindCertifiedHarness({
          nodeExecutable: alternateNode,
          pSnapshotPath: pSnapshot,
          pSnapshotSha256: "a".repeat(64),
          pVersion: "5.0.2",
          piExecutable: pi,
          piVersion: "1.0.0",
          kiloExecutable: kilo,
          kiloVersion: "2.0.0",
          projectInstructionsFile: instructions,
        }),
      /current process runtime/u,
    );
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "candidate version probes use private environment and sandboxed file access",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "certified-version-sandbox-"));
    const oldSentinel = process.env.CERTIFIED_VERSION_SENTINEL;
    const listener = createServer((socket) => socket.destroy());
    try {
      await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
      const address = listener.address();
      assert.ok(address && typeof address !== "string");
      const runtime = join(root, "runtime");
      const output = join(root, "output");
      const piConfig = join(root, "pi-config");
      const kiloConfig = join(root, "kilo-config");
      for (const path of [runtime, output, piConfig, kiloConfig]) mkdirSync(path);
      writeFileSync(join(runtime, "package.json"), JSON.stringify({ version: "5.0.2" }));
      writeFileSync(join(piConfig, "host-auth"), "not-a-real-secret\n");
      writeFileSync(join(kiloConfig, "host-auth"), "not-a-real-secret\n");
      const outsideFile = join(root, "host-secret");
      writeFileSync(outsideFile, "not-a-real-secret\n");
      const versionScript = (name: string, version: string, configDir: string): string => {
        const path = join(runtime, `${name}.js`);
        writeFileSync(
          path,
          [
            "#!/usr/bin/env node",
            'const fs = require("node:fs");',
            'const net = require("node:net");',
            "if (process.env.CERTIFIED_VERSION_SENTINEL) process.exit(7);",
            "if (!fs.statSync(process.env.HOME).isDirectory()) process.exit(8);",
            `try { fs.readFileSync(${JSON.stringify(outsideFile)}); process.exit(9); } catch {}`,
            `try { fs.writeFileSync(${JSON.stringify(join(output, "tampered"))}, "x"); process.exit(10); } catch {}`,
            `try { fs.readFileSync(${JSON.stringify(join(configDir, "host-auth"))}); process.exit(12); } catch {}`,
            `const socket = net.connect(${address.port}, "127.0.0.1");`,
            'socket.once("connect", () => process.exit(13));',
            `socket.once("error", () => { clearTimeout(timer); socket.destroy(); process.stdout.write(${JSON.stringify(`${version}\n`)}); });`,
            "const timer = setTimeout(() => process.exit(14), 2000);",
            "",
          ].join("\n"),
        );
        chmodSync(path, 0o755);
        return path;
      };
      const pi = versionScript("pi", "1.0.0", piConfig);
      const kilo = versionScript("kilo", "2.0.0", kiloConfig);
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
      options.certifiedNetworkHosts = [`localhost:${address.port}`];
      process.env.CERTIFIED_VERSION_SENTINEL = "ambient-only";
      await assert.doesNotReject(verifyCertifiedCandidateVersions(options, binding));
      binding.pi.version = "wrong";
      await assert.rejects(
        verifyCertifiedCandidateVersions(options, binding),
        /failed sandboxed version verification/u,
      );
    } finally {
      if (oldSentinel === undefined) delete process.env.CERTIFIED_VERSION_SENTINEL;
      else process.env.CERTIFIED_VERSION_SENTINEL = oldSentinel;
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
