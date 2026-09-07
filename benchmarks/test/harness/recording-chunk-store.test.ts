import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { BenchmarkOutputOverflowError } from "../../src/harness/output-overflow-error.ts";
import {
  benchmarkRecordingPaths,
  createBenchmarkRecordingChunkStore,
  replayBenchmarkRecordingChunks,
} from "../../src/harness/recording-chunk-store.ts";
import type { BenchmarkRecordingChunkStore } from "../../src/harness/recording-chunk-store-contract.ts";

async function replay(store: BenchmarkRecordingChunkStore): Promise<Buffer> {
  const blocks: Buffer[] = [];
  for await (const block of replayBenchmarkRecordingChunks(store.chunkDirectory, store.activePath)) blocks.push(block);
  return Buffer.concat(blocks);
}

function write(store: BenchmarkRecordingChunkStore, value: Uint8Array | string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    store.stream.write(value, (error) => (error ? reject(error) : resolve()));
  });
}

function directoryBytes(path: string): number {
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const child = join(path, entry.name);
    return total + (entry.isDirectory() ? directoryBytes(child) : statSync(child).size);
  }, 0);
}

async function peakDirectoryBytes(path: string, action: () => Promise<unknown>): Promise<number> {
  let peak = 0;
  const sample = () => {
    peak = Math.max(peak, directoryBytes(path));
  };
  const timer = setInterval(sample, 1);
  try {
    await action();
  } finally {
    clearInterval(timer);
    sample();
  }
  return peak;
}

test("rotates private verified chunks, replays exact arbitrary bytes, and recomposes one archive", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunk-store-"));
  const finalPath = join(root, "recording.jsonl.br");
  const store = createBenchmarkRecordingChunkStore(finalPath, { maxActiveChunkBytes: 11, maxStoredBytes: 4_096 });
  try {
    const expected = Buffer.concat([
      Buffer.from('{"event":1}\n'),
      Buffer.from([0x66, 0x80, 0x0a]),
      Buffer.from('{"event":2,"value":"abcdefghijklmnopqrstuvwxyz"}\n'),
    ]);
    await Promise.all([write(store, expected.subarray(0, 9)), write(store, expected.subarray(9))]);

    assert.equal(statSync(store.chunkDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(store.activePath).mode & 0o777, 0o600);
    const chunks = readdirSync(store.chunkDirectory).filter((name) => name.endsWith(".br"));
    assert.ok(chunks.length >= 4);
    for (const name of chunks) assert.equal(statSync(join(store.chunkDirectory, name)).mode & 0o777, 0o600);
    assert.deepEqual(await replay(store), expected);
    assert.equal(store.accounting().bytes, expected.length);
    assert.equal(store.accounting().chunkCount, chunks.length);
    assert.equal(store.accounting().sha256, createHash("sha256").update(expected).digest("hex"));
    assert.equal(store.accounting().storageLimitBytes, 4_096);
    assert.ok(store.accounting().storedBytes <= store.accounting().storageLimitBytes);

    await store.finalize();
    assert.deepEqual(brotliDecompressSync(readFileSync(finalPath)), expected);
    assert.equal(statSync(finalPath).mode & 0o777, 0o600);
    assert.equal(existsSync(store.compressedTempPath), false);
    const encodedBytes = statSync(finalPath).size;
    assert.deepEqual(JSON.parse(readFileSync(store.manifestPath, "utf8")), {
      bytes: expected.length,
      schemaVersion: 1,
      sha256: createHash("sha256").update(expected).digest("hex"),
    });
    assert.equal(statSync(store.manifestPath).mode & 0o777, 0o600);
    assert.equal(store.accounting().archiveBytes, encodedBytes + statSync(store.manifestPath).size);
    assert.ok(store.accounting().archiveBytes <= store.accounting().archiveLimitBytes);
    assert.equal(existsSync(store.chunkDirectory), false);
  } finally {
    await store.cleanup();
    rmSync(root, { force: true, recursive: true });
  }
});

