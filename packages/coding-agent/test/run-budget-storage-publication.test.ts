import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunBudgetState } from "../src/core/run-budget/types.ts";

const publicationRace = vi.hoisted(() => ({ enabled: false }));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal();
  if (!original || typeof original !== "object") throw new Error("Expected node:fs module");
  const fs = original as {
    readFileSync(path: string, encoding: "utf8"): string;
    renameSync(source: string, target: string): void;
    writeFileSync(path: string, data: string): void;
  };
  return {
    ...original,
    renameSync: (source: string, target: string) => {
      fs.renameSync(source, target);
      if (!publicationRace.enabled || !target.endsWith("budget.json")) return;
      const replacement = JSON.parse(fs.readFileSync(target, "utf8")) as Record<string, unknown>;
      replacement.requests = 99;
      const replacementPath = `${target}.replacement`;
      fs.writeFileSync(replacementPath, `${JSON.stringify(replacement)}\n`);
      fs.renameSync(replacementPath, target);
    },
  };
});

import { RunBudgetStorage } from "../src/core/run-budget/state-storage.ts";

const initial: RunBudgetState = {
  version: 1,
  scopeId: "publication-race",
  policy: { mode: "unlimited" },
  requests: 0,
  tokens: 0,
  usd: 0,
  pending: [],
  uncertainTokens: false,
  uncertainUsd: false,
};

const paths: string[] = [];

afterEach(() => {
  publicationRace.enabled = false;
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("run-budget publication verification", () => {
  it("rejects a concurrent replacement after atomic rename", () => {
    const directory = mkdtempSync(join(tmpdir(), "p-budget-publication-"));
    paths.push(directory);
    const path = join(directory, "budget.json");
    const storage = new RunBudgetStorage(initial, path, directory);
    storage.update((state) => {
      state.requests = 1;
    });

    publicationRace.enabled = true;
    expect(() =>
      storage.update((state) => {
        state.requests = 2;
      }),
    ).toThrow(/budget_storage_error/);

    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ requests: 99 });
    expect(storage.read().requests).toBe(99);
  });
});
