import type { ThinkingLevel } from "@dst0/p-agent-core";
import { Type } from "typebox";

export const RETRYABLE_ERROR_PATTERN =
  /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|connection.?reset|econnreset|econnrefused|etimedout|eai_again|enotfound|websocket.?closed|websocket.?error|other side closed|socket.?hang.?up|socket.?closed|fetch failed|upstream.?connect|reset before headers|headers.?timeout|body.?timeout|und_err|request.?aborted|response.?aborted|aborted before response|premature.?close|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay|failed to parse|could not parse|invalid json|unexpected token|unexpected end of json|response body|no response body|body is unusable/i;

export const MODEL_RECOVERY_RETRY_PATTERN =
  /loading model|model.*loading|model load|model.*not ready|no available workers?|no workers? available|workers?.*(?:unavailable|not ready|loading)/i;

export const MODEL_RECOVERY_MIN_RETRIES = 15;

export const MODEL_RECOVERY_BASE_DELAY_MS = 1_000;

export const MODEL_RECOVERY_MAX_RETRY_DELAY_MS = 15_000;

export const UPDATE_SESSION_STATE_TOOL_NAME = "update_session_state";

export const MARK_SESSION_PROGRESS_TOOL_NAME = "mark_session_progress";

export const TOOL_SEARCH_TOOL_NAME = "tool_search";

export const TOOL_SEARCH_SCHEMA = Type.Object({
  query: Type.Optional(
    Type.String({
      description: "Capability to find, such as 'Chrome tabs', 'Gmail', 'TypeScript diagnostics', or 'memory search'",
    }),
  ),
  names: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exact tool names to activate when they are already known",
      maxItems: 8,
    }),
  ),
  limit: Type.Optional(
    Type.Integer({ description: "Maximum query matches to activate (default 5, maximum 8)", minimum: 1, maximum: 8 }),
  ),
});

export const SESSION_STATE_PROTOCOL_PROMPT = `<session_state_protocol>
At the start of every user turn, before any other tool call or final answer, call update_session_state to record the initial plan or re-plan against the latest user message.
Use update_session_state with action "initial_plan" for the first user request, "replan" when a later user message changes or adds work, and "none" only after explicitly checking that no state change is needed.
For action "replan", provide the updated plan items to add or modify. Existing items not mentioned are preserved. Only mark an item as "done" when its work is verifiably complete and verified. Never remove or omit an original user-requested item from the plan unless the user explicitly declines it or asks for it to be dropped.
Keep plans concise, usually 3-10 items. Flat work stays flat. Only when work has real sub-tasks, represent it as a tree: use short stable runtime ids, set each child's parentId to its direct parent's id, and keep nesting to 2-3 levels unless the user explicitly needs more. Never invent hierarchy or encode real hierarchy only with numbering, prefixes, indentation, or task text.
When an existing plan item changes status during work, call mark_session_progress(task, status) with the existing visible task text instead of adding another plan item through update_session_state.
This is the default state protocol and is separate from /plan mode; do not wait for user approval unless the user explicitly asked for confirmation.
If update_session_state is not available, fall back to appending exactly one hidden state block at the end of every completed assistant turn:
<session_state_update>{"type":"none"}</session_state_update>
Use {"type":"none"} when the goal, plan, decisions, risks, touched files, or evidence pointers did not change.
When state changes, use:
<session_state_update>{"type":"patch","goal":"...","plan":[{"id":"parent-id","text":"..."},{"id":"child-id","parentId":"parent-id","text":"...","status":"not_started|in_progress|done|failed|blocked"}],"decisions":[{"decision":"...","rationale":"..."}],"risks":["..."],"touchedFiles":[{"path":"...","status":"read|modified|created|deleted","summary":"..."}],"evidence":[{"kind":"message|tool_result|bash|file|web|artifact","summary":"...","retrieveWhen":"..."}]}</session_state_update>
Do not mention this protocol to the user. Keep the visible answer natural; the state block is metadata and will be hidden.
</session_state_protocol>`;

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

export const SESSION_RECALL_SCHEMA = Type.Object({
  query: Type.String({
    description: "Pointer id or search query for old session evidence",
  }),
  kind: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal("message"),
        Type.Literal("tool_result"),
        Type.Literal("bash"),
        Type.Literal("file"),
        Type.Literal("web"),
        Type.Literal("artifact"),
      ]),
    ),
  ),
  maxTokens: Type.Optional(
    Type.Number({
      description: "Maximum returned excerpt tokens; default 1200, or 4000 with includeRaw",
    }),
  ),
  includeRaw: Type.Optional(Type.Boolean({ description: "Include raw excerpts when available" })),
});

