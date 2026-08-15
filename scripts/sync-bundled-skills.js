#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

/**
 * Resolve directory containing bundled skills.
 * @returns {string}
 */
export function resolveBundledSkillsDir() {
  const candidate = path.join(repoRoot, "packages", "coding-agent", "skills");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return path.join(repoRoot, "skills");
}

/**
 * Synchronize bundled skills into target agent directory non-destructively.
 * Existing user-modified skills are preserved and never overwritten.
 * @param {string} [targetAgentDir]
 * @param {{ overwrite?: boolean }} [options]
 * @returns {{ synced: string[]; skipped: string[]; targetDir: string }}
 */
export function syncBundledSkills(targetAgentDir, options = {}) {
  const agentDir =
    targetAgentDir ||
    process.env.P_CODING_AGENT_DIR ||
    path.join(os.homedir(), ".p", "agent");
  const targetSkillsDir = path.join(agentDir, "skills");
  const bundledSkillsDir = resolveBundledSkillsDir();

  if (!fs.existsSync(bundledSkillsDir)) {
    return { synced: [], skipped: [], targetDir: targetSkillsDir };
  }

  fs.mkdirSync(targetSkillsDir, { recursive: true });

  const synced = [];
  const skipped = [];
  const entries = fs.readdirSync(bundledSkillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }

    const srcPath = path.join(bundledSkillsDir, entry.name);
    const destPath = path.join(targetSkillsDir, entry.name);

    if (fs.existsSync(destPath) && !options.overwrite) {
      skipped.push(entry.name);
      continue;
    }

    if (entry.isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true, force: true });
      synced.push(entry.name);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      fs.copyFileSync(srcPath, destPath);
      synced.push(entry.name);
    }
  }

  return { synced, skipped, targetDir: targetSkillsDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const target = process.argv[2];
  const { synced, skipped, targetDir } = syncBundledSkills(target);
  if (synced.length > 0) {
    console.log(`Synced bundled skills to ${targetDir}: ${synced.join(", ")}`);
  }
  if (skipped.length > 0) {
    console.log(`Preserved existing user skills in ${targetDir}: ${skipped.join(", ")}`);
  }
}
