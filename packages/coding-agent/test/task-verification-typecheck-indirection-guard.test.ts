import { describe, expect, it } from "vitest";
import { isAuthoritativeTypecheckCommand } from "../src/core/task-verification/check-command-classification.ts";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

describe("task-verification typecheck indirection guard", () => {
  it.each([
    "bash -c 'tsc --noEmit'",
    "sh -c 'tsc --noEmit'",
    "zsh -c 'tsc --noEmit'",
    "eval 'tsc --noEmit'",
    "tsc --noEmit && echo success",
    "tsc --noEmit | cat",
    "tsc --noEmit > result.txt",
    "tsc --noEmit $(printf empty.ts)",
    "tsc --noEmit `printf empty.ts`",
    "env -C packages/coding-agent tsc --noEmit",
    "env --chdir=packages/coding-agent tsc --noEmit",
    "env -P /tmp tsc --noEmit",
    "pnpm --filter missing exec tsc --noEmit",
    "pnpm -F missing exec tsc --noEmit",
    "pnpm --dir ../foreign exec tsc --noEmit",
    "pnpm -C /tmp exec tsc --noEmit",
    "npm --prefix=/tmp run typecheck",
    "yarn --cwd /tmp run typecheck",
    "pnpm dlx tsc --noEmit",
    "bunx tsc --noEmit",
    "tsc --project ../tsconfig.json --noEmit",
    "tsc --project=$CONFIG --noEmit",
    "command -- -v tsc --noEmit",
    "command -p -- -v tsc --noEmit",
    "command FOO=bar tsc --noEmit",
    "command -- FOO=bar tsc --noEmit",
    "env FOO=bar -i tsc --noEmit",
    "env -- FOO=bar -i tsc --noEmit",
    "LD_PRELOAD=./noop.so tsc --noEmit",
    "DYLD_INSERT_LIBRARIES=./noop.dylib tsc --noEmit",
    "DYLD_LIBRARY_PATH=./lib tsc --noEmit",
    "npm --prefix benchmarks/fixtures/typescript-calculator --prefix . run typecheck",
  ])("rejects resolution changes, masking, and invalid wrapper order: %s", (command) => {
    expect(isAuthoritativeTypecheckCommand(command, repositoryRoot)).toBe(false);
  });

  it("normalizes equivalent literal working directories", () => {
    expect(
      isAuthoritativeTypecheckCommand("cd ./packages/../packages/coding-agent && tsc --noEmit", repositoryRoot),
    ).toBe(true);
  });

  it("accepts a package runner only when its literal cwd remains bound", () => {
    expect(isAuthoritativeTypecheckCommand("pnpm --dir . exec tsc --noEmit", repositoryRoot)).toBe(true);
  });

  it.each([String.raw`$'\u{110000}' tsc --noEmit`, String.raw`$'\uD800' tsc --noEmit`])(
    "never throws for an invalid ANSI-C Unicode escape: %s",
    (command) => {
      expect(() => isAuthoritativeTypecheckCommand(command, repositoryRoot)).not.toThrow();
      expect(isAuthoritativeTypecheckCommand(command, repositoryRoot)).toBe(false);
    },
  );
});
