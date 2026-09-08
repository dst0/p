import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunBudgetState } from "../src/core/run-budget/types.ts";

interface FsModule {
  fsyncSync(fd: number): void;
  openSync(...args: unknown[]): number;
  renameSync(oldPath: unknown, newPath: unknown): void;
}

const durabilityIo = vi.hoisted(() => ({
  directory: "",
  fsyncs: 0,
  rejectDirectoryOpen: false,
  renames: 0,
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal();
  if (!original || typeof original !== "object") throw new Error("Expected node:fs module");
  const fs = original as FsModule;
  return {
    ...original,
    fsyncSync: (fd: number) => {
      durabilityIo.fsyncs++;
      fs.fsyncSync(fd);
    },
    openSync: (...args: unknown[]) => {
      if (durabilityIo.rejectDirectoryOpen && args[0] === durabilityIo.directory && args[1] === "r") {
        throw Object.assign(new Error("Directory handles cannot be opened on Windows"), { code: "EISDIR" });
      }
      return Reflect.apply(fs.openSync, fs, args);
    },
    renameSync: (oldPath: unknown, newPath: unknown) => {
      durabilityIo.renames++;
      fs.renameSync(oldPath, newPath);
    },
  };
});

import { RunBudgetStorage } from "../src/core/run-budget/state-storage.ts";

const initial: RunBudgetState = {
  version: 1,
  scopeId: "windows-task",
  policy: { mode: "unlimited" },
  requests: 0,
  tokens: 0,
  usd: 0,
  pending: [],
  uncertainTokens: false,
  uncertainUsd: false,
};

const paths: string[] = [];
const hostPlatform = process.platform;

beforeEach(() => {
  durabilityIo.directory = "";
  durabilityIo.fsyncs = 0;
  durabilityIo.rejectDirectoryOpen = false;
  durabilityIo.renames = 0;
  Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
});

afterEach(() => {
  Object.defineProperty(process, "platform", { configurable: true, value: hostPlatform });
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Windows task-budget durability", () => {
  it("commits the fsynced replacement without trying to open a directory handle", () => {
    const directory = mkdtempSync(join(tmpdir(), "p-budget-windows-"));
    paths.push(directory);
    durabilityIo.directory = join(directory, ".budgets");
    durabilityIo.rejectDirectoryOpen = true;
    const storage = new RunBudgetStorage(initial, join(directory, ".budgets", "budget.json"), directory);

    expect(() =>
      storage.update((state) => {
        state.requests = 1;
      }),
    ).not.toThrow();
    expect(storage.read().requests).toBe(1);
    expect(durabilityIo.fsyncs).toBe(1);
    expect(durabilityIo.renames).toBe(1);
  });
});
