import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyExactFileBytesAssertion } from "../src/core/task-verification/exact-file-assertion-classifier.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("exact file assertion classifier", () => {
  it("accepts a live exact-byte diff and derives bounded semantic selectors", () => {
    const cwd = createWorkspace("ready\n");
    const claim = classify(cwd, "diff <(printf 'ready\\n') status.txt");

    expect(claim).toEqual({
      kind: "file_exact_bytes",
      path: "status.txt",
      expectedSha256: sha256("ready\n"),
      selectors: ["status.txt", "exact file bytes validation for status.txt", "newline-terminated; 1 line"],
    });
  });

  it("accepts cmp with safe printf escapes and one literal success echo", () => {
    const expected = "one\r\ttwo\\100%\n";
    const cwd = createWorkspace(expected);
    const claim = classify(cwd, "cmp -s <(printf 'one\\r\\ttwo\\\\100%%\\n') ./status.txt && echo exact bytes match");

    expect(claim?.expectedSha256).toBe(sha256(expected));
    expect(claim?.path).toBe("status.txt");
    expect(claim?.selectors.at(-1)).toBe("newline-terminated; 1 line");
  });

  it.each([
    ["failed command", "diff <(printf 'ready\\n') status.txt", true],
    ["unowned target", "diff <(printf 'ready\\n') other.txt", false],
    ["source target", "diff <(printf 'ready\\n') status.ts", false],
    ["test source target", "diff <(printf 'ready\\n') status.test.ts", false],
    ["spec source target", "diff <(printf 'ready\\n') status.spec.ts", false],
    ["generated source target", "diff <(printf 'ready\\n') status.generated.ts", false],
    ["shell source target", "diff <(printf 'ready\\n') deploy.sh", false],
    ["HTML source target", "diff <(printf 'ready\\n') report.html", false],
    ["SQL source target", "diff <(printf 'ready\\n') schema.sql", false],
    ["outside target", "diff <(printf 'ready\\n') ../status.txt", false],
    ["absolute target", "diff <(printf 'ready\\n') /tmp/status.txt", false],
    ["dynamic target", "diff <(printf 'ready\\n') $TARGET", false],
    ["backtick target", "diff <(printf 'ready\\n') `pwd`/status.txt", false],
    ["other process substitution", "diff <(cat expected.txt) status.txt", false],
    ["pipe", "diff <(printf 'ready\\n') status.txt | cat", false],
    ["semicolon", "diff <(printf 'ready\\n') status.txt; true", false],
    ["masked failure", "diff <(printf 'ready\\n') status.txt || true", false],
    ["redirection", "diff <(printf 'ready\\n') status.txt > result.txt", false],
    ["prefixed command", "true && diff <(printf 'ready\\n') status.txt", false],
    ["multiple commands", "diff <(printf 'ready\\n') status.txt && echo ok && echo again", false],
    ["same-file comparison", "cmp -s status.txt status.txt", false],
    ["format directive", "diff <(printf '%s' ready) status.txt", false],
    ["unsupported hex escape", "diff <(printf '\\x72eady\\n') status.txt", false],
    ["unsupported zero escape", "diff <(printf '\\0ready\\n') status.txt", false],
    ["echo redirection", "diff <(printf 'ready\\n') status.txt && echo ok > result.txt", false],
  ])("rejects %s", (_name, descriptor, isError) => {
    const cwd = createWorkspace("ready\n");
    const sourcePaths = [
      "status.ts",
      "status.test.ts",
      "status.spec.ts",
      "status.generated.ts",
      "deploy.sh",
      "report.html",
      "schema.sql",
    ];
    for (const name of sourcePaths) writeFileSync(join(cwd, name), "ready\n");
    expect(
      classifyExactFileBytesAssertion({
        cwd,
        taskOwnedPaths: ["status.txt", ...sourcePaths],
        descriptor,
        isError,
      }),
    ).toBeUndefined();
  });

  it("rejects changed bytes, oversized literals, and oversized paths", () => {
    const cwd = createWorkspace("changed\n");
    expect(classify(cwd, "diff <(printf 'ready\\n') status.txt")).toBeUndefined();
    expect(classify(cwd, `diff <(printf '${"x".repeat(8_193)}') status.txt`)).toBeUndefined();
    expect(
      classifyExactFileBytesAssertion({
        cwd,
        taskOwnedPaths: [`${"a".repeat(501)}`],
        descriptor: `diff <(printf 'changed\\n') ${"a".repeat(501)}`,
        isError: false,
      }),
    ).toBeUndefined();
  });

  it("rejects an oversized actual file and an extensionless executable script", () => {
    const cwd = createWorkspace(`${"x".repeat(8_193)}\n`);
    expect(classify(cwd, "diff <(printf 'ready\\n') status.txt")).toBeUndefined();
    writeFileSync(join(cwd, "runner"), "#!/bin/sh\necho ready\n");
    expect(classify(cwd, "diff <(printf '#!/bin/sh\\necho ready\\n') runner", ["runner"])).toBeUndefined();
  });

  it("rejects symlink files and paths traversing symlink directories", () => {
    const cwd = createWorkspace("ready\n");
    writeFileSync(join(cwd, "actual.txt"), "ready\n");
    symlinkSync("actual.txt", join(cwd, "linked.txt"));
    mkdirSync(join(cwd, "actual-dir"));
    writeFileSync(join(cwd, "actual-dir/status.txt"), "ready\n");
    symlinkSync("actual-dir", join(cwd, "linked-dir"));

    expect(classify(cwd, "diff <(printf 'ready\\n') linked.txt", ["linked.txt"])).toBeUndefined();
    expect(classify(cwd, "diff <(printf 'ready\\n') linked-dir/status.txt", ["linked-dir/status.txt"])).toBeUndefined();
  });
});

function createWorkspace(status: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-exact-file-assertion-"));
  temporaryDirectories.push(cwd);
  writeFileSync(join(cwd, "status.txt"), status);
  writeFileSync(join(cwd, "other.txt"), status);
  return cwd;
}

function classify(cwd: string, descriptor: string, taskOwnedPaths: readonly string[] = ["status.txt"]) {
  return classifyExactFileBytesAssertion({ cwd, taskOwnedPaths, descriptor, isError: false });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
