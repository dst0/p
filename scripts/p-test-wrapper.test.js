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
