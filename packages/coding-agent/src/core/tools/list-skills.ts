import { Buffer } from "node:buffer";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { hashText } from "../project-instructions/content.ts";
import { ProjectInstructionReadError } from "../project-instructions/read-error.ts";
import { requireFreshPreparedState } from "../project-instructions/reader.ts";
import type { ProjectInstructionSkillRecord, ProjectInstructionState } from "../project-instructions/types.ts";

const LIST_SKILLS_PAGE_SIZE = 10;
const LIST_SKILLS_QUERY_MAX_CHARS = 256;
const LIST_SKILLS_CURSOR_MAX_CHARS = 256;
const LIST_SKILLS_RESULT_MAX_BYTES = 32_768;
const LISTED_SKILL_NAME_MAX_CHARS = 120;
const LISTED_SKILL_DESCRIPTION_MAX_CHARS = 500;
const CURSOR_PATTERN = /^v1\.[a-f0-9]{64}$/u;
const FILE_URI_PATTERN = /\bfile:[^\s)\]}>;,"'`]*/giu;
const ABSOLUTE_PATH_PATTERN = /(^|[\s=[({<"'`])(?:\/{1,2}|[A-Za-z]:[\\/]|\\\\)[^\s)\]}>;,"'`]*/gu;
const cursorSecrets = new WeakMap<ProjectInstructionState, Buffer>();

const listSkillsSchema = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        maxLength: LIST_SKILLS_QUERY_MAX_CHARS,
        description: "Optional task, skill name, or capability query. Empty or omitted browses all skills.",
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        maxLength: LIST_SKILLS_CURSOR_MAX_CHARS,
        description: "Opaque next cursor returned by an earlier list_skills call with the same query",
      }),
    ),
  },
  { additionalProperties: false },
);

export type ListSkillsToolInput = Static<typeof listSkillsSchema>;

export interface ListedSkillDetails {
  name: string;
  description: string;
  link: string;
}

export interface ListSkillsToolDetails {
  skills: ListedSkillDetails[];
  nextCursor?: string;
}

interface RankedSkill {
  skill: ListedSkillDetails;
  score: number;
}

export function createListSkillsToolDefinition(
  state: ProjectInstructionState,
): ToolDefinition<typeof listSkillsSchema, ListSkillsToolDetails> {
  const cursorSecret = getCursorSecret(state);
  return {
    name: "list_skills",
    label: "list_skills",
    description:
      "Discover cataloged skills by name or task description in deterministic bounded pages. Returns only virtual links accepted by read_skills, never physical paths or skill contents.",
    promptSnippet: "Discover matching skills, then load selected virtual links with read_skills",
    parameters: listSkillsSchema,
    async execute(_toolCallId, input: ListSkillsToolInput) {
      const details = listSkills(state, input, cursorSecret);
      const text = JSON.stringify(details);
      if (Buffer.byteLength(text, "utf8") > LIST_SKILLS_RESULT_MAX_BYTES) {
        throw new ProjectInstructionReadError("Skill listing exceeds the bounded result limit");
      }
      return {
        content: [{ type: "text", text }],
        details,
      };
    },
  };
}

function listSkills(
  state: ProjectInstructionState,
  input: ListSkillsToolInput,
  cursorSecret: Buffer,
): ListSkillsToolDetails {
  if (input.query !== undefined && input.query.length > LIST_SKILLS_QUERY_MAX_CHARS) {
    throw new ProjectInstructionReadError("Skill query exceeds the character limit");
  }
  if (input.cursor !== undefined && input.cursor.length > LIST_SKILLS_CURSOR_MAX_CHARS) {
    throw new ProjectInstructionReadError("Skill listing cursor exceeds the character limit");
  }
  const prepared = requireFreshPreparedState(state);
  const query = normalizeQuery(input.query ?? "");
  const ranked = rankSkills(prepared.manifest.skills, query);
  const offset = input.cursor
    ? parseCursor(input.cursor, cursorSecret, prepared.manifest.inputHash, hashText(query), ranked.length)
    : 0;
  const skills = ranked.slice(offset, offset + LIST_SKILLS_PAGE_SIZE).map(({ skill }) => skill);
  const nextOffset = offset + skills.length;
  const nextCursor =
    nextOffset < ranked.length
      ? createCursor(cursorSecret, prepared.manifest.inputHash, hashText(query), nextOffset)
      : undefined;
  return nextCursor ? { skills, nextCursor } : { skills };
}

function rankSkills(skills: ProjectInstructionSkillRecord[], query: string): RankedSkill[] {
  const queryTerms = tokenize(query);
  const listed = skills.map(toListedSkill);
  const exactNameMatches = query ? listed.filter((skill) => normalizeQuery(skill.name) === query) : [];
  if (exactNameMatches.length > 0) {
    return exactNameMatches
      .map((skill) => ({ skill, score: 1_000 }))
      .sort((left, right) => left.skill.link.localeCompare(right.skill.link));
  }
  return listed
    .map((skill) => ({ skill, score: query ? scoreSkill(skill, query, queryTerms) : 0 }))
    .filter(({ score }) => !query || score > 0)
    .sort((left, right) => right.score - left.score || left.skill.link.localeCompare(right.skill.link));
}

function toListedSkill(skill: ProjectInstructionSkillRecord): ListedSkillDetails {
  return {
    name: boundedSingleLine(skill.name, LISTED_SKILL_NAME_MAX_CHARS),
    description: boundedSingleLine(skill.description, LISTED_SKILL_DESCRIPTION_MAX_CHARS),
    link: skill.link,
  };
}

function scoreSkill(skill: ListedSkillDetails, query: string, terms: string[]): number {
  const name = normalizeQuery(skill.name);
  const description = normalizeQuery(skill.description);
  let score = name === query ? 1_000 : 0;
  if (name.includes(query)) score += 100;
  if (description.includes(query)) score += 50;
  for (const term of terms) {
    if (name.includes(term)) score += 10;
    if (description.includes(term)) score += 2;
  }
  return score;
}

function normalizeQuery(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function tokenize(value: string): string[] {
  return [...new Set(value.match(/[\p{L}\p{N}]+/gu) ?? [])];
}

function boundedSingleLine(value: string, maxChars: number): string {
  const normalized = value
    .replace(FILE_URI_PATTERN, "[redacted-path]")
    .replace(ABSOLUTE_PATH_PATTERN, "$1[redacted-path]")
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(normalized).slice(0, maxChars).join("");
}

function getCursorSecret(state: ProjectInstructionState): Buffer {
  const existing = cursorSecrets.get(state);
  if (existing) return existing;
  const created = randomBytes(32);
  cursorSecrets.set(state, created);
  return created;
}

function createCursor(secret: Buffer, inputHash: string, queryHash: string, offset: number): string {
  const digest = createHmac("sha256", secret)
    .update(JSON.stringify({ domain: "list-skills-cursor-v1", inputHash, queryHash, offset }))
    .digest("hex");
  return `v1.${digest}`;
}

function parseCursor(
  cursor: string,
  secret: Buffer,
  inputHash: string,
  queryHash: string,
  resultCount: number,
): number {
  if (!CURSOR_PATTERN.test(cursor)) throw new ProjectInstructionReadError("Invalid skill listing cursor");
  for (let offset = LIST_SKILLS_PAGE_SIZE; offset < resultCount; offset += LIST_SKILLS_PAGE_SIZE) {
    const expected = createCursor(secret, inputHash, queryHash, offset);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(cursor))) return offset;
  }
  throw new ProjectInstructionReadError("Skill listing cursor does not match the current catalog and query");
}
