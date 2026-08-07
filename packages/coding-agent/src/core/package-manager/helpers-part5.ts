import { Minimatch } from "minimatch";
import { toPosixPath } from "./helpers-part1.ts";
import { matchesAnyExactPattern, matchesAnyPattern, normalizeExactPattern } from "./helpers-part4.ts";

export function applyPatterns(allPaths: string[], patterns: string[], baseDir: string): Set<string> {
  const includes: string[] = [];
  const excludes: string[] = [];
  const forceIncludes: string[] = [];
  const forceExcludes: string[] = [];

  for (const p of patterns) {
    if (p.startsWith("+")) {
      forceIncludes.push(p.slice(1));
    } else if (p.startsWith("-")) {
      forceExcludes.push(p.slice(1));
    } else if (p.startsWith("!")) {
      excludes.push(p.slice(1));
    } else {
      includes.push(p);
    }
  }

  // ⚡ Bolt: Pre-compile Minimatch instances outside of tight per-file loops
  const compiledIncludes = includes.map((pattern) => new Minimatch(toPosixPath(pattern)));
  const compiledExcludes = excludes.map((pattern) => new Minimatch(toPosixPath(pattern)));

  const forceIncludesSet = new Set(forceIncludes.map(normalizeExactPattern));
  const forceExcludesSet = new Set(forceExcludes.map(normalizeExactPattern));

  // Step 1: Apply includes (or all if no includes)
  let result: string[];
  if (includes.length === 0) {
    result = [...allPaths];
  } else {
    result = allPaths.filter((filePath) => matchesAnyPattern(filePath, compiledIncludes, baseDir));
  }

  // Step 2: Apply excludes
  if (excludes.length > 0) {
    result = result.filter((filePath) => !matchesAnyPattern(filePath, compiledExcludes, baseDir));
  }

  // Step 3: Force-include (add back from allPaths, overriding exclusions)
  if (forceIncludesSet.size > 0) {
    const resultSet = new Set(result);
    for (const filePath of allPaths) {
      if (!resultSet.has(filePath) && matchesAnyExactPattern(filePath, forceIncludesSet, baseDir)) {
        result.push(filePath);
        resultSet.add(filePath);
      }
    }
  }

  // Step 4: Force-exclude (remove even if included or force-included)
  if (forceExcludesSet.size > 0) {
    result = result.filter((filePath) => !matchesAnyExactPattern(filePath, forceExcludesSet, baseDir));
  }

  return new Set(result);
}
