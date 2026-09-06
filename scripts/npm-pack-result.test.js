import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readNpmPackResult } from "./npm-pack-result.js";

const expected = { name: "@dst0/p-ai", version: "0.4.224" };
const packed = { ...expected, filename: "dst0-p-ai-0.4.224.tgz", size: 321, files: [] };

test("accepts the exact package from current array and keyed npm output contracts", () => {
  assert.deepEqual(readNpmPackResult(JSON.stringify([packed]), expected), packed);
  assert.deepEqual(readNpmPackResult(JSON.stringify({ [expected.name]: packed }), expected), packed);
});

test("accepts the canonical filename for an unscoped package with a prerelease version", () => {
  const packageIdentity = { name: "release-fixture", version: "1.2.3-rc.1" };
  const result = { ...packageIdentity, filename: "release-fixture-1.2.3-rc.1.tgz" };
  assert.deepEqual(readNpmPackResult(JSON.stringify({ [result.name]: result }), packageIdentity), result);
});

test("rejects malformed JSON without copying potentially sensitive subprocess output into diagnostics", () => {
  assert.throws(() => readNpmPackResult("private-output-not-json", expected), {
    message: "npm pack returned invalid JSON for @dst0/p-ai",
  });
});

test("rejects omission of an explicitly shipped shrinkwrap instead of weakening release artifacts", () => {
  const manifest = { ...expected, files: ["dist", "npm-shrinkwrap.json"] };
  assert.throws(() => readNpmPackResult(JSON.stringify([packed]), manifest), /omitted required npm-shrinkwrap.json/u);
  assert.throws(
    () =>
      readNpmPackResult(
        JSON.stringify({
          [expected.name]: {
            ...packed,
            files: [{ path: "nested/npm-shrinkwrap.json" }, { path: "npm-shrinkwrap.json.backup" }],
          },
        }),
        manifest,
      ),
    /omitted required npm-shrinkwrap.json/u,
  );
  const withShrinkwrap = { ...packed, files: [{ path: "npm-shrinkwrap.json" }] };
  assert.deepEqual(readNpmPackResult(JSON.stringify([withShrinkwrap]), manifest), withShrinkwrap);
});

test("reads the installed npm contract from a real offline dry-run without invoking package hooks", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "p-npm-pack-contract-"));
  const manifest = { name: "p-pack-contract-fixture", version: "1.2.3", scripts: { prepack: "node prepack.js" } };
  writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(fixtureRoot, "README.md"), "Local release contract fixture\n");
  writeFileSync(join(fixtureRoot, "prepack.js"), 'require("node:fs").writeFileSync("hook-executed", "unexpected");\n');
  try {
    const result = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["pack", "--dry-run", "--ignore-scripts", "--offline", "--json"],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
        timeout: 60_000,
        shell: process.platform === "win32",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readNpmPackResult(result.stdout, manifest).filename, "p-pack-contract-fixture-1.2.3.tgz");
    assert.equal(existsSync(join(fixtureRoot, "hook-executed")), false);
    assert.equal(
      readdirSync(fixtureRoot).some((name) => name.endsWith(".tgz")),
      false,
    );
    assert.deepEqual(JSON.parse(readFileSync(join(fixtureRoot, "package.json"), "utf8")), manifest);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

for (const [label, output] of [
  ["empty array", []],
  ["multiple array results", [packed, packed]],
  ["null result", null],
  ["scalar result", "filename.tgz"],
  ["empty object", {}],
  ["wrong map key", { "@dst0/other": packed }],
  ["extra map package", { [expected.name]: packed, "@dst0/other": packed }],
  ["missing entry", [null]],
  ["scalar entry", ["filename.tgz"]],
  ["nested array entry", [[packed]]],
  ["wrong package name", [{ ...packed, name: "@dst0/other" }]],
  ["wrong version", [{ ...packed, version: "0.4.223" }]],
  ["wrong filename version", [{ ...packed, filename: "dst0-p-ai-0.4.223.tgz" }]],
  ["missing filename", [{ ...expected }]],
  ["POSIX traversal", [{ ...packed, filename: "../dst0-p-ai-0.4.224.tgz" }]],
  ["Windows traversal", [{ ...packed, filename: "..\\dst0-p-ai-0.4.224.tgz" }]],
  ["absolute filename", [{ ...packed, filename: "/tmp/dst0-p-ai-0.4.224.tgz" }]],
]) {
  test(`rejects ${label} instead of choosing an unbound archive`, () => {
    assert.throws(() => readNpmPackResult(JSON.stringify(output), expected), /^Error: npm pack /u);
  });
}
