import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EphemeralModelsSnapshot {
  path: string;
  present: boolean;
  sha256: string;
  dispose(): void;
}

interface ModelMetadata {
  id?: string;
  contextWindow?: number;
  maxTokens?: number;
}

export function createEphemeralModelsSnapshot(source: string, temporaryParent = tmpdir()): EphemeralModelsSnapshot {
  const root = mkdtempSync(join(temporaryParent, "p-benchmark-models-"));
  chmodSync(root, 0o700);
  const path = join(root, "models.json");
  try {
    const present = existsSync(source);
    if (present) {
      copyFileSync(source, path);
      chmodSync(path, 0o600);
    }
    const sha256 = present ? hashFile(path) : createHash("sha256").update("absent").digest("hex");
    return {
      path,
      present,
      sha256,
      dispose: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function verifyEphemeralModelsSnapshot(snapshot: EphemeralModelsSnapshot): boolean {
  try {
    return snapshot.present ? hashFile(snapshot.path) === snapshot.sha256 : !existsSync(snapshot.path);
  } catch {
    return false;
  }
}

export function assertBenchmarkModelDefined(snapshot: EphemeralModelsSnapshot, requestedModel: string): void {
  if (!verifyEphemeralModelsSnapshot(snapshot) || !snapshot.present) {
    throw new Error("Benchmark model must be explicitly defined in the immutable models snapshot");
  }
  const separator = requestedModel.indexOf("/");
  const providerId = separator > 0 ? requestedModel.slice(0, separator) : "";
  const modelId = separator > 0 ? requestedModel.slice(separator + 1) : "";
  const document = JSON.parse(readFileSync(snapshot.path, "utf8")) as {
    providers?: Record<string, { models?: ModelMetadata[] }>;
  };
  const provider = document?.providers?.[providerId];
  const model = Array.isArray(provider?.models) ? provider.models.find((entry) => entry?.id === modelId) : undefined;
  if (
    !model ||
    typeof model.contextWindow !== "number" ||
    !Number.isFinite(model.contextWindow) ||
    model.contextWindow <= 0 ||
    typeof model.maxTokens !== "number" ||
    !Number.isFinite(model.maxTokens) ||
    model.maxTokens <= 0
  ) {
    throw new Error(`Benchmark model ${requestedModel} must be explicitly defined in the immutable models snapshot`);
  }
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
