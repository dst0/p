import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRebuildCheckpoint, loadRebuildPlan, rebuildArtifacts } from "../src/rag/service/rebuild-checkpoint.ts";

describe("rebuild checkpoint validation and artifact path derivation", () => {
  it("returns undefined for malformed checkpoint or plan files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-chk-val-"));
    try {
      const chkFile = path.join(tmpDir, "bad.checkpoint.json");
      fs.writeFileSync(chkFile, JSON.stringify({ invalid: true }));
      expect(loadRebuildCheckpoint(chkFile)).toBeUndefined();

      const testCases = [
        { schemaVersion: 999 },
        { schemaVersion: 1, repoId: 123 },
        { schemaVersion: 1, repoId: "r", root: "root", generation: "invalid/gen!" },
        {
          schemaVersion: 1,
          repoId: "r",
          root: "root",
          generation: "g",
          collection: "c",
          sourceFingerprint: "s",
          compatibilityFingerprint: "cf",
          chunkCount: -5,
        },
        {
          schemaVersion: 1,
          repoId: "r",
          root: "root",
          generation: "g",
          collection: "c",
          sourceFingerprint: "s",
          compatibilityFingerprint: "cf",
          chunkCount: 10,
          completedChunks: 15,
        },
      ];

      for (let i = 0; i < testCases.length; i++) {
        const filePath = path.join(tmpDir, `chk-${i}.json`);
        fs.writeFileSync(filePath, JSON.stringify(testCases[i]));
        expect(loadRebuildCheckpoint(filePath)).toBeUndefined();
      }

      const planFile = path.join(tmpDir, "bad.plan.json");
      fs.writeFileSync(planFile, JSON.stringify({ invalid: true }));
      expect(loadRebuildPlan(planFile, "gen1")).toBeUndefined();

      // Generation mismatch
      fs.writeFileSync(planFile, JSON.stringify({ schemaVersion: 1, generation: "other-gen", files: {} }));
      expect(loadRebuildPlan(planFile, "gen1")).toBeUndefined();

      // Non-existent files
      expect(loadRebuildCheckpoint(path.join(tmpDir, "nonexistent.json"))).toBeUndefined();
      expect(loadRebuildPlan(path.join(tmpDir, "nonexistent.json"), "gen1")).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("generates structured rebuild artifact paths for an active generation", () => {
    const arts = rebuildArtifacts("/tmp/repo", "gen123");
    expect(arts.checkpoint).toBe("/tmp/repo/rebuild-checkpoint.json");
    expect(arts.spool).toBe("/tmp/repo/.rebuild-gen123.jsonl");
    expect(arts.plan).toBe("/tmp/repo/.rebuild-gen123.plan.json");
    expect(arts.vocabulary).toBe("/tmp/repo/bm25-gen123.json");
  });
});
