import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

function copyEvidenceTree(source, destination) {
  if (!existsSync(source)) return;
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) copyEvidenceTree(sourcePath, destinationPath);
    else if (entry.isFile()) copyFileSync(sourcePath, destinationPath);
  }
}

function listEvidenceFiles(root, current = root) {
  if (!existsSync(current)) return [];
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...listEvidenceFiles(root, path));
    else if (entry.isFile()) files.push(path.slice(root.length + 1));
  }
  return files.sort();
}

export function listKiloRuntimeStateEvidence(stateRoot) {
  const policyRoot = join(stateRoot, "kilo-sandbox-policy");
  return listEvidenceFiles(policyRoot).map(path => join("kilo-sandbox-policy", path));
}

export function listKiloRuntimeDataEvidence(dataRoot) {
  const logRoot = join(dataRoot, "kilo", "log");
  return listEvidenceFiles(logRoot).map(path => join("kilo", "log", path));
}

export function copyKiloRuntimeEvidence(dataRoot, stateRoot, destination) {
  copyEvidenceTree(join(dataRoot, "kilo", "log"), join(destination, "runtime-logs"));
  copyEvidenceTree(
    join(stateRoot, "kilo-sandbox-policy"),
    join(destination, "runtime-state", "kilo-sandbox-policy"),
  );
}
