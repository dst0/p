import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { createBenchmarkAuthOutputGuard } from "./benchmark-auth-output-guard.js";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("redacts auth paths, bytes, hashes, and initial or refreshed string leaves from every retained artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-output-"));
  const source = join(root, "private-source", "auth.json");
  const snapshot = join(root, "private-snapshot", "auth.json");
  const cell = join(root, "private-cell", "auth.json");
  const initialToken = "initial-secret-token-value";
  const refreshedToken = "refreshed-secret-token-value";
  const initial = `${JSON.stringify({ provider: { token: initialToken } })}\n`;
  const refreshed = `${JSON.stringify({ provider: { token: refreshedToken } })}\n`;
  for (const path of [source, snapshot, cell]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, initial);
  }
  const guard = createBenchmarkAuthOutputGuard([source, snapshot, cell]);
  writeFileSync(cell, refreshed);
  guard.capture(cell);
  const scratch = join(root, "scratch-output");
  const output = join(root, "retained-output");
  mkdirSync(join(scratch, "stderr"), { recursive: true });
  mkdirSync(join(scratch, "recordings"), { recursive: true });
  mkdirSync(join(scratch, "workspaces"), { recursive: true });
  writeFileSync(join(scratch, "stderr", "agent.log"), `${source}\n${initialToken}\n${hash(initial)}\n`);
  writeFileSync(
    join(scratch, "recordings", "agent.jsonl.br"),
    brotliCompressSync(Buffer.from(`${snapshot}\n${refreshedToken}\n${hash(refreshed)}\n`)),
  );
  writeFileSync(join(scratch, "workspaces", "proof.txt"), `${cell}\n${initial}\n${refreshed}\n`);
  writeFileSync(join(scratch, "results.json"), `${JSON.stringify({ finalText: refreshedToken })}\n`);

  guard.retainTree(scratch, output);

  assert.equal(existsSync(scratch), false);
  const retained = [
    readFileSync(join(output, "stderr", "agent.log"), "utf8"),
    brotliDecompressSync(readFileSync(join(output, "recordings", "agent.jsonl.br"))).toString("utf8"),
    readFileSync(join(output, "workspaces", "proof.txt"), "utf8"),
    readFileSync(join(output, "results.json"), "utf8"),
  ].join("\n");
  for (const secret of [source, snapshot, cell, initialToken, refreshedToken, initial, refreshed, hash(initial), hash(refreshed)]) {
    assert.equal(retained.includes(secret), false);
  }
  assert.match(retained, /REDACTED_AUTH/u);
  rmSync(root, { recursive: true, force: true });
});

test("removes an unsafe artifact and fails closed when it cannot be safely redacted", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-binary-output-"));
  const auth = join(root, "auth.json");
  const token = "binary-secret-token-value";
  writeFileSync(auth, `${JSON.stringify({ token })}\n`);
  const output = join(root, "output");
  mkdirSync(output);
  const artifact = join(output, "artifact.bin");
  writeFileSync(artifact, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(token)]));
  const guard = createBenchmarkAuthOutputGuard([auth]);
  assert.throws(() => guard.sanitizeTree(output), /Private benchmark artifact/u);
  assert.equal(existsSync(artifact), false);
  rmSync(root, { recursive: true, force: true });
});

test("removes the retained tree when refreshed auth cannot be captured", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-capture-failure-"));
  const auth = join(root, "auth.json");
  const output = join(root, "output");
  writeFileSync(auth, '{"token":"initial-secret"}\n');
  const guard = createBenchmarkAuthOutputGuard([auth]);
  rmSync(auth);
  mkdirSync(auth);
  mkdirSync(output);
  writeFileSync(join(output, "artifact.log"), "initial-secret\n");
  assert.throws(() => guard.capture(auth), /regular file/u);
  assert.throws(() => guard.sanitizeTree(output), /could not be captured/u);
  assert.equal(existsSync(output), false);
  rmSync(root, { recursive: true, force: true });
});

