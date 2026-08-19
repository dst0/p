import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { disableDetachedGitMaintenance } from "./git-test-fixture.js";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "restage-precommit-files.js");
const hookPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".husky", "pre-commit");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

test("restages an already force-staged ignored file without staging unrelated work", () => {
  const root = mkdtempSync(join(tmpdir(), "p-precommit-restage-"));
  try {
    git(root, ["init", "--quiet"]);
    disableDetachedGitMaintenance(root);
    git(root, ["config", "user.email", "test@example.invalid"]);
    git(root, ["config", "user.name", "Test"]);
    writeFileSync(join(root, ".gitignore"), "archives/\n/-ignored.br\n");
    writeFileSync(join(root, "ordinary.txt"), "baseline\n");
    writeFileSync(join(root, "removed-before-check.txt"), "baseline\n");
    writeFileSync(join(root, "removed-during-check.txt"), "baseline\n");
    git(root, ["add", ".gitignore", "ordinary.txt", "removed-before-check.txt", "removed-during-check.txt"]);
    git(root, ["commit", "--quiet", "-m", "baseline"]);

    mkdirSync(join(root, "archives"));
    const archiveName = "archives/evidence log.br";
    const ignoredRootName = "-ignored.br";
    writeFileSync(join(root, archiveName), "before formatting\n");
    writeFileSync(join(root, ignoredRootName), "before formatting\n");
    git(root, ["add", "-f", "--", archiveName, ignoredRootName]);
    unlinkSync(join(root, "removed-before-check.txt"));
    git(root, ["add", "-u", "--", "removed-before-check.txt"]);
    writeFileSync(join(root, "removed-during-check.txt"), "staged modification\n");
    git(root, ["add", "--", "removed-during-check.txt"]);

    writeFileSync(join(root, archiveName), "after formatting\n");
    writeFileSync(join(root, ignoredRootName), "after formatting\n");
    unlinkSync(join(root, "removed-during-check.txt"));
    writeFileSync(join(root, "ordinary.txt"), "unrelated work\n");

    execFileSync(process.execPath, [scriptPath], { cwd: root });

    assert.equal(git(root, ["show", `:${archiveName}`]), "after formatting\n");
    assert.equal(git(root, ["show", `:${ignoredRootName}`]), "after formatting\n");
    assert.deepEqual(git(root, ["diff", "--cached", "--diff-filter=D", "--name-only"]).trim().split("\n"), [
      "removed-before-check.txt",
      "removed-during-check.txt",
    ]);
    assert.equal(readFileSync(join(root, "ordinary.txt"), "utf8"), "unrelated work\n");
    assert.equal(git(root, ["show", ":ordinary.txt"]), "baseline\n");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("treats newline and colon-magic filenames as literal paths", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "p-precommit-special-path-"));
  try {
    git(root, ["init", "--quiet"]);
    disableDetachedGitMaintenance(root);
    git(root, ["config", "user.email", "test@example.invalid"]);
    git(root, ["config", "user.name", "Test"]);
    writeFileSync(join(root, ".gitignore"), "archives/\n");
    writeFileSync(join(root, "ordinary.txt"), "baseline\n");
    git(root, ["add", ".gitignore", "ordinary.txt"]);
    git(root, ["commit", "--quiet", "-m", "baseline"]);

    mkdirSync(join(root, "archives"));
    const archiveName = "archives/evidence\nlog.br";
    const magicName = ":(glob)*.txt";
    writeFileSync(join(root, archiveName), "before formatting\n");
    writeFileSync(join(root, magicName), "before formatting\n");
    git(root, ["add", "-f", "--", archiveName]);
    git(root, ["--literal-pathspecs", "add", "--", magicName]);
    writeFileSync(join(root, archiveName), "after formatting\n");
    writeFileSync(join(root, magicName), "after formatting\n");
    writeFileSync(join(root, "ordinary.txt"), "unrelated work\n");

    execFileSync(process.execPath, [scriptPath], { cwd: root });

    assert.equal(git(root, ["show", `:${archiveName}`]), "after formatting\n");
    assert.equal(git(root, ["show", `:${magicName}`]), "after formatting\n");
    assert.equal(git(root, ["show", ":ordinary.txt"]), "baseline\n");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects partially staged paths before formatting", () => {
  const root = mkdtempSync(join(tmpdir(), "p-precommit-partial-"));
  try {
    git(root, ["init", "--quiet"]);
    disableDetachedGitMaintenance(root);
    git(root, ["config", "user.email", "test@example.invalid"]);
    git(root, ["config", "user.name", "Test"]);
    writeFileSync(join(root, "partial.txt"), "baseline\n");
    git(root, ["add", "partial.txt"]);
    git(root, ["commit", "--quiet", "-m", "baseline"]);
    writeFileSync(join(root, "partial.txt"), "staged\n");
    git(root, ["add", "partial.txt"]);
    writeFileSync(join(root, "partial.txt"), "unstaged\n");

    const result = spawnSync(process.execPath, [scriptPath, "--assert-clean"], { cwd: root, encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.equal(git(root, ["show", ":partial.txt"]), "staged\n");
    assert.equal(readFileSync(join(root, "partial.txt"), "utf8"), "unstaged\n");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("the hook fails when post-check restaging fails", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "p-precommit-hook-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const commands = {
      git: "#!/bin/sh\nexit 0\n",
      node: `#!/bin/sh\nif [ "$1" = "scripts/restage-precommit-files.js" ] && [ "$2" != "--assert-clean" ]; then exit 17; fi\nexit 0\n`,
      npm: "#!/bin/sh\nexit 0\n",
    };
    for (const [name, source] of Object.entries(commands)) {
      const path = join(bin, name);
      writeFileSync(path, source);
      chmodSync(path, 0o755);
    }

    const result = spawnSync("/bin/sh", [hookPath], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: bin },
    });

    assert.equal(result.status, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
