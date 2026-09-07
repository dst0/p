import { join, resolve } from "node:path";

import { replacePrivateBrotliText } from "./private-brotli.ts";

const SAFE_STEM = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function writeBenchmarkStderrLog(directory: string, stem: string, text: unknown): string {
  if (typeof text !== "string") throw new Error("Benchmark stderr log text must be a string");
  const fileName = benchmarkStderrLogName(stem);
  const outputDirectory = resolve(directory);
  const finalPath = join(outputDirectory, fileName);
  replacePrivateBrotliText(finalPath, text);
  return fileName;
}

export function benchmarkStderrLogName(stem: unknown): string {
  if (typeof stem !== "string" || !SAFE_STEM.test(stem)) {
    throw new Error("Benchmark stderr log requires a safe file stem");
  }
  return `${stem}.log.br`;
}