test("an absent auth file created as an empty object does not corrupt JSON artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-empty-auth-output-"));
  const auth = join(root, "auth.json");
  const output = join(root, "output");
  const artifact = join(output, "results.json");
  writeFileSync(auth, "{}\n");
  mkdirSync(output);
  writeFileSync(artifact, '{"result":{},"passed":true}\n');
  const guard = createBenchmarkAuthOutputGuard([auth]);
  guard.sanitizeTree(output);
  assert.equal(readFileSync(artifact, "utf8"), '{"result":{},"passed":true}\n');
  rmSync(root, { recursive: true, force: true });
});

test("removes a leaking hard link without mutating its authoritative auth inode", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-hard-link-"));
  const auth = join(root, "auth.json");
  const output = join(root, "output");
  const artifact = join(output, "auth-leak.json");
  const contents = '{"token":"hard-linked-secret"}\n';
  writeFileSync(auth, contents);
  mkdirSync(output);
  linkSync(auth, artifact);
  const guard = createBenchmarkAuthOutputGuard([auth]);
  assert.throws(() => guard.sanitizeTree(output), /Private benchmark artifact/u);
  assert.equal(readFileSync(auth, "utf8"), contents);
  assert.equal(existsSync(artifact), false);
  rmSync(root, { recursive: true, force: true });
});

test("rejects exact invalid-UTF8 auth bytes in a binary artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-raw-bytes-"));
  const auth = join(root, "auth.json");
  const output = join(root, "output");
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("raw-auth-secret")]);
  writeFileSync(auth, bytes);
  mkdirSync(output);
  writeFileSync(join(output, "raw-auth.bin"), bytes);
  const guard = createBenchmarkAuthOutputGuard([auth]);
  assert.throws(() => guard.sanitizeTree(output), /Private benchmark artifact/u);
  assert.equal(existsSync(output), false);
  rmSync(root, { recursive: true, force: true });
});

test("removes source and partial destination when retaining a cell copy fails", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-copy-failure-"));
  const auth = join(root, "auth.json");
  const source = join(root, "scratch");
  const destination = join(root, "retained");
  writeFileSync(auth, '{"token":"copy-secret"}\n');
  mkdirSync(source);
  writeFileSync(join(source, "artifact.log"), "safe\n");
  const guard = createBenchmarkAuthOutputGuard([auth], {
    copyTree: (_source, target) => {
      mkdirSync(target);
      writeFileSync(join(target, "partial.log"), "partial\n");
      throw new Error("copy failed");
    },
  });
  assert.throws(() => guard.retainTree(source, destination), /copy failed/u);
  assert.equal(existsSync(source), false);
  assert.equal(existsSync(destination), false);
  rmSync(root, { recursive: true, force: true });
});

test("prunes installed dependencies before retained-artifact symlink validation", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-dependencies-"));
  const auth = join(root, "auth.json");
  const source = join(root, "scratch");
  const destination = join(root, "retained");
  const dependencies = join(source, "workspaces", "p", "run-1", "fixture", "node_modules");
  writeFileSync(auth, '{"token":"dependency-secret"}\n');
  mkdirSync(join(dependencies, ".bin"), { recursive: true });
  mkdirSync(join(dependencies, "tool"));
  writeFileSync(join(dependencies, "tool", "cli.js"), "safe dependency\n");
  symlinkSync(join("..", "tool", "cli.js"), join(dependencies, ".bin", "tool"));
  writeFileSync(join(source, "results.json"), '{"passed":true}\n');

  const guard = createBenchmarkAuthOutputGuard([auth]);
  guard.retainTree(source, destination);

  assert.equal(existsSync(source), false);
  assert.equal(existsSync(join(destination, "workspaces", "p", "run-1", "fixture", "node_modules")), false);
  assert.equal(readFileSync(join(destination, "results.json"), "utf8"), '{"passed":true}\n');
  rmSync(root, { recursive: true, force: true });
});

test("fails closed when a credential leaf collides with the redaction marker", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-marker-collision-"));
  const auth = join(root, "auth.json");
  writeFileSync(auth, '{"token":"<REDACTED_AUTH>"}\n');
  assert.throws(() => createBenchmarkAuthOutputGuard([auth]), /redaction marker/u);
  rmSync(root, { recursive: true, force: true });
});

