import { extname } from "node:path";
import { CHECKED_SOURCE_EXTENSIONS, EXCLUDED_DIRS } from "./constants.ts";

export function isCheckedSourcePath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED_DIRS.has(part))) return false;

  const entry = parts.at(-1) ?? "";
  if (!CHECKED_SOURCE_EXTENSIONS.has(extname(entry).toLowerCase())) return false;
  return !(
    entry.endsWith(".test.ts") ||
    entry.endsWith(".test.js") ||
    entry.endsWith(".test.tsx") ||
    entry.endsWith(".test.jsx") ||
    entry.endsWith(".spec.ts") ||
    entry.endsWith(".spec.js") ||
    entry.endsWith("_test.go") ||
    entry.startsWith("test_") ||
    entry.endsWith(".generated.ts") ||
    entry.endsWith(".d.ts")
  );
}

export function physicalLineCount(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}
