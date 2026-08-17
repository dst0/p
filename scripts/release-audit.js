#!/usr/bin/env node

import { execFileSync } from "node:child_process";

import { certifyReleaseAudit, inspectReleaseCertificate } from "./release-audit-certificate.js";
import { reconcileReleaseState } from "./release-transaction.js";

const [command, targetVersion] = process.argv.slice(2);

if (!command || !["audit", "status", "recover"].includes(command) || (command !== "recover" && !targetVersion)) {
  console.error("Usage: node scripts/release-audit.js <audit|status> <x.y.z> | recover");
  process.exit(1);
}

try {
  if (command === "recover") {
    execFileSync("git", ["fetch", "origin", "main", "--tags"], { cwd: process.cwd(), stdio: "inherit" });
    const state = reconcileReleaseState(process.cwd());
    console.log(state ? `Release transaction state: ${state.state}` : "No release transaction exists");
  } else if (command === "audit") {
    execFileSync("git", ["fetch", "origin", "main", "--tags"], { cwd: process.cwd(), stdio: "inherit" });
    const state = certifyReleaseAudit(process.cwd(), targetVersion);
    console.log(`Release changelog audit certified for ${state.baseSha} -> ${targetVersion}`);
    console.log(`Certificate: ${state.certificateId}`);
  } else {
    const result = inspectReleaseCertificate(process.cwd(), targetVersion);
    if (!result.valid) {
      console.error(result.reason);
      process.exit(1);
    }
    console.log(`Release changelog audit certificate is valid: ${result.state.certificateId}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
