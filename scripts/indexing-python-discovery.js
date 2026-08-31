import fs from "node:fs";
import path from "node:path";

import { captureCommand, findOnPath, runCommand } from "./npu-install-utils.js";

export function indexingPythonCandidateNames({ platform = process.platform, requiredMinor } = {}) {
  if (requiredMinor !== undefined) return [`python3.${requiredMinor}`, "python3"];
  if (platform === "darwin") return ["python3.12", "python3"];
  return ["python3", "python3.14", "python3.13", "python3.12", "python3.11", "python3.10"];
}

export function findCompatiblePython(options = {}) {
  const allowInstall = options.allowInstall ?? true;
  const platform = options.platform ?? process.platform;
  const requiredMinor = options.requiredMinor ?? (platform === "darwin" ? 12 : undefined);
  const locate = options.findOnPath ?? findOnPath;
  const capture = options.captureCommand ?? captureCommand;
  const install = options.installPython ?? tryAutoInstallIndexingPython;
  let installedCandidates = [];
  const search = () => {
    const names = indexingPythonCandidateNames({ platform, requiredMinor });
    const candidates = [...new Set([
      ...names.map(locate),
      ...installedCandidates,
    ].filter(Boolean))];
    for (const candidate of candidates) {
      const version = capture(candidate, [
        "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
      ], { allowFailure: true }).trim();
      const [major, minor] = version.split(".").map(Number);
      if (major !== 3 || minor < 10) continue;
      if (requiredMinor !== undefined && minor !== requiredMinor) continue;
      return candidate;
    }
    return undefined;
  };
  let found = search();
  if (!found && allowInstall) {
    installedCandidates = install(requiredMinor, platform) ?? [];
    found = search();
  }
  if (found) return found;
  throw new Error(
    requiredMinor !== undefined
      ? `Code indexing requires Python 3.${requiredMinor} for the selected backend.`
      : "Code indexing requires Python 3.10 or newer. Please install Python 3.",
  );
}

export function tryAutoInstallIndexingPython(requiredMinor, platform = process.platform, dependencies = {}) {
  const locate = dependencies.findOnPath ?? findOnPath;
  const capture = dependencies.captureCommand ?? captureCommand;
  const run = dependencies.runCommand ?? runCommand;
  console.log("No compatible Python 3 found on PATH. Attempting automatic installation...");
  if (platform === "darwin") {
    const brew = locate("brew")
      || ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].find((candidate) => fs.existsSync(candidate));
    if (brew) {
      const minor = requiredMinor ?? 12;
      const pkg = `python@3.${minor}`;
      run(brew, ["install", pkg], { allowFailure: true });
      const prefix = capture(brew, ["--prefix", pkg], { allowFailure: true }).trim();
      return prefix
        ? [path.join(prefix, "bin", `python3.${minor}`)]
        : [path.join(path.dirname(brew), `python3.${minor}`)];
    }
  } else if (platform === "linux") {
    installLinuxPython();
  }
  return [];
}

function installLinuxPython() {
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (findOnPath("apt-get")) {
    const command = isRoot ? "apt-get" : "sudo";
    runCommand(command, isRoot ? ["update", "-qq"] : ["apt-get", "update", "-qq"], { allowFailure: true });
    runCommand(
      command,
      isRoot
        ? ["install", "-y", "-qq", "python3", "python3-venv", "python3-dev"]
        : ["apt-get", "install", "-y", "-qq", "python3", "python3-venv", "python3-dev"],
      { allowFailure: true },
    );
  } else if (findOnPath("dnf")) {
    runCommand(isRoot ? "dnf" : "sudo", isRoot
      ? ["install", "-y", "python3", "python3-devel"]
      : ["dnf", "install", "-y", "python3", "python3-devel"], { allowFailure: true });
  } else if (findOnPath("pacman")) {
    runCommand(isRoot ? "pacman" : "sudo", isRoot
      ? ["-Sy", "--noconfirm", "python"]
      : ["pacman", "-Sy", "--noconfirm", "python"], { allowFailure: true });
  }
}
