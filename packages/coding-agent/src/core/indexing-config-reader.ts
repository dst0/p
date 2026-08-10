import fs from "node:fs";
import path from "node:path";

export interface IndexingSelectionConfiguration {
  device?: string;
  maxBatchSize?: number;
}

export function readIndexingSelectionConfiguration(agentDir: string): IndexingSelectionConfiguration {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(agentDir, "code-rag.json"), "utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const config = value as Record<string, unknown>;
    const device = typeof config.embeddingDevice === "string" ? config.embeddingDevice.trim() : "";
    const batchSize = config.maxEmbeddingBatchSize;
    return {
      ...(device ? { device } : {}),
      ...(Number.isSafeInteger(batchSize) && Number(batchSize) > 0 ? { maxBatchSize: Number(batchSize) } : {}),
    };
  } catch {
    return {};
  }
}
