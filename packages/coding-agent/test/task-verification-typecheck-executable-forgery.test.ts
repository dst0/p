import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAuthoritativeTypecheckCommand } from "../src/core/task-verification/check-command-classification.ts";

describe("task-verification typecheck executable identity", () => {
  it.each([
    "fake/node_modules/.bin/tsc --noEmit",
    "../node_modules/.bin/tsc --noEmit",
    "node ../node_modules/typescript/bin/tsc --noEmit",
    "/tmp/node_modules/.bin/tsc --noEmit",
    String.raw`'./fake\node_modules\.bin\tsc' --noEmit`,
    String.raw`"./\node_modules/.bin/tsc" --noEmit`,
    String.raw`node './fake\node_modules\typescript\bin\tsc' --noEmit`,
    "TSC --noEmit",
    "tsc.cmd --noEmit",
    "tsc.exe --noEmit",
    "node.exe node_modules/typescript/bin/tsc --noEmit",
    "PNPM exec tsc --noEmit",
    "YARN exec tsc --noEmit",
    "TIME tsc --noEmit",
    "/usr/bin/time tsc --noEmit",
    "/usr/bin/env tsc --noEmit",
    "/usr/bin/command tsc --noEmit",
  ])("rejects forged POSIX compiler or runner identity: %s", (command) => {
    if (process.platform === "win32") return;
    expect(isAuthoritativeTypecheckCommand(command, process.cwd())).toBe(false);
  });

  it.each([
    "node -r ./preload.js node_modules/typescript/bin/tsc --noEmit",
    "node --import ./preload.js node_modules/typescript/bin/tsc --noEmit",
    "node -e 'process.exit(0)' node_modules/typescript/bin/tsc --noEmit",
    "node -p 1 node_modules/typescript/bin/tsc --noEmit",
    "node --version node_modules/typescript/bin/tsc --noEmit",
  ])("rejects Node preloads, evaluation, and metadata modes: %s", (command) => {
    expect(isAuthoritativeTypecheckCommand(command, process.cwd())).toBe(false);
  });

  it("rejects compiler and working-directory symlinks that escape the session root", () => {
    const workspace = mkdtempSync(join(tmpdir(), "p-typecheck-symlink-root-"));
    const external = mkdtempSync(join(tmpdir(), "p-typecheck-symlink-external-"));
    try {
      mkdirSync(join(workspace, "node_modules/.bin"), { recursive: true });
      writeFileSync(join(external, "tsc"), "external compiler\n");
      symlinkSync(join(external, "tsc"), join(workspace, "node_modules/.bin/tsc"));
      symlinkSync(external, join(workspace, "linked-package"));
      expect(isAuthoritativeTypecheckCommand("node_modules/.bin/tsc --noEmit", workspace)).toBe(false);
      expect(isAuthoritativeTypecheckCommand("cd linked-package && tsc --noEmit", workspace)).toBe(false);
      expect(isAuthoritativeTypecheckCommand("pnpm --dir linked-package exec tsc --noEmit", workspace)).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });
});
