import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverFilesWithOptions } from "../src/discover.ts";

describe("file discovery and security boundary filtering", () => {
  it("filters out directories, special files, and files exceeding max size", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-disc-filter-"));
    try {
      const subDir = path.join(tmpDir, "subfolder");
      fs.mkdirSync(subDir);
      const oversized = path.join(tmpDir, "oversized.ts");
      fs.writeFileSync(oversized, "x".repeat(5000));
      const valid = path.join(tmpDir, "valid.ts");
      fs.writeFileSync(valid, "export const ok = 1;\n");

      const found = discoverFilesWithOptions(tmpDir, { maxFileSize: 1000 });
      expect(found).toEqual([valid]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("filters private keys, credentials, and non-sample environment files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-disc-sec-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "server.pem"), "cert");
      fs.writeFileSync(path.join(tmpDir, "private.key"), "key");
      fs.writeFileSync(path.join(tmpDir, ".env"), "secret=1");
      fs.writeFileSync(path.join(tmpDir, ".env.local"), "secret=2");
      fs.writeFileSync(path.join(tmpDir, ".env.production"), "secret=3");
      fs.writeFileSync(path.join(tmpDir, "id_rsa"), "ssh-key");
      fs.writeFileSync(path.join(tmpDir, ".npmrc"), "token=123");
      const secDir = path.join(tmpDir, "secrets");
      fs.mkdirSync(secDir);
      fs.writeFileSync(path.join(secDir, "key.txt"), "secret");

      fs.writeFileSync(path.join(tmpDir, ".env.example"), "PUBLIC=1");
      fs.writeFileSync(path.join(tmpDir, ".env.sample"), "VAR=sample");
      fs.writeFileSync(path.join(tmpDir, ".env.template"), "VAR=template");
      fs.writeFileSync(path.join(tmpDir, "index.ts"), "export const a = 1;\n");

      const found = discoverFilesWithOptions(tmpDir, { maxFileSize: 10000 });
      const basenames = found.map((f) => path.basename(f)).sort();
      expect(basenames).toEqual([".env.example", ".env.sample", ".env.template", "index.ts"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("prevents traversal from symlinks pointing outside workspace root", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p-disc-root-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-disc-outside-"));
    try {
      const outsideFile = path.join(outsideDir, "outside.ts");
      fs.writeFileSync(outsideFile, "export const secret = 42;\n");
      const symlinkPath = path.join(tmpRoot, "symlink_escape.ts");
      try {
        fs.symlinkSync(outsideFile, symlinkPath);
      } catch {
        // Ignored on environments without symlink capabilities
      }

      const discovered = discoverFilesWithOptions(tmpRoot, { maxFileSize: 10000 });
      expect(discovered).not.toContain(symlinkPath);
      expect(discovered).not.toContain(outsideFile);
      expect(discovered).toEqual([]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
