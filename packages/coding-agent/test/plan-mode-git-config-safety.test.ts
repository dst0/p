import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSafeCommand } from "../examples/extensions/plan-mode/utils.ts";

describe("plan-mode repository Git configuration safety", () => {
  it("rejects diff text conversion helpers configured by the repository", () => {
    const root = createRepository("plan-mode-git-textconv-");
    const marker = join(root, "textconv-executed");
    try {
      const helper = join(root, "prepare");
      writeFileSync(helper, '#!/bin/sh\nprintf executed > textconv-executed\ncat "$1"\n');
      chmodSync(helper, 0o700);
      writeFileSync(join(root, ".gitattributes"), "*.txt diff=unsafe\n");
      writeFileSync(join(root, "sample.txt"), "before\n");
      execFileSync("git", ["config", "diff.unsafe.textconv", "./prepare"], { cwd: root });
      execFileSync("git", ["add", ".gitattributes", "sample.txt"], { cwd: root });
      execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
      writeFileSync(join(root, "sample.txt"), "after\n");

      execFileSync("git", ["diff", "--textconv"], { cwd: root, stdio: "ignore" });
      const helperExecuted = existsSync(marker);
      const allowed = isSafeCommand("git diff --textconv");

      expect({ allowed, helperExecuted }).toEqual({ allowed: false, helperExecuted: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects status hooks selected by repository configuration", () => {
    const root = createRepository("plan-mode-git-fsmonitor-");
    const marker = join(root, "fsmonitor-executed");
    try {
      const helper = join(root, "prepare");
      writeFileSync(helper, "#!/bin/sh\nprintf executed > fsmonitor-executed\nprintf '/'");
      chmodSync(helper, 0o700);
      execFileSync("git", ["config", "core.fsmonitor", "./prepare"], { cwd: root });

      execFileSync("git", ["status"], { cwd: root, stdio: "ignore" });
      const helperExecuted = existsSync(marker);
      const allowed = isSafeCommand("git status");

      expect({ allowed, helperExecuted }).toEqual({ allowed: false, helperExecuted: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps only repository-independent Git version discovery", () => {
    for (const command of [
      "git status",
      "git diff",
      "git log --oneline",
      "git show HEAD",
      "git branch --list",
      "git config --get user.name",
      "git ls-files",
      "git remote",
    ]) {
      expect(isSafeCommand(command)).toBe(false);
    }
    expect(isSafeCommand("git --version")).toBe(true);
  });
});

function createRepository(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Plan Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "plan@example.invalid"], { cwd: root });
  return root;
}
