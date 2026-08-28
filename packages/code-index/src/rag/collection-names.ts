export function normalizeQdrantCollectionPrefix(prefix: string): string {
  return prefix.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
}

export function createQdrantCollectionName(prefix: string, repoId: string, generation: string): string {
  const safeGeneration = generation.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${normalizeQdrantCollectionPrefix(prefix)}_${repoId.slice(0, 16)}_${safeGeneration}`;
}

export function getQdrantCollectionCreatedAt(collection: string, configuredPrefix: string): number | undefined {
  const namespace = `${normalizeQdrantCollectionPrefix(configuredPrefix)}_`;
  if (!collection.startsWith(namespace)) return undefined;
  const match = /^([a-f0-9]{16})_([a-z0-9]+)-([a-f0-9]{8})$/.exec(collection.slice(namespace.length));
  if (!match) return undefined;
  const timestamp = Number.parseInt(match[2], 36);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : undefined;
}
