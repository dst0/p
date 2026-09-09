import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAuthoritativeTypecheckCommand } from "../src/core/task-verification/check-command-classification.ts";

const workspaces: string[] = [];
const repositoryRoot = join(import.meta.dirname, "../../..");

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

describe("task-verification typecheck command authority", () => {
  it.each([
    "tsc --noEmit",
    "tsgo --noEmit",
    "node_modules/.bin/tsc --noEmit",
    "./node_modules/.bin/tsc --noEmit",
    "node node_modules/typescript/bin/tsc --noEmit",
    "command -- tsc --noEmit",
    "CI=1 command tsc --noEmit",
    "env CI=1 tsc --noEmit",
    "time tsc --noEmit",
    "cd ./packages/../packages/coding-agent && tsc --noEmit",
  ])("accepts a project-wide compiler invocation: %s", (command) => {
    expect(isAuthoritativeTypecheckCommand(command, repositoryRoot)).toBe(true);
  });

  it.each([
    "npx tsc --noEmit",
    "npm exec tsc --noEmit",
    "node_modules/.bin/tsc --version",
    "node_modules/.bin/tsc -version",
    "node_modules/.bin/tsc -v",
    "node_modules/.bin/tsc --help",
    "node_modules/.bin/tsc -h",
    "node_modules/.bin/tsc -showConfig",
    "node_modules/.bin/tsc -listFilesOnly",
    "node_modules/.bin/tsc -noCheck --noEmit",
    "node_modules/.bin/tsc -init",
    "node_modules/.bin/tsc -all --noEmit",
    "node_modules/.bin/tsc empty.ts --noEmit",
    "node_modules/.bin/tsc -b --dry",
    "node_modules/.bin/tsc -b -d",
    "node_modules/.bin/tsc -d -b",
    "node_modules/.bin/tsc --build --clean",
  ])("rejects a non-authoritative or partial compiler invocation: %s", (command) => {
    expect(isAuthoritativeTypecheckCommand(command, process.cwd())).toBe(false);
  });

  it("resolves package scripts instead of trusting their names", () => {
    const workspace = createPackageWorkspace({ typecheck: "tsc --noEmit", checktypes: "node -e 'process.exit(0)'" });
    expect(isAuthoritativeTypecheckCommand("npm run typecheck", workspace)).toBe(true);
    expect(isAuthoritativeTypecheckCommand("npm run checktypes", workspace)).toBe(false);
    expect(isAuthoritativeTypecheckCommand("npm run missing", workspace)).toBe(false);
  });

  it("rejects package scripts with implicit lifecycle hooks", () => {
    const workspace = createPackageWorkspace({
      posttypecheck: "node -e 'process.exit(0)'",
      pretypecheck: "node -e 'process.exit(0)'",
      typecheck: "tsc --noEmit",
    });
    expect(isAuthoritativeTypecheckCommand("npm run typecheck", workspace)).toBe(false);
  });

  it("rejects a real zero-exit TypeScript metadata command", () => {
    const workspace = createPackageWorkspace({});
    const compiler = join(workspace, "node_modules/.bin/tsc");
    expect(execFileSync(compiler, ["-version"], { cwd: workspace, encoding: "utf8" })).toContain("Version");
    expect(isAuthoritativeTypecheckCommand("node_modules/.bin/tsc -version", workspace)).toBe(false);
  });

  it("rejects a real partial-file check that bypasses a project error", () => {
    const workspace = createPackageWorkspace({});
    const compiler = join(workspace, "node_modules/.bin/tsc");
    mkdirSync(join(workspace, "types"));
    writeFileSync(join(workspace, "empty.ts"), "export {};\n");
    writeFileSync(join(workspace, "src/broken.ts"), "export const value: string = 1;\n");
    writeFileSync(join(workspace, "tsconfig.json"), '{"compilerOptions":{"strict":true},"include":["src"]}\n');
    expect(
      execFileSync(compiler, ["empty.ts", "--noEmit", "--typeRoots", "./types"], {
        cwd: workspace,
        encoding: "utf8",
      }),
    ).toBe("");
    expect(
      isAuthoritativeTypecheckCommand("node_modules/.bin/tsc empty.ts --noEmit --typeRoots ./types", workspace),
    ).toBe(false);
  });

  it("does not let an unrelated package config satisfy the changed source scope", () => {
    const compiler = join(repositoryRoot, "node_modules/.bin/tsc");
    expect(
      execFileSync(compiler, ["--project", "packages/ai/tsconfig.build.json", "--noEmit"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }),
    ).toBe("");
    expect(
      isAuthoritativeTypecheckCommand(
        "node_modules/.bin/tsc --project packages/ai/tsconfig.build.json --noEmit",
        repositoryRoot,
        ["packages/coding-agent/src/core/task-verification.ts"],
      ),
    ).toBe(false);
  });

  it("does not let a sibling config that excludes the changed source satisfy the scope", () => {
    expect(
      isAuthoritativeTypecheckCommand(
        "node_modules/.bin/tsc --project packages/coding-agent/tsconfig.examples.json --noEmit",
        repositoryRoot,
        ["packages/coding-agent/src/core/task-verification.ts"],
      ),
    ).toBe(false);
  });

  it("accepts a project config only when its effective include covers every changed source", () => {
    expect(
      isAuthoritativeTypecheckCommand(
        "node_modules/.bin/tsc --project packages/coding-agent/tsconfig.build.json --noEmit",
        repositoryRoot,
        ["packages/coding-agent/src/core/task-verification.ts"],
      ),
    ).toBe(true);
  });

  it("resolves inherited JSONC include, override, exclude, and allowJs settings", () => {
    const workspace = createConfigWorkspace();
    writeFileSync(
      join(workspace, "base.json"),
      '{\n  // inherited source scope\n  "compilerOptions": { "allowJs": true, },\n  "include": ["src", // JSONC trailing comma\n  ],\n}\n',
    );
    writeFileSync(join(workspace, "tsconfig.json"), '{"extends":"./base"}\n');
    expect(isAuthoritativeTypecheckCommand("tsc --noEmit", workspace, ["src/changed.ts", "src/helper.js"])).toBe(true);

    writeFileSync(join(workspace, "tsconfig.json"), '{"extends":"./base.json","exclude":["src/generated"]}\n');
    expect(isAuthoritativeTypecheckCommand("tsc --noEmit", workspace, ["src/generated/output.ts"])).toBe(false);

    writeFileSync(join(workspace, "tsconfig.json"), '{"extends":"./base.json","include":["examples/**/*.ts"]}\n');
    expect(isAuthoritativeTypecheckCommand("tsc --noEmit", workspace, ["src/changed.ts"])).toBe(false);
  });

  it("uses the default include while ignoring unrelated changed files", () => {
    const workspace = createConfigWorkspace();
    writeFileSync(join(workspace, "tsconfig.json"), "{}\n");
    expect(isAuthoritativeTypecheckCommand("tsc --noEmit", workspace, ["README.md", "src/changed.ts"])).toBe(true);
  });

  it("resolves a project directory to its tsconfig rather than a similarly named JSON file", () => {
    const workspace = createConfigWorkspace();
    mkdirSync(join(workspace, "project"));
    writeFileSync(join(workspace, "project.json"), '{"include":["other/**/*.ts"]}\n');
    writeFileSync(join(workspace, "project/tsconfig.json"), '{"include":["../src/**/*.ts"]}\n');
    expect(isAuthoritativeTypecheckCommand("tsc --project project --noEmit", workspace, ["src/changed.ts"])).toBe(true);
  });

  it("fails closed without throwing for a malformed JSONC config", () => {
    const workspace = createConfigWorkspace();
    writeFileSync(join(workspace, "tsconfig.json"), '{"include":["src"]} /* unterminated\n');
    expect(() => isAuthoritativeTypecheckCommand("tsc --noEmit", workspace, ["src/changed.ts"])).not.toThrow();
    expect(isAuthoritativeTypecheckCommand("tsc --noEmit", workspace, ["src/changed.ts"])).toBe(false);
  });

  it("does not interpret include syntax that TypeScript treats as literal", () => {
    const workspace = createConfigWorkspace();
    writeFileSync(join(workspace, "unrelated.ts"), "export {};\n");
    writeFileSync(join(workspace, "src/changed.ts"), "export const broken: string = 1;\n");
    writeFileSync(
      join(workspace, "tsconfig.json"),
      '{"compilerOptions":{"noEmit":true,"types":[]},"files":["unrelated.ts"],"include":["src/{changed,other}.ts"]}\n',
    );
    expect(
      execFileSync(join(repositoryRoot, "node_modules/.bin/tsc"), ["--project", "tsconfig.json"], {
        cwd: workspace,
        encoding: "utf8",
      }),
    ).toBe("");
    expect(isAuthoritativeTypecheckCommand("tsc --project tsconfig.json --noEmit", workspace, ["src/changed.ts"])).toBe(
      false,
    );
  });
});

function createPackageWorkspace(scripts: Record<string, string>): string {
  const workspace = mkdtempSync(join(tmpdir(), "p-typecheck-authority-"));
  workspaces.push(workspace);
  mkdirSync(join(workspace, "src"));
  symlinkSync(join(import.meta.dirname, "../../../node_modules"), join(workspace, "node_modules"));
  writeFileSync(join(workspace, "package.json"), `${JSON.stringify({ scripts })}\n`);
  return workspace;
}

function createConfigWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "p-typecheck-config-"));
  workspaces.push(workspace);
  mkdirSync(join(workspace, "src/generated"), { recursive: true });
  writeFileSync(join(workspace, "README.md"), "docs\n");
  writeFileSync(join(workspace, "src/changed.ts"), "export {};\n");
  writeFileSync(join(workspace, "src/helper.js"), "export {};\n");
  writeFileSync(join(workspace, "src/generated/output.ts"), "export {};\n");
  return workspace;
}
