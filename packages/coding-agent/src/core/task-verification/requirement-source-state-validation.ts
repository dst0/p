export function sourceIdentitiesAreUnique(referencesValue: unknown, ignoredSourcesValue: unknown): boolean {
  if (!Array.isArray(referencesValue) || !Array.isArray(ignoredSourcesValue)) return false;
  const references: readonly unknown[] = referencesValue;
  const ignoredSources: readonly unknown[] = ignoredSourcesValue;
  const ids = new Set<string>();
  const paths = new Set<string>();
  const snapshotEntryIds = new Set<string>();
  for (const reference of references) {
    const id = stringProperty(reference, "id");
    const path = stringProperty(reference, "path");
    const snapshotEntryId = stringProperty(reference, "snapshotEntryId");
    if (!id || !path || !snapshotEntryId || ids.has(id) || paths.has(path) || snapshotEntryIds.has(snapshotEntryId)) {
      return false;
    }
    ids.add(id);
    paths.add(path);
    snapshotEntryIds.add(snapshotEntryId);
  }
  const ignoredPaths = new Set<string>();
  for (const ignored of ignoredSources) {
    if (!ignoredRequirementSourceIsValid(ignored)) return false;
    const path = stringProperty(ignored, "path");
    if (!path || paths.has(path) || ignoredPaths.has(path)) return false;
    ignoredPaths.add(path);
  }
  return true;
}

export function ignoredRequirementSourceIsValid(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    Boolean(stringProperty(source, "path")) &&
    Boolean(stringProperty(source, "reason")) &&
    (source.deauthorizedByPromptId === undefined || Boolean(stringProperty(source, "deauthorizedByPromptId")))
  );
}

function stringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[property];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}