test("redacts JSON-escaped multiline credential leaves from plain and Brotli artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-json-escaped-"));
  const auth = join(root, "auth.json");
  const output = join(root, "output");
  const secret = 'line1\nline2"quoted"\\private';
  writeFileSync(auth, `${JSON.stringify({ token: secret })}\n`);
  mkdirSync(output);
  const serialized = `${JSON.stringify({ emitted: secret })}\n`;
  writeFileSync(join(output, "result.json"), serialized);
  writeFileSync(join(output, "recording.jsonl.br"), brotliCompressSync(Buffer.from(serialized)));
  const guard = createBenchmarkAuthOutputGuard([auth]);
  guard.sanitizeTree(output);
  const retained = [
    readFileSync(join(output, "result.json"), "utf8"),
    brotliDecompressSync(readFileSync(join(output, "recording.jsonl.br"))).toString("utf8"),
  ].join("\n");
  assert.equal(retained.includes(JSON.stringify(secret).slice(1, -1)), false);
  assert.match(retained, /REDACTED_AUTH/u);
  rmSync(root, { recursive: true, force: true });
});

test("rejects a symlinked scan root without touching its external sentinel", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-root-symlink-"));
  const auth = join(root, "auth.json");
  const external = join(root, "external");
  const output = join(root, "output");
  const sentinel = join(external, "sentinel.txt");
  writeFileSync(auth, '{"token":"root-secret"}\n');
  mkdirSync(external);
  writeFileSync(sentinel, "untouched\n");
  symlinkSync(external, output, "dir");
  const guard = createBenchmarkAuthOutputGuard([auth]);
  assert.throws(() => guard.sanitizeTree(output), /real directory/u);
  assert.equal(existsSync(output), false);
  assert.equal(readFileSync(sentinel, "utf8"), "untouched\n");
  rmSync(root, { recursive: true, force: true });
});

test("rejects a symlinked retained destination without touching its external sentinel", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-destination-symlink-"));
  const auth = join(root, "auth.json");
  const source = join(root, "scratch");
  const external = join(root, "external");
  const destination = join(root, "retained");
  writeFileSync(auth, '{"token":"destination-secret"}\n');
  mkdirSync(source);
  writeFileSync(join(source, "safe.txt"), "safe\n");
  mkdirSync(external);
  writeFileSync(join(external, "sentinel.txt"), "untouched\n");
  symlinkSync(external, destination, "dir");
  const guard = createBenchmarkAuthOutputGuard([auth]);
  assert.throws(() => guard.retainTree(source, destination), /must not already exist/u);
  assert.equal(existsSync(source), false);
  assert.equal(existsSync(destination), false);
  assert.equal(readFileSync(join(external, "sentinel.txt"), "utf8"), "untouched\n");
  rmSync(root, { recursive: true, force: true });
});

test("rejects a nested symlink chain without mutating external auth", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-symlink-chain-"));
  const privateRoot = join(root, "private");
  const auth = join(privateRoot, "auth.json");
  const alias = join(root, "alias");
  const output = join(root, "output");
  const contents = '{"token":"symlink-chain-secret"}\n';
  mkdirSync(privateRoot);
  writeFileSync(auth, contents);
  symlinkSync(auth, alias);
  mkdirSync(output);
  symlinkSync(alias, join(output, "leak"));
  const guard = createBenchmarkAuthOutputGuard([auth]);
  assert.throws(() => guard.sanitizeTree(output), /Private benchmark artifact/u);
  assert.equal(existsSync(output), false);
  assert.equal(readFileSync(auth, "utf8"), contents);
  rmSync(root, { recursive: true, force: true });
});

test("rejects even a currently safe hard link so external content cannot change after scanning", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-safe-hard-link-"));
  const auth = join(root, "auth.json");
  const external = join(root, "external.txt");
  const output = join(root, "output");
  writeFileSync(auth, '{"token":"unrelated-secret"}\n');
  writeFileSync(external, "safe-now\n");
  mkdirSync(output);
  linkSync(external, join(output, "future-leak.txt"));
  const guard = createBenchmarkAuthOutputGuard([auth]);
  assert.throws(() => guard.sanitizeTree(output), /Private benchmark artifact/u);
  assert.equal(existsSync(output), false);
  assert.equal(readFileSync(external, "utf8"), "safe-now\n");
  rmSync(root, { recursive: true, force: true });
});