test("derives parent-readable lifecycle paths without creating scratch state", () => {
  const paths = benchmarkRecordingPaths("/private/run.jsonl.br");
  assert.deepEqual(paths, {
    activePath: "/private/run.jsonl.chunks/active.jsonl.active",
    chunkDirectory: "/private/run.jsonl.chunks",
    compressedTempPath: "/private/run.jsonl.br.tmp",
    manifestPath: "/private/run.jsonl.manifest.json",
  });
});

test("stores highly compressible decoded output above the physical scratch limit", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunk-store-compressible-"));
  const store = createBenchmarkRecordingChunkStore(join(root, "recording.jsonl.br"), {
    maxActiveChunkBytes: 1_024,
    maxBytes: 16_384,
    maxStoredBytes: 2_048,
  });
  const expected = Buffer.alloc(8_192, 0);
  try {
    await write(store, expected);
    assert.equal(store.partial, false);
    assert.ok(store.accounting().storedBytes < 2_048);
    assert.deepEqual(await replay(store), expected);
    await store.finalize();
  } finally {
    await store.cleanup();
    rmSync(root, { force: true, recursive: true });
  }
});

test("bounds physical scratch at one exact prefix and notifies only once", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunk-store-overflow-"));
  const finalPath = join(root, "recording.jsonl.br");
  const store = createBenchmarkRecordingChunkStore(finalPath, {
    maxActiveChunkBytes: 64,
    maxStoredBytes: 256,
  });
  const failures: Error[] = [];
  const removeFailureHandler = store.onFailure((error) => failures.push(error));
  try {
    const input = Buffer.from(Array.from({ length: 1_024 }, (_, index) => (index * 97 + 31) % 251));
    await write(store, input);
    await write(store, Buffer.from("discarded"));
    assert.equal(failures.length, 1);
    const failure = failures[0];
    assert.ok(failure instanceof BenchmarkOutputOverflowError);
    assert.equal(failure.captureName, "recording storage");
    assert.equal(failure.limitBytes, 256);
    assert.equal(store.partial, true);
    assert.ok(store.accounting().bytes < 256);
    const prefix = input.subarray(0, store.accounting().bytes);
    assert.deepEqual(await replay(store), prefix);
    await store.finalize();
    assert.deepEqual(brotliDecompressSync(readFileSync(finalPath)), prefix);
  } finally {
    removeFailureHandler();
    await store.cleanup();
    assert.equal(existsSync(store.chunkDirectory), false);
    rmSync(root, { force: true, recursive: true });
  }
});

test("bounds on-disk scratch during raw-to-Brotli rotation", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunk-store-peak-"));
  const maxStoredBytes = 1_048_576;
  const store = createBenchmarkRecordingChunkStore(join(root, "recording.jsonl.br"), {
    maxActiveChunkBytes: 262_144,
    maxBytes: maxStoredBytes * 2,
    maxStoredBytes,
  });
  try {
    const peak = await peakDirectoryBytes(root, () => write(store, randomBytes(maxStoredBytes + 262_144)));
    assert.ok(peak <= maxStoredBytes, `peak ${peak} exceeded ${maxStoredBytes}`);
  } finally {
    await store.cleanup();
    rmSync(root, { force: true, recursive: true });
  }
});

test("measures final recomposition peak against the physical storage cap", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunk-store-final-peak-"));
  const maxStoredBytes = 786_432;
  const maxArchiveBytes = 614_400;
  const store = createBenchmarkRecordingChunkStore(join(root, "recording.jsonl.br"), {
    maxActiveChunkBytes: 131_072,
    maxArchiveBytes,
    maxBytes: maxStoredBytes,
    maxStoredBytes,
  });
  try {
    await write(store, randomBytes(524_288));
    const peak = await peakDirectoryBytes(root, () => store.finalize());
    assert.ok(peak <= maxStoredBytes + maxArchiveBytes, `peak ${peak} exceeded two-budget cap`);
  } finally {
    await store.cleanup();
    rmSync(root, { force: true, recursive: true });
  }
});

