import { closeSync, fsyncSync, mkdirSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDirectoryDurably } from "../../src/core/session-manager/session-file-durability.ts";

describe("session directory durability", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `session-directory-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("fsyncs each parent after making a first-use session directory reachable", () => {
    const first = join(tempDir, "sessions");
    const second = join(first, "project");
    const events: string[] = [];

    ensureDirectoryDurably(second, {
      mkdirSync: (path, options) => {
        events.push(`mkdir:${path}`);
        mkdirSync(path, options);
      },
      openSync: (path, flags, mode) => {
        events.push(`open:${path}`);
        return openSync(path, flags, mode);
      },
      fsyncSync: (fd) => {
        events.push("fsync");
        fsyncSync(fd);
      },
      closeSync,
    });

    expect(events).toEqual(
      process.platform === "win32"
        ? [`mkdir:${first}`, `mkdir:${second}`]
        : [`mkdir:${first}`, `open:${tempDir}`, "fsync", `mkdir:${second}`, `open:${first}`, "fsync"],
    );
  });
});
