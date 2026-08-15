#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG_FILE = "code-rag.json";
const BOOLEAN_FIELDS = new Set(["enableTray"]);
const NUMERIC_FIELDS = new Set([
  "maxEmbeddingBatchSize",
  "maxCpuThreads",
  "maxSequenceLength",
  "minSystemMemoryReserveBytes",
  "minAcceleratorMemoryReserveBytes",
  "embeddingModelParameterCount",
]);

export function readCodeRagConfig(agentDirectory) {
  const configPath = path.join(agentDirectory, CONFIG_FILE);
  if (!fs.existsSync(configPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid code indexing config at ${configPath}: expected a JSON object`);
  }
  return parsed;
}

export function writeCodeRagConfig(agentDirectory, updates) {
  const configPath = path.join(agentDirectory, CONFIG_FILE);
  const config = { ...readCodeRagConfig(agentDirectory) };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete config[key];
    else config[key] = value;
  }
  fs.mkdirSync(agentDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, configPath);
  return config;
}

export function migrateLegacyIndexingConfig(agentDirectory) {
  const config = readCodeRagConfig(agentDirectory);
  const updates = {};
  const devicePaths = [
    path.join(agentDirectory, "indexing-device.txt"),
    path.join(agentDirectory, "indexing-device"),
  ];
  const batchPath = path.join(agentDirectory, "indexing-max-batch-size");
  if (config.embeddingDevice === undefined) {
    const device = devicePaths.map(readLegacyValue).find((value) => value !== undefined);
    if (device) updates.embeddingDevice = device;
  }
  if (config.maxEmbeddingBatchSize === undefined) {
    const rawBatchSize = readLegacyValue(batchPath);
    const batchSize = rawBatchSize === undefined ? undefined : Number(rawBatchSize);
    if (Number.isSafeInteger(batchSize) && batchSize > 0) updates.maxEmbeddingBatchSize = batchSize;
  }
  if (Object.keys(updates).length > 0) writeCodeRagConfig(agentDirectory, updates);
  for (const devicePath of devicePaths) fs.rmSync(devicePath, { force: true });
  fs.rmSync(batchPath, { force: true });
  return { ...config, ...updates };
}

function readLegacyValue(filePath) {
  try {
    const value = fs.readFileSync(filePath, "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function parseCliValue(field, rawValue) {
  if (BOOLEAN_FIELDS.has(field)) {
    if (rawValue === "true" || rawValue === "1") return true;
    if (rawValue === "false" || rawValue === "0") return false;
    throw new Error(`${field} must be a boolean (true or false)`);
  }
  if (!NUMERIC_FIELDS.has(field)) return rawValue;
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function runCli() {
  const [operation, agentDirectory, field, rawValue] = process.argv.slice(2);
  if (!operation || !agentDirectory) {
    throw new Error("Usage: indexing-config.js <get|set|migrate> <agent-directory> [field] [value]");
  }
  if (operation === "migrate") {
    migrateLegacyIndexingConfig(agentDirectory);
    return;
  }
  if (!field) {
    throw new Error("Usage: indexing-config.js <get|set|migrate> <agent-directory> [field] [value]");
  }
  if (operation === "get") {
    const value = readCodeRagConfig(agentDirectory)[field];
    if (value !== undefined) process.stdout.write(String(value));
    return;
  }
  if (operation === "set" && rawValue !== undefined) {
    writeCodeRagConfig(agentDirectory, { [field]: parseCliValue(field, rawValue) });
    return;
  }
  throw new Error("Usage: indexing-config.js <get|set|migrate> <agent-directory> [field] [value]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