test("fails closed before final publication when the archive budget is exceeded", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunk-store-archive-cap-"));
  const finalPath = join(root, "recording.jsonl.br");
  const store = createBenchmarkRecordingChunkStore(finalPath, {
    maxActiveChunkBytes: 65_536,
    maxArchiveBytes: 131_072,
    maxStoredBytes: 524_288,
  });
  const failures: Error[] = [];
  store.onFailure((error) => failures.push(error));
  try {
    await write(store, randomBytes(262_144));
    await assert.rejects(store.finalize(), (error) => {
      assert.ok(error instanceof BenchmarkOutputOverflowError);
      assert.equal(error.captureName, "recording archive");
      assert.equal(error.limitBytes, 131_072);
      return true;
    });
    assert.equal(failures.length, 1);
    assert.equal(existsSync(finalPath), false);
  } finally {
    await store.cleanup();
    rmSync(root, { force: true, recursive: true });
  }
});

test("replacement reserves existing final evidence inside the hard archive peak", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunk-store-replacement-cap-"));
  const finalPath = join(root, "recording.jsonl.br");
  const paths = benchmarkRecordingPaths(finalPath);
  writeFileSync(finalPath, Buffer.alloc(500), { mode: 0o600 });
  writeFileSync(paths.manifestPath, Buffer.alloc(10), { mode: 0o600 });
  const store = createBenchmarkRecordingChunkStore(finalPath, {
    maxActiveChunkBytes: 64,
    maxArchiveBytes: 512,
    maxStoredBytes: 384,
  });
  try {
    await write(store, randomBytes(256));
    const peak = await peakDirectoryBytes(root, () =>
      assert.rejects(
        store.finalize(),
        (error) => error instanceof BenchmarkOutputOverflowError && error.captureName === "recording archive",
      ),
    );
    assert.ok(peak <= 896, `replacement peak ${peak} exceeded the two-budget cap`);
    assert.equal(statSync(finalPath).size, 500);
    assert.equal(statSync(paths.manifestPath).size, 10);
  } finally {
    await store.cleanup();
    rmSync(root, { force: true, recursive: true });
  }
});

test("preserves a final publication temp collision and the old final", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunk-store-collision-"));
  const finalPath = join(root, "recording.jsonl.br");
  const store = createBenchmarkRecordingChunkStore(finalPath);
  try {
    writeFileSync(finalPath, "old-final", { mode: 0o600 });
    writeFileSync(store.compressedTempPath, "collision", { mode: 0o600 });
    await write(store, Buffer.from("new"));
    await assert.rejects(store.finalize(), /EEXIST|exist/i);
    assert.equal(readFileSync(finalPath, "utf8"), "old-final");
    assert.equal(readFileSync(store.compressedTempPath, "utf8"), "collision");
  } finally {
    await store.cleanup();
    rmSync(root, { force: true, recursive: true });
  }
});

test("refuses a concurrent recorder without touching the locked recorder temp", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunk-store-lock-"));
  const finalPath = join(root, "recording.jsonl.br");
  const first = createBenchmarkRecordingChunkStore(finalPath);
  try {
    writeFileSync(first.compressedTempPath, "active finalizer temp", { mode: 0o600 });
    assert.throws(() => createBenchmarkRecordingChunkStore(finalPath), /EEXIST|exist/i);
    assert.equal(readFileSync(first.compressedTempPath, "utf8"), "active finalizer temp");
  } finally {
    await first.cleanup();
    rmSync(root, { force: true, recursive: true });
  }
});

test("propagates a Writable error once without an unhandled error event", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunk-store-writable-error-"));
  const store = createBenchmarkRecordingChunkStore(join(root, "recording.jsonl.br"));
  const failures: Error[] = [];
  store.onFailure((error) => failures.push(error));
  try {
    const closed = new Promise((resolve) => store.stream.once("close", resolve));
    store.stream.destroy(new Error("injected writable failure"));
    await closed;
    assert.equal(failures.length, 1);
    assert.match(failures[0].message, /injected writable failure/);
  } finally {
    await store.cleanup();
    rmSync(root, { force: true, recursive: true });
  }
});
