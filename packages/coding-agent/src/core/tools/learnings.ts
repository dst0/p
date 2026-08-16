import type { AgentTool } from "@dst0/p-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { LearningsStore } from "../learnings/learnings-store.ts";
import type { LearningEntry, LearningMatch } from "../learnings/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export const recordLearningSchema = Type.Object({
  trap: Type.String({ description: "What failed, anti-pattern, or pitfall encountered", minLength: 1 }),
  fix: Type.String({ description: "How to fix or work around the issue", minLength: 1 }),
  rule: Type.String({ description: "Actionable rule or guideline to avoid this trap in future tasks", minLength: 1 }),
  tags: Type.Optional(Type.Array(Type.String({ description: "Domain or technology tags (e.g. ['vitest', 'git'])" }))),
  scope: Type.Optional(
    Type.Union([Type.Literal("project"), Type.Literal("global")], {
      description:
        "Scope ('project' saves to .agents/learnings.jsonl, 'global' saves to ~/.p/learnings.jsonl; default 'project')",
    }),
  ),
});

export type RecordLearningToolInput = Static<typeof recordLearningSchema>;

export interface RecordLearningToolDetails {
  entry?: LearningEntry;
}

export function createRecordLearningToolDefinition(
  cwd: string,
  customStore?: LearningsStore,
): ToolDefinition<typeof recordLearningSchema, RecordLearningToolDetails> {
  const store = customStore ?? new LearningsStore({ cwd });
  return {
    name: "record_learning",
    label: "record_learning",
    description:
      "Persist an actionable learning, pitfall, or solution into continuous learning memory (.agents/learnings.jsonl). Use when solving a tricky bug, unexpected behavior, or specific repo requirement.",
    promptSnippet: "Record a trap/pitfall and actionable fix/rule for continuous learning",
    promptGuidelines: [
      "When encountering a tricky pitfall, environment requirement, or non-obvious solution, record it with record_learning to benefit future turns and sessions.",
    ],
    parameters: recordLearningSchema,
    async execute(_toolCallId, input: RecordLearningToolInput) {
      const scope = input.scope ?? "project";
      const entry = store.record(
        {
          trap: input.trap,
          fix: input.fix,
          rule: input.rule,
          tags: input.tags ?? [],
          cwd,
        },
        scope,
      );

      const text = [
        "Recorded learning for continuous learning memory:",
        `- Rule: ${entry.rule}`,
        `- Trap: ${entry.trap}`,
        `- Fix: ${entry.fix}`,
        `- Tags: ${(entry.tags ?? []).join(", ") || "(none)"}`,
        `- Scope: ${scope}`,
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        details: { entry },
      };
    },
  };
}

export function createRecordLearningTool(cwd: string, store?: LearningsStore): AgentTool<typeof recordLearningSchema> {
  return wrapToolDefinition(createRecordLearningToolDefinition(cwd, store));
}

export const recallLearningsSchema = Type.Object({
  query: Type.Optional(Type.String({ description: "Natural language query or search keywords" })),
  tags: Type.Optional(Type.Array(Type.String({ description: "Filter by specific tags" }))),
  limit: Type.Optional(
    Type.Integer({ description: "Maximum number of learnings to return (default 5)", minimum: 1, maximum: 20 }),
  ),
});

export type RecallLearningsToolInput = Static<typeof recallLearningsSchema>;

export interface RecallLearningsToolDetails {
  matches?: LearningMatch[];
  count?: number;
}

export function createRecallLearningsToolDefinition(
  cwd: string,
  customStore?: LearningsStore,
): ToolDefinition<typeof recallLearningsSchema, RecallLearningsToolDetails> {
  const store = customStore ?? new LearningsStore({ cwd });
  return {
    name: "recall_learnings",
    label: "recall_learnings",
    description: "Search and recall past project and global continuous learning rules, pitfalls, and fixes.",
    promptSnippet: "Search past project and global learnings/traps",
    promptGuidelines: [
      "Before attempting risky or complex tasks with known failure modes, use recall_learnings to check for known traps.",
    ],
    parameters: recallLearningsSchema,
    async execute(_toolCallId, input: RecallLearningsToolInput) {
      const limit = input.limit ?? 5;
      const matches = store.query({
        queryText: input.query,
        tags: input.tags,
        limit,
      });

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: "No relevant learnings found in project or global memory." }],
          details: { matches: [], count: 0 },
        };
      }

      const lines = [
        `Found ${matches.length} relevant learning(s):`,
        ...matches.map((m, index) => {
          const e = m.entry;
          const tagsStr = (e.tags ?? []).length > 0 ? ` [${e.tags.join(", ")}]` : "";
          return `\n${index + 1}. Rule: ${e.rule}${tagsStr}\n   Trap: ${e.trap}\n   Fix: ${e.fix}\n   Score: ${m.score}`;
        }),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { matches, count: matches.length },
      };
    },
  };
}

export function createRecallLearningsTool(
  cwd: string,
  store?: LearningsStore,
): AgentTool<typeof recallLearningsSchema> {
  return wrapToolDefinition(createRecallLearningsToolDefinition(cwd, store));
}
