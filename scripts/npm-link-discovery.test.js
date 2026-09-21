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
  assert.match(reinstall, /assert_no_local_checkout_p_alias_shadow/);
  assert.match(reinstall, /discover_npm_backed_p_links_on_path "\$\{PATH:-\}"/);
  assert.doesNotMatch(reinstall, /type -a -p p/);
});

test("rejects a shell alias that bypasses the managed p link without leaking its command", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-shell-alias-shadow-"));
  context.after(() => fs.rmSync(root, { force: true, recursive: true }));
  fs.writeFileSync(
    path.join(root, ".zshrc"),
    [
      "# alias p='/ignored/packages/coding-agent/dist/cli.js'",
      "alias pp='/ignored/packages/coding-agent/dist/cli.js'",
      "alias p='/private/project/packages/coding-agent/dist/cli.js'",
      "",
    ].join("\n"),
  );

  const result = runAliasShadowCheck(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.zshrc:3/);
  assert.match(result.stderr, /Remove the stale alias/);
  assert.doesNotMatch(result.stderr, /private\/project/);
});

test("rejects zsh alias variants and continued local-checkout entrypoints", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-shell-alias-variants-"));
  context.after(() => fs.rmSync(root, { force: true, recursive: true }));
  fs.writeFileSync(
    path.join(root, ".zshrc"),
    [
      "alias -g p='/first/packages/coding-agent/dist/cli.js'",
      "aliases[p]='/second/packages/coding-agent/dist/cli.js'",
      "builtin alias p=\\",
      "'/third/packages/coding-agent/dist/cli.js'",
      "# <<IGNORED",
      "alias p='/fourth/packages/coding-agent/dist/cli.js'",
      "IGNORED",
      "message='first line",
      "<<QUOTED'",
      "cat <<END-MARK",
      "plain heredoc text",
      "END-MARK",
      "alias p='/fifth/packages/coding-agent/dist/cli.js'",
      "true && alias p='/sixth/packages/coding-agent/dist/cli.js'",
      "",
    ].join("\n"),
  );

  const result = runAliasShadowCheck(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.zshrc:1/);
  assert.match(result.stderr, /\.zshrc:2/);
  assert.match(result.stderr, /\.zshrc:3/);
  assert.match(result.stderr, /\.zshrc:6/);
  assert.match(result.stderr, /\.zshrc:13/);
  assert.match(result.stderr, /\.zshrc:14/);
  assert.doesNotMatch(result.stderr, /\/first|\/second|\/third|\/fourth|\/fifth|\/sixth/);
});

test("accepts shell startup files without a local-checkout p alias", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-shell-alias-clear-"));
  context.after(() => fs.rmSync(root, { force: true, recursive: true }));
  fs.writeFileSync(path.join(root, ".zshrc"), "alias pp='/project/packages/coding-agent/dist/cli.js'\n");
  fs.writeFileSync(
    path.join(root, ".bashrc"),
    [
      "# alias p='/project/packages/coding-agent/dist/cli.js'",
      "alias p='/project/packages/coding-agent/dist/cli.js.backup'",
      "",
    ].join("\n"),
  );

  const result = runAliasShadowCheck(root);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("fails closed when a shell startup file cannot be inspected", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-shell-alias-unreadable-"));
  const config = path.join(root, ".zshrc");
  context.after(() => {
    fs.chmodSync(config, 0o600);
    fs.rmSync(root, { force: true, recursive: true });
  });
  fs.writeFileSync(config, "alias p='/project/packages/coding-agent/dist/cli.js'\n", { mode: 0o000 });

  const result = runAliasShadowCheck(root);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unable to inspect shell startup file: .*\.zshrc/);
  assert.doesNotMatch(result.stderr, /\/project/);
});

test("reinstall rejects the alias before starting its transaction or npm", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-shell-alias-reinstall-"));
  context.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const bin = path.join(root, "bin");
  const npmCalled = path.join(root, "npm-called");
  const agentDirectory = path.join(root, "agent");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, ".zshrc"), "alias p='/project/packages/coding-agent/dist/cli.js'\n");
  fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh\ntouch '${npmCalled}'\nexit 99\n`, { mode: 0o700 });

  const result = spawnSync("/bin/bash", [path.join(repositoryRoot, "reinstall.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      P_CODING_AGENT_DIR: agentDirectory,
    },
  });

  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(npmCalled), false);
  assert.equal(fs.existsSync(agentDirectory), false);
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

function runAliasShadowCheck(homeDirectory) {
  const shell = ['source "$1"', "assert_no_local_checkout_p_alias_shadow"].join("\n");
  return spawnSync("/bin/bash", ["-c", shell, "bash", discoveryScript], {
    encoding: "utf8",
    env: { ...process.env, HOME: homeDirectory },
  });
}
