import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const discoveryScript = path.join(repositoryRoot, "scripts", "npm-link-discovery.sh");

test("reinstall uses filesystem PATH discovery instead of executable resolution", () => {
  const reinstall = fs.readFileSync(path.join(repositoryRoot, "reinstall.sh"), "utf8");

  assert.match(reinstall, /source "\$SCRIPT_DIR\/scripts\/npm-link-discovery\.sh"/);
  assert.match(reinstall, /discover_npm_backed_p_links_on_path "\$\{PATH:-\}"/);
  assert.doesNotMatch(reinstall, /type -a -p p/);
});

test("discovers a dangling npm-backed p symlink directly from PATH", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-npm-link-discovery-"));
  context.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const npmPrefix = path.join(root, "homebrew");
  const binDirectory = path.join(npmPrefix, "bin");
  const defaultPrefix = path.join(root, "node-prefix");
  const pCommand = path.join(binDirectory, "p");
  fs.mkdirSync(binDirectory, { recursive: true });
  fs.symlinkSync("../lib/node_modules/@dst0/p/dist/cli.js", pCommand);

  assert.deepEqual(runDiscovery(defaultPrefix, [binDirectory, binDirectory, ""].join(path.delimiter)), [
    `command=${pCommand}`,
    `prefix=${defaultPrefix}`,
    `prefix=${npmPrefix}`,
  ]);
});

test("discovers a dangling npm-backed p symlink with an absolute target", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-npm-link-absolute-"));
  context.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const npmPrefix = path.join(root, "homebrew");
  const binDirectory = path.join(npmPrefix, "bin");
  const defaultPrefix = path.join(root, "node-prefix");
  const pCommand = path.join(binDirectory, "p");
  const target = path.join(npmPrefix, "lib", "node_modules", "@dst0", "p", "dist", "cli.js");
  fs.mkdirSync(binDirectory, { recursive: true });
  fs.symlinkSync(target, pCommand);

  assert.deepEqual(runDiscovery(defaultPrefix, binDirectory), [
    `command=${pCommand}`,
    `prefix=${defaultPrefix}`,
    `prefix=${npmPrefix}`,
  ]);
});

test("rejects non-bin and lookalike npm link targets", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-npm-link-boundary-"));
  context.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const customDirectory = path.join(root, "custom", "scripts");
  const misleadingDirectory = path.join(root, "misleading", "bin");
  const foreignDirectory = path.join(root, "foreign", "bin");
  const defaultPrefix = path.join(root, "node-prefix");
  fs.mkdirSync(customDirectory, { recursive: true });
  fs.mkdirSync(misleadingDirectory, { recursive: true });
  fs.mkdirSync(foreignDirectory, { recursive: true });
  fs.symlinkSync("../lib/node_modules/@dst0/p/dist/cli.js", path.join(customDirectory, "p"));
  fs.symlinkSync("../lib/notnode_modules/@dst0/p/dist/cli.js", path.join(misleadingDirectory, "p"));
  fs.symlinkSync("/other/lib/node_modules/@dst0/p/dist/cli.js", path.join(foreignDirectory, "p"));

  assert.deepEqual(
    runDiscovery(defaultPrefix, [customDirectory, misleadingDirectory, foreignDirectory].join(path.delimiter)),
    [`prefix=${defaultPrefix}`],
  );
});

function runDiscovery(defaultPrefix, searchPath) {
  const shell = [
    "set -u",
    'source "$1"',
    'LINK_PREFIXES=("$2")',
    "P_COMMANDS=()",
    'discover_npm_backed_p_links_on_path "$3"',
    'for VALUE in "${P_COMMANDS[@]+"${P_COMMANDS[@]}"}"; do printf "command=%s\\n" "$VALUE"; done',
    'for VALUE in "${LINK_PREFIXES[@]}"; do printf "prefix=%s\\n" "$VALUE"; done',
  ].join("\n");
  const result = spawnSync("/bin/bash", ["-c", shell, "bash", discoveryScript, defaultPrefix, searchPath], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split("\n");
}
