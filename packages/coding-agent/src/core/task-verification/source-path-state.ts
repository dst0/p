import { isCheckedSourcePath } from "./source-file-classification.ts";

export const MAX_MUTATED_SOURCE_PATHS = 64;

export function isMutatedSourcePaths(value: unknown): value is string[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_MUTATED_SOURCE_PATHS || new Set(value).size !== value.length) {
    return false;
  }
  return value.every(
    (filePath) =>
      typeof filePath === "string" &&
      filePath.length > 0 &&
      filePath.length <= 500 &&
      !filePath.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/u.test(filePath) &&
      !filePath.includes("\\") &&
      !/[\u0000-\u001f\u007f]/u.test(filePath) &&
      !filePath.split("/").includes("..") &&
      !filePath.startsWith("./") &&
      isCheckedSourcePath(filePath),
  );
}

export function updatedMutatedSourcePaths(
  current: readonly string[],
  candidates: readonly string[],
  failedOrOverflowed: boolean,
): { paths: string[]; overflow: boolean } {
  const paths = [...new Set([...current, ...candidates.filter(isCheckedSourcePath)])];
  return {
    paths: paths.slice(0, MAX_MUTATED_SOURCE_PATHS),
    overflow: failedOrOverflowed || paths.length > MAX_MUTATED_SOURCE_PATHS,
  };
}
