import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("npm run dev runs the source CLI from outside the repository", () => {
  const callerCwd = mkdtempSync(path.join(tmpdir(), "p-test-wrapper-"));
  try {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const output = execFileSync("npm", ["--prefix", repoRoot, "run", "--silent", "dev", "--", "--version"], {
      cwd: callerCwd,
      encoding: "utf8",
    });
    assert.equal(output.trim(), packageJson.version);
  } finally {
    rmSync(callerCwd, { recursive: true, force: true });
  }
});

test("benchmarks typecheck succeeds when built dist is absent", () => {
  const tsgoBin = path.join(repoRoot, "node_modules", ".bin", "tsgo");
  const benchmarkTsconfig = path.join(repoRoot, "benchmarks", "tsconfig.json");
  const output = execFileSync(tsgoBin, ["--noEmit", "-p", benchmarkTsconfig], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(output.trim(), "");
});

test("script test suite includes source CLI regressions", () => {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.match(packageJson.scripts["test:scripts"], /(?:^|&&\s*)npm run test:cli(?:\s*&&|$)/u);
});
