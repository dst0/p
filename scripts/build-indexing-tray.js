#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const SWIFT_DIR = path.join(ROOT, "packages", "coding-agent", "src", "tray", "macos");
const OUTPUT_DIR = path.join(ROOT, "packages", "coding-agent", "dist", "bin");
const OUTPUT_BIN = path.join(OUTPUT_DIR, "p-indexing-tray");

export function buildMacOsIndexingTray(destinationPath = OUTPUT_BIN) {
  if (process.platform !== "darwin") {
    return { success: false, reason: "unsupported-platform" };
  }
  if (!fs.existsSync(SWIFT_DIR)) {
    throw new Error(`Swift tray source directory not found: ${SWIFT_DIR}`);
  }
  const swiftFiles = fs.readdirSync(SWIFT_DIR).filter((name) => name.endsWith(".swift")).map((name) => path.join(SWIFT_DIR, name)).sort();
  if (swiftFiles.length === 0) {
    throw new Error(`No Swift sources found in ${SWIFT_DIR}`);
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o755 });

  const swiftc = "/usr/bin/swiftc";
  if (!fs.existsSync(swiftc)) {
    return { success: false, reason: "swiftc-missing" };
  }

  const result = spawnSync(swiftc, ["-O", ...swiftFiles, "-o", destinationPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`Failed to compile macOS indexing tray app: ${result.stderr?.trim() ?? "unknown error"}`);
  }

  fs.chmodSync(destinationPath, 0o755);
  return { success: true, binaryPath: destinationPath };
}

export function installIndexingTray(agentDir, codeIndexDir, binDir, serviceRoot) {
  if (process.platform === "darwin") {
    try {
      buildMacOsIndexingTray(path.join(binDir, "p-indexing-tray"));
    } catch (error) {
      console.warn(`Note: Could not build macOS indexing tray app: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (process.platform === "linux") {
    const traySrc = path.join(codeIndexDir, "indexing_tray.py");
    if (fs.existsSync(traySrc)) {
      fs.copyFileSync(traySrc, path.join(serviceRoot, "indexing_tray.py"));
      fs.chmodSync(path.join(serviceRoot, "indexing_tray.py"), 0o755);
    }
  }
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  try {
    const target = process.argv[2] || OUTPUT_BIN;
    const res = buildMacOsIndexingTray(target);
    if (res.success) {
      console.log(`Built macOS indexing tray binary: ${res.binaryPath}`);
    } else {
      console.log(`Skipped macOS indexing tray build: ${res.reason}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
