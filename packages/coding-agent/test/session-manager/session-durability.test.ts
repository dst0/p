import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJsonLineDurably,
  SessionFilePublicationError,
  writeJsonLinesAtomically,
} from "../../src/core/session-manager/session-file-durability.ts";
import type { CustomEntry } from "../../src/core/session-manager/types.ts";
import { loadEntriesFromFileResult, SessionManager } from "../../src/core/session-manager.ts";

const HEADER = '{"type":"session","id":"sess-1","version":3,"timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}';
const USER =
  '{"type":"message","id":"msg-1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hello","timestamp":1}}';

describe("session durability and recovery", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `session-durability-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("drops a truncated final record while preserving the committed prefix", () => {
    const file = join(tempDir, "torn-tail.jsonl");
    writeFileSync(file, `${HEADER}\n${USER}\n{"type":"message","id":"msg-2","parentId":"msg-1"`);

    const result = loadEntriesFromFileResult(file);
    expect(result.tornTail).toBe(true);
    expect(result.entries).toHaveLength(2);
  });

  it("treats a complete JSON record without its final delimiter as uncommitted", () => {
    const file = join(tempDir, "missing-delimiter.jsonl");
    writeFileSync(file, `${HEADER}\n${USER}`);

    const result = loadEntriesFromFileResult(file);
    expect(result.tornTail).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it("repairs a torn tail before appending new entries", () => {
    const file = join(tempDir, "repair.jsonl");
    writeFileSync(file, `${HEADER}\n${USER}\n{"type":"message","id":"msg-2"`);

    const session = SessionManager.open(file, tempDir);
    expect(readFileSync(file, "utf8")).toBe(`${HEADER}\n${USER}\n`);

    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "world" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    });

    expect(loadEntriesFromFileResult(file)).toMatchObject({ tornTail: false });
    expect(loadEntriesFromFileResult(file).entries).toHaveLength(3);
  });

  it("backs up a non-empty unparseable file before replacing it", () => {
    const file = join(tempDir, "corrupted.jsonl");
    writeFileSync(file, "invalid garbage\nsecond invalid line\n");

    SessionManager.open(file, tempDir);

    const backup = readdirSync(tempDir).find((name) => name.startsWith("corrupted.jsonl.corrupted."));
    expect(backup).toBeDefined();
    expect(readFileSync(join(tempDir, backup!), "utf8")).toBe("invalid garbage\nsecond invalid line\n");
  });

  it("backs up malformed interior data before repairing the valid prefix", () => {
    const file = join(tempDir, "malformed-interior.jsonl");
    const original = `${HEADER}\nnot-json\n${USER}\n`;
    writeFileSync(file, original);

    SessionManager.open(file, tempDir);

    const backup = readdirSync(tempDir).find((name) => name.startsWith("malformed-interior.jsonl.corrupted."));
    expect(backup).toBeDefined();
    expect(readFileSync(join(tempDir, backup!), "utf8")).toBe(original);
    expect(readFileSync(file, "utf8")).toBe(`${HEADER}\n`);
  });

  it("truncates at the first malformed record instead of retaining a dangling child", () => {
    const file = join(tempDir, "dangling-child.jsonl");
    const child = JSON.stringify({
      type: "message",
      id: "child",
      parentId: "missing-parent",
      timestamp: "2025-01-01T00:00:02Z",
      message: { role: "user", content: "child", timestamp: 2 },
    });
    writeFileSync(file, `${HEADER}\n{"type":"message","id":"missing-parent"\n${child}\n`);

    const result = loadEntriesFromFileResult(file);
    expect(result.malformedLineCount).toBe(1);
    expect(result.entries).toHaveLength(1);

    SessionManager.open(file, tempDir);
    expect(readFileSync(file, "utf8")).toBe(`${HEADER}\n`);
  });

  it("leaves the previous file intact when an atomic rewrite cannot serialize", () => {
    const file = join(tempDir, "atomic-rewrite.jsonl");
    writeFileSync(file, `${HEADER}\n`);
    const session = SessionManager.open(file, tempDir);
    const invalid: CustomEntry = {
      type: "custom",
      id: "invalid-bigint",
      parentId: null,
      timestamp: "2025-01-01T00:00:02Z",
      customType: "serialization-failure",
      data: 1n,
    };
    session.fileEntries.push(invalid);

    expect(() => session._rewriteFile()).toThrow();
    expect(readFileSync(file, "utf8")).toBe(`${HEADER}\n`);
    expect(readdirSync(tempDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("forks through an atomic temporary file without leaving residue", () => {
    const source = join(tempDir, "source.jsonl");
    writeFileSync(source, `${HEADER}\n${USER}\n`);

    const forked = SessionManager.forkFrom(source, "/tmp", tempDir);
    expect(forked.getEntries()).toHaveLength(1);
    expect(readdirSync(tempDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("flushes file data before rename and flushes the directory after publication", () => {
    const file = join(tempDir, "ordered-rewrite.jsonl");
    writeFileSync(file, `${HEADER}\n`);
    const events: string[] = [];

    writeJsonLinesAtomically(
      file,
      [JSON.parse(HEADER), JSON.parse(USER)],
      {},
      {
        fsyncSync: (fd: number) => {
          events.push("fsync");
          fsyncSync(fd);
        },
        renameSync: (source: string, target: string) => {
          events.push("rename");
          renameSync(source, target);
        },
      },
    );

    expect(events).toEqual(process.platform === "win32" ? ["fsync", "rename"] : ["fsync", "rename", "fsync"]);
  });

  it("flushes file data before exclusive link publication and the directory after unlink", () => {
    const file = join(tempDir, "ordered-create.jsonl");
    const events: string[] = [];

    writeJsonLinesAtomically(
      file,
      [JSON.parse(HEADER)],
      { exclusive: true },
      {
        fsyncSync: (fd: number) => {
          events.push("fsync");
          fsyncSync(fd);
        },
        linkSync: (source: string, target: string) => {
          events.push("link");
          linkSync(source, target);
        },
        unlinkSync: (path: string) => {
          events.push("unlink");
          unlinkSync(path);
        },
      },
    );

    expect(events).toEqual(
      process.platform === "win32" ? ["fsync", "link", "unlink"] : ["fsync", "link", "unlink", "fsync"],
    );
  });

  it("preserves the previous file when data fsync or rename fails", () => {
    const file = join(tempDir, "failed-rewrite.jsonl");
    writeFileSync(file, `${HEADER}\n`);

    expect(() =>
      writeJsonLinesAtomically(file, [JSON.parse(HEADER), JSON.parse(USER)], {}, { fsyncSync: () => fail("fsync") }),
    ).toThrow("fsync");
    expect(readFileSync(file, "utf8")).toBe(`${HEADER}\n`);

    expect(() =>
      writeJsonLinesAtomically(file, [JSON.parse(HEADER), JSON.parse(USER)], {}, { renameSync: () => fail("rename") }),
    ).toThrow("rename");
    expect(readFileSync(file, "utf8")).toBe(`${HEADER}\n`);
    expect(readdirSync(tempDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("does not publish an exclusive target when link creation fails", () => {
    const file = join(tempDir, "failed-create.jsonl");

    expect(() =>
      writeJsonLinesAtomically(file, [JSON.parse(HEADER)], { exclusive: true }, { linkSync: () => fail("link") }),
    ).toThrow("link");
    expect(() => readFileSync(file, "utf8")).toThrow();
    expect(readdirSync(tempDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("retries an exclusive publish after directory fsync uncertainty without overwriting another writer", () => {
    const file = join(tempDir, "uncertain-create.jsonl");
    let fsyncCall = 0;

    expect(() =>
      writeJsonLinesAtomically(
        file,
        [JSON.parse(HEADER)],
        { exclusive: true },
        {
          fsyncSync: (fd: number) => {
            fsyncCall++;
            if (fsyncCall === 2) fail("directory fsync");
            fsyncSync(fd);
          },
        },
      ),
    ).toThrow(SessionFilePublicationError);
    expect(readFileSync(file, "utf8")).toBe(`${HEADER}\n`);

    writeJsonLinesAtomically(file, [JSON.parse(HEADER)], { exclusive: true });
    expect(readFileSync(file, "utf8")).toBe(`${HEADER}\n`);
    expect(() => writeJsonLinesAtomically(file, [JSON.parse(HEADER), JSON.parse(USER)], { exclusive: true })).toThrow();
    expect(readFileSync(file, "utf8")).toBe(`${HEADER}\n`);
  });

  it("flushes durable appends and closes the descriptor after an injected fsync failure", () => {
    const file = join(tempDir, "append.jsonl");
    writeFileSync(file, `${HEADER}\n`);
    const events: string[] = [];

    appendJsonLineDurably(file, JSON.parse(USER), {
      writeFileSync: (fd: number, data: string) => {
        events.push("write");
        writeFileSync(fd, data);
      },
      fsyncSync: (fd: number) => {
        events.push("fsync");
        fsyncSync(fd);
      },
    });
    expect(events).toEqual(["write", "fsync"]);

    let closedAfterFailure = false;
    expect(() =>
      appendJsonLineDurably(file, JSON.parse(USER), {
        fsyncSync: () => fail("append fsync"),
        closeSync: (fd: number) => {
          closedAfterFailure = true;
          closeSync(fd);
        },
      }),
    ).toThrow("append fsync");
    expect(closedAfterFailure).toBe(true);
    rmSync(file);
  });
});

function fail(message: string): never {
  throw new Error(message);
}