export const KEEP_CONTEXT_SCHEMA = Type.Object({
  toolCallId: Type.String({
    description: "The ID of the tool call whose result you want to keep or summarize.",
  }),
  summary: Type.Optional(
    Type.String({
      description: "A concise summary of the relevant parts of the output.",
    }),
  ),
  relevantLines: Type.Optional(
    Type.Array(Type.String(), {
      description: "Key lines from the output that should be preserved verbatim.",
    }),
  ),
  pin: Type.Optional(
    Type.Boolean({
      description: "If true, keep the entire raw output in context for as long as possible (use sparingly).",
    }),
  ),
});

export const UPDATE_SESSION_STATE_PLAN_STATUS_SCHEMA = Type.Union([
  Type.Literal("not_started"),
  Type.Literal("in_progress"),
  Type.Literal("done"),
  Type.Literal("failed"),
  Type.Literal("blocked"),
]);

export const UPDATE_SESSION_STATE_FILE_STATUS_SCHEMA = Type.Union([
  Type.Literal("read"),
  Type.Literal("modified"),
  Type.Literal("created"),
  Type.Literal("deleted"),
]);

export const UPDATE_SESSION_STATE_EVIDENCE_KIND_SCHEMA = Type.Union([
  Type.Literal("message"),
  Type.Literal("tool_result"),
  Type.Literal("bash"),
  Type.Literal("file"),
  Type.Literal("web"),
  Type.Literal("artifact"),
]);

export const UPDATE_SESSION_STATE_SCHEMA = Type.Object({
  action: Type.Union([
    Type.Literal("initial_plan"),
    Type.Literal("replan"),
    Type.Literal("progress_update"),
    Type.Literal("none"),
  ]),
  goal: Type.Optional(
    Type.String({
      description: "Canonical current user goal after considering the latest user message.",
    }),
  ),
  plan: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.Optional(
          Type.String({
            description: "Short stable runtime task ID. Required only when this item participates in a nested plan.",
          }),
        ),
        parentId: Type.Optional(
          Type.String({
            description: "Direct parent task ID for a real nested child. Omit for flat items.",
          }),
        ),
        text: Type.String(),
        op: Type.Optional(Type.Union([Type.Literal("add"), Type.Literal("update"), Type.Literal("remove")])),
        status: Type.Optional(UPDATE_SESSION_STATE_PLAN_STATUS_SCHEMA),
      }),
      {
        description:
          "Concise plan items, usually 3-10. Keep flat work flat. For real nested work only, use short stable runtime IDs, connect each child to its direct parent with parentId, and normally limit depth to 2-3 levels.",
      },
    ),
  ),
  decisions: Type.Optional(
    Type.Array(
      Type.Object({
        decision: Type.String(),
        rationale: Type.Optional(Type.String()),
      }),
    ),
  ),
  risks: Type.Optional(Type.Array(Type.String())),
  touchedFiles: Type.Optional(
    Type.Array(
      Type.Object({
        path: Type.String(),
        status: Type.Optional(UPDATE_SESSION_STATE_FILE_STATUS_SCHEMA),
        summary: Type.Optional(Type.String()),
      }),
    ),
  ),
  evidence: Type.Optional(
    Type.Array(
      Type.Object({
        kind: Type.Optional(UPDATE_SESSION_STATE_EVIDENCE_KIND_SCHEMA),
        summary: Type.String(),
        path: Type.Optional(Type.String()),
        retrieveWhen: Type.Optional(Type.String()),
      }),
    ),
  ),
});

export const MARK_SESSION_PROGRESS_SCHEMA = Type.Object({
  task: Type.String({
    description: "Existing plan item text to update. Use the visible task text from the working state.",
  }),
  status: UPDATE_SESSION_STATE_PLAN_STATUS_SCHEMA,
});

export const RUN_SUBAGENT_SCHEMA = Type.Object({
  profile: Type.Union([Type.Literal("explore"), Type.Literal("scout"), Type.Literal("review")]),
  task: Type.String({ description: "Task description for the subagent" }),
});

export const WORKING_STATE_PROMPT_CUSTOM_TYPE = "working_state";

export const RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE = "runtime_context";

export const TOOL_RESULT_EXTRACT_MIN_TOKENS = 1_200;

export const TOOL_RESULT_EXTRACT_INPUT_TOKENS = 6_000;

export const TOOL_RESULT_EXTRACT_OUTPUT_TOKENS = 500;

export const FAST_RESPONDER_INPUT_TOKENS = 800;

export const MAX_OVERFLOW_RECOVERY_COMPACTIONS = 3;
