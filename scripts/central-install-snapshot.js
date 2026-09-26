#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const installRoot = path.join(os.homedir(), ".p", "install");
const versionsRoot = path.join(installRoot, "versions");
const currentLink = path.join(installRoot, "current");
const previousLink = path.join(installRoot, "previous");
const sourceMarker = ".p-source-sha";
const builtMarker = ".p-runtime-built";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function requireOwnedDirectory(directory) {
  const details = fs.lstatSync(directory);
  if (!details.isDirectory() || details.isSymbolicLink() || details.uid !== process.getuid()) {
    throw new Error(`Installation directory is not an owned real directory: ${directory}`);
  }
  if ((details.mode & 0o077) !== 0) {
    throw new Error(`Installation directory must be private (mode 0700): ${directory}`);
  }
}

function requireSafeParent(directory) {
  const details = fs.lstatSync(directory);
  if (
    !details.isDirectory() || details.isSymbolicLink() || details.uid !== process.getuid() ||
    (details.mode & 0o022) !== 0
  ) {
    throw new Error(`Installation parent must be owned, real, and not writable by others: ${directory}`);
  }
}

function prepareInstallRoot() {
  const parent = path.dirname(installRoot);
  requireSafeParent(os.homedir());
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { mode: 0o700 });
  requireSafeParent(parent);
  if (!fs.existsSync(installRoot)) fs.mkdirSync(installRoot, { mode: 0o700 });
  requireOwnedDirectory(installRoot);
  if (!fs.existsSync(versionsRoot)) fs.mkdirSync(versionsRoot, { mode: 0o700 });
  requireOwnedDirectory(versionsRoot);
}

function optionalLinkTarget(link) {
  const details = fs.lstatSync(link, { throwIfNoEntry: false });
  if (!details) return undefined;
  if (!details.isSymbolicLink()) throw new Error(`Refusing to replace a non-symlink: ${link}`);
  return validatedRuntime(link);
}

function validatedRuntime(directory, requireBuilt = true) {
  const versionRoot = fs.realpathSync(versionsRoot);
  const runtime = fs.realpathSync(directory);
  if (path.dirname(runtime) !== versionRoot) throw new Error(`Runtime must be directly inside ${versionRoot}`);
  const marker = fs.readFileSync(path.join(runtime, sourceMarker), "utf8").trim();
  if (!/^[0-9a-f]{40,64}$/.test(marker) || !fs.statSync(path.join(runtime, "reinstall.sh")).isFile()) {
    throw new Error(`Invalid centralized runtime: ${runtime}`);
  }
  if (requireBuilt && fs.readFileSync(path.join(runtime, builtMarker), "utf8").trim() !== marker) {
    throw new Error(`Centralized runtime was not successfully built: ${runtime}`);
  }
  return runtime;
}

function replaceLink(link, target) {
  const temporaryLink = `${link}.${randomUUID()}.tmp`;
  try {
    fs.symlinkSync(target, temporaryLink);
    fs.renameSync(temporaryLink, link);
  } finally {
    fs.rmSync(temporaryLink, { force: true });
  }
}

function stage(source) {
  if (!source) throw new Error("stage requires a source checkout");
  const checkout = fs.realpathSync(source);
  const gitRoot = fs.realpathSync(run("git", ["rev-parse", "--show-toplevel"], checkout));
  if (checkout !== gitRoot) throw new Error("Source must be the repository root");
  const sha = run("git", ["rev-parse", "HEAD"], checkout);
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("Source HEAD is not a full commit ID");
  if (run("git", ["status", "--porcelain", "--untracked-files=all"], checkout)) {
    throw new Error("Source checkout must be clean, including untracked files, before centralized reinstall");
  }
  const trackedEntries = run("git", ["ls-files", "--stage"], checkout);
  if (/^(120000|160000) /m.test(trackedEntries)) {
    throw new Error("Centralized snapshot does not support tracked symlinks or submodules");
  }
  prepareInstallRoot();
  optionalLinkTarget(currentLink);
  optionalLinkTarget(previousLink);
  const staging = fs.mkdtempSync(path.join(versionsRoot, ".staging-"));
  const archive = path.join(staging, ".source.tar");
  try {
    run("git", ["archive", "--format=tar", `--output=${archive}`, sha], checkout);
    run("tar", ["-xf", archive, "-C", staging], checkout);
    fs.unlinkSync(archive);
    fs.writeFileSync(path.join(staging, sourceMarker), `${sha}\n`, { mode: 0o600 });
    const pkg = JSON.parse(fs.readFileSync(path.join(staging, "package.json"), "utf8"));
    if (pkg.name !== "p-monorepo" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
      throw new Error("Snapshot is not a versioned p monorepo");
    }
    const runtime = path.join(versionsRoot, `v${pkg.version}-${sha.slice(0, 12)}-${randomUUID().slice(0, 8)}`);
    fs.renameSync(staging, runtime);
    console.log(runtime);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function markBuilt(directory) {
  if (!directory) throw new Error("mark-built requires a runtime directory");
  prepareInstallRoot();
  const runtime = validatedRuntime(directory, false);
  const entrypoint = path.join(runtime, "packages", "coding-agent", "dist", "cli.js");
  if (!fs.statSync(entrypoint).isFile()) throw new Error(`Built p CLI not found: ${entrypoint}`);
  fs.writeFileSync(path.join(runtime, builtMarker), fs.readFileSync(path.join(runtime, sourceMarker)), { mode: 0o600 });
}

function activate(directory) {
  if (!directory) throw new Error("activate requires a runtime directory");
  prepareInstallRoot();
  const target = validatedRuntime(directory);
  const active = optionalLinkTarget(currentLink);
  optionalLinkTarget(previousLink);
  if (active === target) return;
  if (active) replaceLink(previousLink, active);
  replaceLink(currentLink, target);
  console.log(`Centralized p runtime: ${target}`);
}

try {
  const [command, argument] = process.argv.slice(2);
  if (command === "prepare") prepareInstallRoot();
  else if (command === "stage") stage(argument);
  else if (command === "mark-built") markBuilt(argument);
  else if (command === "activate") activate(argument);
  else throw new Error("Usage: central-install-snapshot.js prepare | stage <checkout> | mark-built <runtime> | activate <runtime>");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
