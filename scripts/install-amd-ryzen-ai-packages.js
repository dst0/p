import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCommand, runElevated } from "./npu-install-utils.js";

export function installOfficialRyzenAiDriverArchive(runtimeRoot, manifest) {
  fs.mkdirSync(runtimeRoot, { mode: 0o700, recursive: true });
  const archive = path.join(runtimeRoot, manifest.driverArchive.name);
  if (!fs.existsSync(archive) || sha256File(archive) !== manifest.driverArchive.sha256) {
    runCommand("curl", ["-fL", manifest.driverArchive.url, "-o", archive]);
  }
  if (sha256File(archive) !== manifest.driverArchive.sha256) {
    throw new Error("Ryzen AI 1.8 XRT driver archive checksum mismatch");
  }
  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p-ryzen-ai-xrt-"));
  try {
    runCommand("unzip", ["-q", archive, "-d", extractionRoot]);
    const packages = manifest.driverPackages.map((name) =>
      findRequiredFile(extractionRoot, name));
    runElevated("apt-get", ["install", "--fix-broken", "-y", ...packages]);
  } finally {
    fs.rmSync(extractionRoot, { force: true, recursive: true });
  }
}

export function resolveRyzenAiArchive(options, manifest) {
  const candidates = [
    options.archivePath,
    path.join(
      options.agentDirectory ?? path.join(os.homedir(), ".p", "agent"),
      "downloads",
      manifest.archiveName,
    ),
    path.join(os.homedir(), "Downloads", manifest.archiveName),
  ].filter(Boolean);
  const archivePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (archivePath) return archivePath;
  throw new Error(
    `Ryzen AI 1.8 requires AMD's EULA-gated ${manifest.archiveName}. `
      + `Download it from ${manifest.archiveDownloadPage}; the installer will discover it in ~/Downloads.`,
  );
}

function findRequiredFile(root, filename) {
  const match = findFile(root, filename);
  if (!match) throw new Error(`Ryzen AI 1.8 package is missing required file: ${filename}`);
  return match;
}

function findFile(root, filename) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === filename) return candidate;
    if (entry.isDirectory()) {
      const nested = findFile(candidate, filename);
      if (nested) return nested;
    }
  }
  return undefined;
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
