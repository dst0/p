import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { registerBenchmarkCandidate } from "./benchmark-candidate-registry.js";

const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);
const FINGERPRINT_C = "c".repeat(64);

function withRepository(run) {
  const repoRoot = mkdtempSync(join(tmpdir(), "p-candidate-registry-"));
  const manifest = `${JSON.stringify({ name: "sentinel", version: "9.9.9", type: "module" })}\n`;
  writeFileSync(join(repoRoot, "package.json"), manifest, "utf8");
  try {
    run(repoRoot);
    assert.equal(readFileSync(join(repoRoot, "package.json"), "utf8"), manifest);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

async function withAsyncRepository(run) {
  const repoRoot = mkdtempSync(join(tmpdir(), "p-candidate-registry-race-"));
  try {
    await run(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

async function registerConcurrently(repoRoot, registrations) {
  const workerPath = join(repoRoot, "candidate-worker.js");
  const barrierPath = join(repoRoot, "start");
  writeFileSync(
    workerPath,
    [
      'import { existsSync } from "node:fs";',
      'import { setTimeout as delay } from "node:timers/promises";',
      `import { registerBenchmarkCandidate } from ${JSON.stringify(new URL("./benchmark-candidate-registry.js", import.meta.url).href)};`,
      "const [repoRoot, barrierPath, candidateVersion, runtimeSha256] = process.argv.slice(2);",
      "while (!existsSync(barrierPath)) await delay(1);",
      "try { registerBenchmarkCandidate(repoRoot, candidateVersion, runtimeSha256); }",
      "catch (error) { console.error(error.message); process.exitCode = 2; }",
    ].join("\n"),
    "utf8",
  );
  const workers = registrations.map(({ candidateVersion, runtimeSha256 }) => {
    const child = spawn(process.execPath, [workerPath, repoRoot, barrierPath, candidateVersion, runtimeSha256], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    return { child, completion: once(child, "close").then(([status]) => ({ status, stderr })) };
  });
  await Promise.all(workers.map(({ child }) => once(child, "spawn")));
  writeFileSync(barrierPath, "start\n", "utf8");
  return Promise.all(workers.map(({ completion }) => completion));
}

test("candidate registry permits reruns only for the identical immutable runtime", () => {
  withRepository((repoRoot) => {
    registerBenchmarkCandidate(repoRoot, "5.0.1-rc.1", FINGERPRINT_A);
    registerBenchmarkCandidate(repoRoot, "5.0.1-rc.1", FINGERPRINT_A);
    assert.throws(
      () => registerBenchmarkCandidate(repoRoot, "5.0.1-rc.1", FINGERPRINT_B),
      /already belongs to a different runtime/u,
    );
    assert.throws(
      () => registerBenchmarkCandidate(repoRoot, "5.0.1-rc.2", FINGERPRINT_A),
      /already registered as 5\.0\.1-rc\.1/u,
    );
    const registryPath = join(repoRoot, ".pdev", "benchmark-candidate-registry.json");
    assert.deepEqual(JSON.parse(readFileSync(registryPath, "utf8")), {
      schemaVersion: 1,
      candidates: [{ candidateVersion: "5.0.1-rc.1", runtimeSha256: FINGERPRINT_A }],
    });
    assert.equal(statSync(join(repoRoot, ".pdev")).mode & 0o777, 0o700);
    assert.equal(statSync(registryPath).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(join(repoRoot, ".pdev")), ["benchmark-candidate-registry.json"]);
  });
});

test("changed runtimes require the strictly next candidate without skips or rollback", () => {
  withRepository((repoRoot) => {
    registerBenchmarkCandidate(repoRoot, "5.0.1-rc.1", FINGERPRINT_A);
    assert.throws(
      () => registerBenchmarkCandidate(repoRoot, "5.0.1-rc.3", FINGERPRINT_B),
      /next candidate must be 5\.0\.1-rc\.2/u,
    );
    registerBenchmarkCandidate(repoRoot, "5.0.1-rc.2", FINGERPRINT_B);
    assert.throws(
      () => registerBenchmarkCandidate(repoRoot, "5.0.1-rc.1", FINGERPRINT_C),
      /already belongs to a different runtime/u,
    );
    assert.throws(
      () => registerBenchmarkCandidate(repoRoot, "5.0.1-rc.4", FINGERPRINT_C),
      /next candidate must be 5\.0\.1-rc\.3/u,
    );
  });
});

test("candidate registry fails closed for malformed state and concurrent ownership", () => {
  withRepository((repoRoot) => {
    const privateDirectory = join(repoRoot, ".pdev");
    mkdirSync(privateDirectory, { mode: 0o700 });
    writeFileSync(join(privateDirectory, "benchmark-candidate-registry.json"), "{}\n", { mode: 0o600 });
    assert.throws(() => registerBenchmarkCandidate(repoRoot, "5.0.1-rc.1", FINGERPRINT_A), /Invalid candidate registry/u);
    writeFileSync(
      join(privateDirectory, "benchmark-candidate-registry.json"),
      `${JSON.stringify({ schemaVersion: 1, candidates: [], unexpected: true })}\n`,
    );
    assert.throws(() => registerBenchmarkCandidate(repoRoot, "5.0.1-rc.1", FINGERPRINT_A), /Invalid candidate registry/u);
  });
  withRepository((repoRoot) => {
    const privateDirectory = join(repoRoot, ".pdev");
    mkdirSync(join(privateDirectory, "benchmark-candidate-registry.lock"), { recursive: true, mode: 0o700 });
    assert.throws(() => registerBenchmarkCandidate(repoRoot, "5.0.1-rc.1", FINGERPRINT_A), /registry is locked/u);
  });
});

test("candidate registry tightens an existing valid registry to private permissions", () => {
  withRepository((repoRoot) => {
    const privateDirectory = join(repoRoot, ".pdev");
    const registryPath = join(privateDirectory, "benchmark-candidate-registry.json");
    mkdirSync(privateDirectory, { mode: 0o755 });
    writeFileSync(
      registryPath,
      `${JSON.stringify({
        schemaVersion: 1,
        candidates: [{ candidateVersion: "5.0.1-rc.1", runtimeSha256: FINGERPRINT_A }],
      })}\n`,
      { mode: 0o644 },
    );
    registerBenchmarkCandidate(repoRoot, "5.0.1-rc.1", FINGERPRINT_A);
    assert.equal(statSync(privateDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(registryPath).mode & 0o777, 0o600);
  });
});

test("two processes preserve one binding for concurrent identical and different runtimes", async () => {
  await withAsyncRepository(async (repoRoot) => {
    const sameRuntime = await registerConcurrently(repoRoot, [
      { candidateVersion: "5.0.1-rc.1", runtimeSha256: FINGERPRINT_A },
      { candidateVersion: "5.0.1-rc.1", runtimeSha256: FINGERPRINT_A },
    ]);
    assert.ok(sameRuntime.some(({ status }) => status === 0));
    assert.ok(sameRuntime.every(({ status, stderr }) => status === 0 || (status === 2 && /locked/u.test(stderr))));
    const registryPath = join(repoRoot, ".pdev", "benchmark-candidate-registry.json");
    assert.equal(JSON.parse(readFileSync(registryPath, "utf8")).candidates.length, 1);
  });
  await withAsyncRepository(async (repoRoot) => {
    const differentRuntimes = await registerConcurrently(repoRoot, [
      { candidateVersion: "5.0.1-rc.1", runtimeSha256: FINGERPRINT_A },
      { candidateVersion: "5.0.1-rc.1", runtimeSha256: FINGERPRINT_B },
    ]);
    assert.ok(differentRuntimes.some(({ status }) => status === 0));
    assert.ok(differentRuntimes.some(({ status }) => status === 2));
    const registryPath = join(repoRoot, ".pdev", "benchmark-candidate-registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    assert.equal(registry.candidates.length, 1);
    const nextRuntime = registry.candidates[0].runtimeSha256 === FINGERPRINT_A ? FINGERPRINT_B : FINGERPRINT_A;
    registerBenchmarkCandidate(repoRoot, "5.0.1-rc.2", nextRuntime);
    assert.equal(JSON.parse(readFileSync(registryPath, "utf8")).candidates.length, 2);
  });
});

test("an interrupted temporary publication cannot replace authoritative registry state", () => {
  withRepository((repoRoot) => {
    const privateDirectory = join(repoRoot, ".pdev");
    mkdirSync(privateDirectory, { mode: 0o700 });
    writeFileSync(join(privateDirectory, ".benchmark-candidate-registry.json.123.interrupted.tmp"), '{"schemaVersion":1', {
      mode: 0o600,
    });
    registerBenchmarkCandidate(repoRoot, "5.0.1-rc.1", FINGERPRINT_A);
    const registry = JSON.parse(readFileSync(join(privateDirectory, "benchmark-candidate-registry.json"), "utf8"));
    assert.deepEqual(registry.candidates, [{ candidateVersion: "5.0.1-rc.1", runtimeSha256: FINGERPRINT_A }]);
  });
});
