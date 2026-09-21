import { Minimatch } from "minimatch";
import { matchesAnyExactPattern, matchesAnyPattern, normalizeExactPattern } from "./binary-resolution.ts";
import { toPosixPath } from "./version-resolution.ts";

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

  // ⚡ Bolt: Combine multiple filter passes and intermediate array allocations into a single explicit loop
  const result = new Set<string>();

  for (const filePath of allPaths) {
    let isIncluded = false;

    // Step 1: Apply includes (or all if no includes)
    if (includes.length === 0) {
      isIncluded = true;
    } else {
      isIncluded = matchesAnyPattern(filePath, compiledIncludes, baseDir);
    }

    // Step 2: Apply excludes
    if (isIncluded && excludes.length > 0) {
      if (matchesAnyPattern(filePath, compiledExcludes, baseDir)) {
        isIncluded = false;
      }
    }

    // Step 3: Force-include (overriding exclusions)
    if (!isIncluded && forceIncludesSet.size > 0) {
      if (matchesAnyExactPattern(filePath, forceIncludesSet, baseDir)) {
        isIncluded = true;
      }
    }

    // Step 4: Force-exclude (remove even if included or force-included)
    if (isIncluded && forceExcludesSet.size > 0) {
      if (matchesAnyExactPattern(filePath, forceExcludesSet, baseDir)) {
        isIncluded = false;
      }
    }

    if (isIncluded) {
      result.add(filePath);
    }
  }

  return result;
}
