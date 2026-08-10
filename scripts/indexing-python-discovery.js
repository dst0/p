import fs from "node:fs";

import { captureCommand, findOnPath, runCommand } from "./npu-install-utils.js";

export function findCompatiblePython(options = {}) {
  const allowInstall = options.allowInstall ?? true;
  const requiredMinor = options.requiredMinor;
  const search = () => {
    const names = requiredMinor !== undefined
      ? [`python3.${requiredMinor}`, "python3"]
      : process.platform === "darwin" && process.arch === "x64"
        ? ["python3.12", "python3.11", "python3.10", "python3"]
        : ["python3", "python3.14", "python3.13", "python3.12", "python3.11", "python3.10"];
    const candidates = [...new Set(names.map(findOnPath).filter(Boolean))];
    for (const candidate of candidates) {
      const version = captureCommand(candidate, [
        "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
      ], { allowFailure: true }).trim();
      const [major, minor] = version.split(".").map(Number);
      if (major !== 3 || minor < 10) continue;
      if (requiredMinor !== undefined && minor !== requiredMinor) continue;
      if (process.platform === "darwin" && process.arch === "x64" && minor > 12) continue;
      return candidate;
    }
    return undefined;
  };
  let found = search();
  if (!found && allowInstall) {
    tryAutoInstallPython(requiredMinor);
    found = search();
  }
  if (found) return found;
  throw new Error(
    requiredMinor !== undefined
      ? `Code indexing requires Python 3.${requiredMinor} for the selected backend.`
      : process.platform === "darwin" && process.arch === "x64"
        ? "Code indexing requires Python 3.10-3.12 on Intel macOS. Please install Python 3."
        : "Code indexing requires Python 3.10 or newer. Please install Python 3.",
  );
}

function tryAutoInstallPython(requiredMinor) {
  console.log("No compatible Python 3 found on PATH. Attempting automatic installation...");
  if (process.platform === "darwin") {
    const brew = findOnPath("brew")
      || (fs.existsSync("/opt/homebrew/bin/brew") ? "/opt/homebrew/bin/brew" : undefined);
    if (brew) {
      const pkg = requiredMinor === 12 || process.arch === "x64" ? "python@3.12" : "python3";
      runCommand(brew, ["install", pkg], { allowFailure: true });
    }
  } else if (process.platform === "linux") {
    installLinuxPython();
  }
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
