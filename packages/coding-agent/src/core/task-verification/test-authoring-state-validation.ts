import { TEST_PATH_PATTERN } from "./constants.ts";

export const MAX_UNVERIFIED_TEST_PATHS = 3;

export function isUnverifiedTestPaths(value: unknown): value is string[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_UNVERIFIED_TEST_PATHS || new Set(value).size !== value.length) {
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
      TEST_PATH_PATTERN.test(filePath),
  );
}
