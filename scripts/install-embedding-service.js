#!/usr/bin/env node
// Embedding server service manager — installs or updates a system service
// that keeps the local embedding server running (macOS launchd / Linux systemd).
//
// Usage: node scripts/install-embedding-service.js

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PKG_DIR = path.join(ROOT, "packages", "code-index");
const SCRIPT = path.join(PKG_DIR, "embedding_server.py");
const PLIST_SRC = path.join(PKG_DIR, "com.dst.p.code-index-embedding.plist");
const SERVICE_SRC = path.join(PKG_DIR, "com.dst.p.code-index-embedding.service");

const PLATFORM = process.platform;
const SERVICE_LABEL = "com.dst.p.code-index-embedding";

function log(msg) {
  console.log(msg);
}

function exec(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: "inherit", ...opts }).toString();
  } catch {
    // inherit already showed output; ignore
  }
  return "";
}

// ── macOS (launchd) ─────────────────────────────────────────────

async function installDarwin() {
  const home = os.homedir();
  const launchDir = path.join(home, "Library", "LaunchAgents");
  const plistDst = path.join(launchDir, `${SERVICE_LABEL}.plist`);

  if (!fs.existsSync(launchDir)) {
    fs.mkdirSync(launchDir, { recursive: true });
  }

  // Generate plist with resolved paths
  const src = fs.readFileSync(PLIST_SRC, "utf-8");
  const resolved = src.replace(/SCRIPT_PATH_PLACEHOLDER/g, PKG_DIR);
  fs.writeFileSync(plistDst, resolved);

  // Check if already loaded
  const loaded = isLoadedDarwin(plistDst);
  if (loaded) {
    log("=== Updating embedding server service (launchd) ===");
    exec(`launchctl bootout gui/$(id -u) "${plistDst}"`);
    // Small pause to ensure port is freed
    await sleep(500);
  } else {
    log("=== Installing embedding server service (launchd) ===");
  }

  exec(`launchctl bootstrap gui/$(id -u) "${plistDst}"`);
  log(`Embedding server service installed (${SERVICE_LABEL})`);
}

function isLoadedDarwin(plistPath) {
  try {
    const out = execSync(`launchctl list ${SERVICE_LABEL} 2>/dev/null`).toString();
    return out.includes(SERVICE_LABEL);
  } catch {
    return false;
  }
}

// ── Linux (systemd) ─────────────────────────────────────────────

async function installLinux() {
  const user = process.env.USER || execSync("whoami").toString().trim();
  const serviceDst = path.join(os.homedir(), ".config", "systemd", "user", `${SERVICE_LABEL}.service`);

  const svcDir = path.dirname(serviceDst);
  if (!fs.existsSync(svcDir)) {
    fs.mkdirSync(svcDir, { recursive: true });
  }

  // Generate service file with resolved paths
  const src = fs.readFileSync(SERVICE_SRC, "utf-8");
  const resolved = src
    .replace(/SCRIPT_PATH_PLACEHOLDER/g, SCRIPT)
    .replace(/PKG_DIR_PLACEHOLDER/g, PKG_DIR)
    .replace(/USER_PLACEHOLDER/g, user);
  fs.writeFileSync(serviceDst, resolved);

  // Reload systemd to pick up changes
  log("=== Reloading systemd user daemon ===");
  exec("systemctl --user daemon-reload");

  // Check if already active
  const active = isLoadedLinux();
  if (active) {
    log("=== Updating embedding server service (systemd) ===");
    exec("systemctl --user restart " + SERVICE_LABEL);
  } else {
    log("=== Installing embedding server service (systemd) ===");
    exec("systemctl --user enable " + SERVICE_LABEL);
    exec("systemctl --user start " + SERVICE_LABEL);
  }

  log(`Embedding server service installed (${SERVICE_LABEL})`);
}

function isLoadedLinux() {
  try {
    execSync(`systemctl --user is-active ${SERVICE_LABEL} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (PLATFORM === "darwin") {
    await installDarwin();
  } else if (PLATFORM === "linux") {
    await installLinux();
  } else {
    log(`Skipping embedding server service install: ${PLATFORM} not supported (darwin/linux)`);
  }
}

main().catch((err) => {
  console.error("Failed to install embedding server service:", err);
  process.exit(1);
});
