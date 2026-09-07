import type { TaskVerificationSourcePrompt } from "./types.ts";

const FILE_TOKEN = String.raw`[^\s,;]+[.][\p{L}\p{N}]+`;
const FINISH_WORKFLOW = String.raw`(?:finish|complete)(?:\s+(?:all|the|this))?\s+(?:(?:through|via|using)\s+)?(?:the\s+)?(?:requirement[- ]verification\s+controller|verification|workflow)`;
const DELEGATION_PATTERN = new RegExp(
  String.raw`^(?:(?:please|kindly)\s+)?(?:(?:read|review|inspect)(?:\s+<source>)?\s+(?:and|then)\s+)?(?:apply|complete|follow|implement|satisfy)\s+(?:all(?:\s+of(?:\s+the)?)?|every|the)\s+(?:listed\s+)?requirements?\s+(?:from|in)\s+<source>(?:\s+(?:in|into|within)\s+${FILE_TOKEN})?(?:\s*,?\s+(?:and|then)\s+${FINISH_WORKFLOW})?$`,
  "iu",
);
const DESCRIBED_SOURCE_PATTERN = new RegExp(
  String.raw`^(?:(?:please|kindly)\s+)?(?:apply|complete|follow|implement|satisfy)\s+(?:the\s+)?[\p{L}\p{N}_ -]+?\s+(?:described\s+in|specified\s+by)\s+<source>(?:\s*,?\s+(?:and|then)\s+${FINISH_WORKFLOW})?$`,
  "iu",
);
const TEST_WORKFLOW_PATTERN = new RegExp(
  String.raw`^(?:use\s+(?:${FILE_TOKEN}|(?:the\s+)?(?:(?:focused|relevant)\s+)*tests?)\s+(?:for|as)\s+(?:(?:focused|executable)\s+)*(?:evidence|verification)|run\s+(?:the\s+)?(?:(?:focused|relevant)\s+)*tests?(?:\s+(?:for|as)\s+(?:evidence|verification))?)(?:\s+(?:and|then)\s+${FINISH_WORKFLOW})?$`,
  "iu",
);
const FINISH_WORKFLOW_PATTERN = new RegExp(`^${FINISH_WORKFLOW}$`, "iu");

export function pureDelegationPromptIndexes(prompts: readonly TaskVerificationSourcePrompt[]): ReadonlySet<number> {
  const pathAliases = preparedPathAliases(prompts);
  return new Set(
    prompts.flatMap((prompt, index) => {
      if (prompt.kind === "referenced_file") return [];
      const text = replacePreparedPathMentions(prompt.text, pathAliases);
      if (!text) return [];
      const clauses = text
        .split(/[!?;\n]+|[.](?=\s|$)/u)
        .map((clause) => clause.trim())
        .filter(Boolean);
      return clauses.length > 0 && clauses.every(isDelegationOrWorkflowClause) ? [index + 1] : [];
    }),
  );
}

export function unclassifiedDirectPromptGuidance(
  promptIndexes: readonly number[],
  pureDelegationIndexes: ReadonlySet<number>,
): string {
  const pureIndexes = promptIndexes.filter((index) => pureDelegationIndexes.has(index));
  const productIndexes = promptIndexes.filter((index) => !pureDelegationIndexes.has(index));
  return [
    pureIndexes.length > 0
      ? ` Pure delegation/workflow prompt indexes ${pureIndexes.join(", ")} must be classified through ignored_source_prompts (ignored_source_prompt_upserts during repair) and must not be mapped as independent product requirements.`
      : "",
    productIndexes.length > 0
      ? ` For direct prompt indexes ${productIndexes.join(", ")}, map an independent product requirement or explicitly ignore non-product context.`
      : "",
    promptIndexes.length > 0 ? " Do not add referenced-file indexes to source_prompt_indexes." : "",
  ].join("");
}

function preparedPathAliases(prompts: readonly TaskVerificationSourcePrompt[]): string[] {
  const paths = prompts.flatMap((prompt) =>
    prompt.kind === "referenced_file" && prompt.path && prompt.text.trim() ? [normalizePath(prompt.path)] : [],
  );
  const basenameCounts = new Map<string, number>();
  for (const path of paths) {
    const basename = pathBasename(path);
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }
  return [
    ...new Set(
      paths.flatMap((path) => [path, ...(basenameCounts.get(pathBasename(path)) === 1 ? [pathBasename(path)] : [])]),
    ),
  ].sort((left, right) => right.length - left.length);
}

function replacePreparedPathMentions(text: string, aliases: readonly string[]): string | undefined {
  if (aliases.length === 0) return undefined;
  let matched = false;
  const matcher = new RegExp(
    String.raw`(^|[^\p{L}\p{N}_./-])(?:${aliases.map(escapeRegExp).join("|")})(?=$|[^\p{L}\p{N}_./-]|[.](?=\s|$))`,
    "giu",
  );
  const replaced = normalizePath(text).replace(matcher, (_match, prefix: string) => {
    matched = true;
    return `${prefix}<source>`;
  });
  return matched ? replaced.replace(/[`'"]?<source>[`'"]?/gu, "<source>") : undefined;
}

function normalizePath(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function pathBasename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isDelegationOrWorkflowClause(clause: string): boolean {
  return (
    DELEGATION_PATTERN.test(clause) ||
    DESCRIBED_SOURCE_PATTERN.test(clause) ||
    TEST_WORKFLOW_PATTERN.test(clause) ||
    FINISH_WORKFLOW_PATTERN.test(clause)
  );
}
