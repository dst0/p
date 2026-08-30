export function requirementSourceRefsAreValid(value: unknown, maximumPromptCount: number): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((reference) => {
    if (typeof reference !== "object" || reference === null || Array.isArray(reference)) return false;
    const source = reference as Record<string, unknown>;
    return (
      Boolean(stringProperty(source, "id")) &&
      Boolean(stringProperty(source, "path")) &&
      Boolean(stringProperty(source, "sha256")) &&
      isNonnegativeInteger(source.byteLength) &&
      Boolean(stringProperty(source, "snapshotEntryId")) &&
      Array.isArray(source.referencedByPromptIds) &&
      source.referencedByPromptIds.length > 0 &&
      source.referencedByPromptIds.every((id) => typeof id === "string") &&
      isNonnegativeInteger(source.definitionSourcePromptCount) &&
      Number(source.definitionSourcePromptCount) > 0 &&
      Number(source.definitionSourcePromptCount) <= maximumPromptCount &&
      isNonnegativeInteger(source.capturedAtMutationRevision) &&
      source.origin === "requirement_audit.prepare_definition" &&
      source.policyVersion === 1
    );
  });
}

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

function isNonnegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
