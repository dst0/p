import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

import { replacePrivateBrotliText } from "../../src/harness/private-brotli.ts";

const q6TextParameters = {
  [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
};

test("atomically replaces a Brotli archive with exact private Q6-text bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "p-private-brotli-"));
  try {
    const path = join(root, "artifact.log.br");
    writeFileSync(path, brotliCompressSync(Buffer.from("old\n")));
    chmodSync(path, 0o644);
    const text = "sanitized 😀\n".repeat(512);
    replacePrivateBrotliText(path, text);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readFileSync(path), brotliCompressSync(Buffer.from(text), { params: q6TextParameters }));
    assert.equal(brotliDecompressSync(readFileSync(path)).toString("utf8"), text);
    assert.deepEqual(readdirSync(root), ["artifact.log.br"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a pre-publication fault preserves the complete prior archive and removes scratch", () => {
  const root = mkdtempSync(join(tmpdir(), "p-private-brotli-before-publish-"));
  try {
    const path = join(root, "artifact.jsonl.br");
    const prior = brotliCompressSync(Buffer.from("complete prior archive\n"));
    writeFileSync(path, prior, { mode: 0o600 });
    assert.throws(
      () => replacePrivateBrotliText(path, "sanitized replacement\n", { faultAt: "before-publish" }),
      /injected before-publish failure/iu,
    );
    assert.deepEqual(readFileSync(path), prior);
    assert.equal(brotliDecompressSync(readFileSync(path)).toString("utf8"), "complete prior archive\n");
    assert.deepEqual(readdirSync(root), ["artifact.jsonl.br"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a publication durability fault cannot report success or leave partial bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "p-private-brotli-durability-"));
  try {
    const path = join(root, "artifact.log.br");
    assert.throws(
      () => replacePrivateBrotliText(path, "durable sanitized bytes\n", { faultAt: "after-publish" }),
      /injected after-publish failure/iu,
    );
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(brotliDecompressSync(readFileSync(path)).toString("utf8"), "durable sanitized bytes\n");
    assert.deepEqual(readdirSync(root), ["artifact.log.br"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
