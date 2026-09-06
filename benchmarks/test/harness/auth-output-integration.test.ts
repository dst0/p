import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";

function retainedText(root: string, current = root): string {
  return readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(current, entry.name);
      if (entry.isDirectory()) return retainedText(root, path);
      if (!entry.isFile()) return [];
      const bytes = readFileSync(path);
      return [path.endsWith(".br") ? brotliDecompressSync(bytes).toString("utf8") : bytes.toString("utf8")];
    })
    .join("\n");
}

test("synthetic benchmark agent cannot persist source, cell, initial, or refreshed auth data", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-runner-"));
  const fakePackage = join(root, "fake-p");
  const fakeCli = join(fakePackage, "dist", "cli.js");
  const auth = join(root, "authoritative-auth.json");
  const output = join(root, "output");
  const initialToken = "synthetic-initial-auth-secret";
  const refreshedToken = "synthetic-refreshed-auth-secret";
  const initial = `${JSON.stringify({ provider: { type: "oauth", access: initialToken } })}\n`;
  const refreshed = `${JSON.stringify({ provider: { type: "oauth", access: refreshedToken } })}\n`;
  mkdirSync(join(fakePackage, "dist"), { recursive: true });
  writeFileSync(join(fakePackage, "package.json"), `${JSON.stringify({ type: "module", version: "0.0.0" })}\n`);
  writeFileSync(auth, initial, { mode: 0o600 });
  writeFileSync(
    fakeCli,
    `import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const authPath = join(process.env.P_CODING_AGENT_DIR, "auth.json");
const initial = readFileSync(authPath, "utf8");
const refreshed = ${JSON.stringify(refreshed)};
writeFileSync(authPath, refreshed);
const leak = [process.env.P_BENCHMARK_AUTH_FILE ?? "authoritative-env-absent", authPath, initial, refreshed].join("\\n");
writeFileSync(join(process.cwd(), "auth-leak.txt"), leak);
writeFileSync(join(process.cwd(), "finish_notes.md"), "done\\n");
process.stderr.write(leak);
process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: leak }], usage: { input: 1, output: 1, totalTokens: 2 }, stopReason: "stop" } }) + "\\n");
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "benchmarks", "src", "run-agents.ts"),
      "--model",
      "fake/model",
      "--agents",
      "p",
      "--p-cli",
      fakeCli,
      "--task",
      "typescript-calculator",
      "--runs",
      "1",
      "--timeout-seconds",
      "5",
      "--max-runtime-seconds",
      "10",
      "--output",
      output,
    ],
    { cwd: process.cwd(), env: { ...process.env, P_BENCHMARK_AUTH_FILE: auth }, encoding: "utf8" },
  );
  try {
    assert.equal(result.status, 0, result.stderr);
    const retained = retainedText(output);
    assert.match(retained, /authoritative-env-absent/u);
    assert.doesNotMatch(retained, /p-agent-benchmark-config-/u);
    for (const value of [auth, initial, refreshed, initialToken, refreshedToken]) {
      assert.equal(retained.includes(value), false);
      assert.equal(retained.includes(createHash("sha256").update(value).digest("hex")), false);
    }
    assert.match(retained, /REDACTED_AUTH/u);
    const document = JSON.parse(readFileSync(join(output, "results.json"), "utf8"));
    const stderrRelativePath = document.results[0].stderr;
    assert.equal(stderrRelativePath, "stderr/p-run-1-typescript-calculator.log.br");
    const stderrPath = join(output, stderrRelativePath);
    assert.equal(statSync(stderrPath).mode & 0o777, 0o600);
    assert.match(brotliDecompressSync(readFileSync(stderrPath)).toString("utf8"), /REDACTED_AUTH/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
