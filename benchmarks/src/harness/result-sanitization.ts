interface BenchmarkEvidencePaths {
  output: string;
  repoRoot: string;
  home: string;
}

function replacePaths(value: string, replacements: readonly (readonly [string, string])[]): string {
  let sanitized = value;
  for (const [path, placeholder] of replacements) {
    if (path) sanitized = sanitized.replaceAll(path, placeholder);
  }
  return sanitized;
}

export function sanitizeBenchmarkEvidence(value: unknown, paths: BenchmarkEvidencePaths): unknown {
  const replacements: ReadonlyArray<readonly [string, string]> = [
    [paths.output, "."],
    [paths.repoRoot, "<repo>"],
    [paths.home, "~"],
  ];
  if (typeof value === "string") return replacePaths(value, replacements);
  if (Array.isArray(value)) return value.map((entry) => sanitizeBenchmarkEvidence(entry, paths));
  if (!value || typeof value !== "object") return value;
  const entries: Array<[string, unknown]> = [];
  const keys = new Set();
  for (const [key, entry] of Object.entries(value)) {
    const sanitizedKey = replacePaths(key, replacements);
    if (keys.has(sanitizedKey)) {
      throw new Error("Benchmark evidence path sanitization produced a duplicate object key");
    }
    keys.add(sanitizedKey);
    entries.push([sanitizedKey, sanitizeBenchmarkEvidence(entry, paths)]);
  }
  return Object.fromEntries(entries);
}
