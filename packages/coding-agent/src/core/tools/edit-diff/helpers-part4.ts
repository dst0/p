import { constants } from "fs";
import { access, readFile } from "fs/promises";
import { resolveToCwd } from "../path-utils.ts";
import { normalizeToLF, stripBom } from "./helpers-part1.ts";
import { applyEditsToNormalizedContent } from "./helpers-part2.ts";
import { generateDiffString } from "./helpers-part3.ts";
import type { Edit, EditDiffError, EditDiffResult } from "./types.ts";

export async function computeEditsDiff(
  path: string,
  edits: Edit[],
  cwd: string,
): Promise<EditDiffResult | EditDiffError> {
  const absolutePath = resolveToCwd(path, cwd);

  try {
    // Check if file exists and is readable
    try {
      await access(absolutePath, constants.R_OK);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error && "code" in error ? `Error code: ${error.code}` : String(error);
      return { error: `Could not edit file: ${path}. ${errorMessage}.` };
    }

    // Read the file
    const rawContent = await readFile(absolutePath, "utf-8");

    // Strip BOM before matching (LLM won't include invisible BOM in oldText)
    const { text: content } = stripBom(rawContent);
    const normalizedContent = normalizeToLF(content);
    const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path);

    // Generate the diff
    return generateDiffString(baseContent, newContent);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function computeEditDiff(
  path: string,
  oldText: string,
  newText: string,
  cwd: string,
): Promise<EditDiffResult | EditDiffError> {
  return computeEditsDiff(path, [{ oldText, newText }], cwd);
}
