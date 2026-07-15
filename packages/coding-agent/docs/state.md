# Agent State Mechanism

Pi maintains structured session state to preserve context across compaction, turns, and sessions. This page covers how state is tracked, persisted, and injected into LLM context.

**Source files** ([pi-mono](https://github.com/dst0/p-mono)):

- [`packages/coding-agent/src/core/compaction/structured-state.ts`](https://github.com/dst0/p-mono/blob/main/packages/coding-agent/src/core/compaction/structured-state.ts) – Core state types, parsing, merging, and rendering
- [`packages/coding-agent/src/core/turn-checkpoint.ts`](https://github.com/dst0/p-mono/blob/main/packages/coding-agent/src/core/turn-checkpoint.ts) – Turn checkpoint messages for tool result tracking
- [`packages/coding-agent/src/core/compaction/session-state-file.ts`](https://github.com/dst0/p-mono/blob/main/packages/coding-agent/src/core/compaction/session-state-file.ts) – State file persistence
- [`packages/coding-agent/src/core/compaction/compaction.ts`](https://github.com/dst0/p-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) – State updates during compaction
- [`packages/coding-agent/src/core/agent-session.ts`](https://github.com/dst0/p-mono/blob/main/packages/coding-agent/src/core/agent-session.ts) – Integration with agent session lifecycle

For TypeScript definitions in your project, inspect `node_modules/@dst0/p/dist/`.

## Overview

The state mechanism maintains a structured representation of the current session that is:

1. **Persisted** in a state file alongside the session
2. **Injected** into the system prompt for context continuity
3. **Updated** by the model via `update_session_state` and `mark_session_progress` tools
4. **Reconstructed** from compaction summaries or live session messages

### Why Structured State

Without structured state, compaction replaces detailed conversation history with a summary. Key details like the exact goal, specific constraints, and intermediate decisions can be lost or diluted. Structured state preserves these as typed data that survives compaction and is re-injected into context.

### What Is Tracked

The state captures:

| Section               | Description                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- |
| **Canonical request** | Current goal, original user requests, and superseded requests                       |
| **Constraints**       | Requirements and preferences from user, system, or project context                  |
| **Plan**              | Ordered list of tasks with status (not_started, in_progress, done, failed, blocked) |
| **Decisions**         | Key technical decisions with rationale and evidence pointers                        |
| **Codebase**          | Files touched (read/modified/created/deleted) and relevant symbols                  |
| **Evidence**          | Pointers to tool results, bash output, and file reads for later retrieval           |
| **Audit**             | Compaction metadata, known risks                                                    |

## State File

State is persisted in a JSON file alongside the session file:

```
~/.p/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl   # session file
~/.p/agent/sessions/--<path>--/<timestamp>_<uuid>.state.json  # state file
```

The state file is:

- Created on first state update
- Updated after each state change
- Loaded when a session is resumed
- Independent of session compaction (state survives compaction)

The state file format includes:

- `version`: State schema version (currently 1)
- `sessionId`: Links to the session file
- `state`: The full `StructuredSessionState` object
- `lastModified`: ISO timestamp of last update
- `source`: How the state was created ("update", "compaction", or "live")

## State Persistence via Custom Entries

In addition to the state file, state is also persisted in the session file as custom entries with type `pi.structured-session-state`. This provides a backup and allows state recovery even if the state file is missing.

## State Update Tool

The `update_session_state` tool allows the model to update state during a session. It accepts a JSON structure within `<session_state_update>` tags:

```json
<session_state_update>
{
  "type": "patch",
  "goal": "Implement user authentication with OAuth",
  "plan": [
    { "text": "Set up OAuth provider", "status": "done" },
    { "text": "Add login page", "status": "in_progress" },
    { "text": "Write integration tests", "status": "not_started" }
  ],
  "decisions": [
    { "decision": "Use Google OAuth", "rationale": "User already has Google accounts" }
  ],
  "touchedFiles": [
    { "path": "src/auth.ts", "status": "created", "summary": "OAuth authentication module" }
  ],
  "constraints": ["Must support SSO", "No third-party auth libraries"],
  "risks": ["OAuth callback URL not configured in production"]
}
</session_state_update>
```

### State Update Fields

| Field          | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `type`         | `"none"` (no change) or `"patch"` (update)                      |
| `goal`         | Updated canonical goal                                          |
| `plan`         | Full plan replacement (array of items with `text` and `status`) |
| `constraints`  | New constraints to add                                          |
| `decisions`    | New decisions to add                                            |
| `touchedFiles` | Files touched during this turn                                  |
| `evidence`     | Evidence pointers for later retrieval                           |
| `risks`        | Known risks                                                     |

### Mark Session Progress Tool

The `mark_session_progress` tool is a lighter-weight alternative for updating plan item status:

```json
<session_state_update>
{
  "type": "none",
  "progress": {
    "done": ["Set up OAuth provider"],
    "current": ["Add login page"],
    "next": ["Write integration tests"]
  }
}
</session_state_update>
```

## State Injection into Context

State is injected into the LLM context in two forms:

### Session Checkpoint

Injected at the start of each turn (from compaction summary or state file). Provides a compact overview:

```
<session_checkpoint>
Goal: Implement user authentication with OAuth
Original requests stored: 2
Active constraints:
- Must support SSO
- No third-party auth libraries
Current plan:
- [done] Set up OAuth provider
- [in_progress] Add login page
- [not_started] Write integration tests
Touched files:
- created: src/auth.ts - OAuth authentication module
Retrieve if needed:
- tool-result:abc123: bash ls /src success result
Known risks:
- OAuth callback URL not configured in production
</session_checkpoint>
```

### Working State

Injected after state update tool calls. Shows the current working state:

```
<working_state>
🚩 Goal: Implement user authentication with OAuth
Original requests stored: 2
Plan:
✅ Set up OAuth provider
⏳ Add login page
➖ Write integration tests
Active constraints:
- Must support SSO
- No third-party auth libraries
Decisions:
- Use Google OAuth: User already has Google accounts
Touched files:
- created: src/auth.ts - OAuth authentication module
Evidence pointers:
- tool-result:abc123: bash ls /src success result
Risks:
⚠️ OAuth callback URL not configured in production
</working_state>
```

## Turn Checkpoints

After each tool turn, a turn checkpoint message is injected. This tells the model which tool calls succeeded or failed:

```
<turn_checkpoint>
The immediately preceding tool turn is complete. Treat these outcomes as facts:
- SUCCESS read (tool-result:abc123): the action completed; use the preceding result and advance.
- ERROR bash (tool-result:def456): the action did not complete; address the preceding error before retrying.
Do not repeat an identical successful call unless relevant state changed or explicit revalidation/polling is required.
Do not retry an unchanged failed call; first address its cause or change the arguments or plan.
</turn_checkpoint>
```

When the working state was refreshed by `update_session_state` or `mark_session_progress`, a note indicates the refreshed `<working_state>` follows and is authoritative over earlier snapshots.

## State Reconstruction

State can be reconstructed from:

1. **Compaction summary**: When compaction runs, the summary is parsed and state is updated
2. **Live session messages**: Assistant and custom messages are scanned for state updates, plan items, decisions, and evidence
3. **State file**: Loaded when resuming a session
4. **Custom entries**: State stored in session file as fallback

### From Compaction Summary

When compaction generates a summary, the state system extracts:

- Goal from the summary's "Goal" section
- Plan items from markdown checkboxes in the plan section
- Decisions from the key decisions section
- File operations from tool calls in the messages
- Evidence pointers from tool results and bash commands

### From Live Session

When processing live session messages, the system:

- Strips structured context blocks (state updates, checkpoints)
- Extracts plan items from markdown lists
- Extracts decisions from key decisions sections
- Collects original user requests and classifies them
- Builds evidence pointers from tool results and file operations

## API Reference

### Core Types

```typescript
interface StructuredSessionState {
  version: number;
  sessionId: string;
  canonicalRequest: {
    current: string;
    sourceEntryIds: string[];
    originalRequests: OriginalUserRequest[];
    superseded: Array<{
      old: string;
      replacedBy: string;
      reason: string;
      entryId: string;
    }>;
  };
  constraints: Constraint[];
  plan: PlanItem[];
  decisions: Decision[];
  codebase: { touchedFiles: TouchedFile[]; relevantSymbols: RelevantSymbol[] };
  evidence: EvidencePointer[];
  audit: {
    lastCompactionAt: string;
    compactionCount: number;
    knownRisks: string[];
  };
}

interface PlanItem {
  id: string;
  text: string;
  status: "not_started" | "in_progress" | "done" | "failed" | "blocked";
  evidenceEntryIds: string[];
}

interface Constraint {
  id: string;
  text: string;
  source: "user" | "system" | "project" | "inferred";
  status: "active" | "superseded" | "rejected";
  enforceability: "prompt" | "runtime_check" | "test" | "manual";
}

interface Decision {
  id: string;
  decision: string;
  rationale: string;
  evidencePointers: EvidencePointer[];
  status: "active" | "superseded";
}
```

### Key Functions

| Function                                              | Description                                |
| ----------------------------------------------------- | ------------------------------------------ |
| `createInitialStructuredSessionState(sessionId)`      | Create empty state                         |
| `createStructuredSessionState(input)`                 | Create state from compaction summary       |
| `createLiveStructuredSessionState(input)`             | Create state from live session messages    |
| `mergeStructuredSessionState(previous, patch)`        | Apply a state patch                        |
| `renderStructuredSessionCheckpoint(state, maxTokens)` | Render checkpoint for context injection    |
| `renderWorkingSessionState(state, maxTokens)`         | Render working state for context injection |
| `hasMeaningfulStructuredSessionState(state)`          | Check if state has meaningful content      |
| `parseSessionStateUpdateBlock(text)`                  | Parse state update from text               |
| `getLatestStructuredSessionState(entries)`            | Get latest state from session entries      |

### State File Functions

| Function                               | Description                       |
| -------------------------------------- | --------------------------------- |
| `getStateFilePath(sessionFilePath)`    | Get state file path for a session |
| `readStateFile(stateFilePath)`         | Read state from file              |
| `writeStateFile(stateFilePath, state)` | Write state to file               |
| `removeStateFile(stateFilePath)`       | Remove state file                 |
| `stateFileExists(stateFilePath)`       | Check if state file exists        |

### Turn Checkpoint

| Function                                                  | Description                     |
| --------------------------------------------------------- | ------------------------------- |
| `createTurnCheckpointMessages(context, state, maxTokens)` | Create turn checkpoint messages |

## Integration with Compaction

The state mechanism integrates with compaction in these ways:

1. **Before compaction**: Current state is loaded from state file or custom entries
2. **During compaction**: State is updated from the compaction summary using `createStructuredSessionState`
3. **After compaction**: Updated state is saved to both state file and session custom entry
4. **Token budgeting**: State rendering is capped to stay within token budgets

State survives compaction because it is stored separately from the conversation messages that are compacted. When the session is reloaded, state is restored from the state file or custom entries.

## Integration with Extensions

Extensions can access and modify state through:

- `session_before_compact` event: Access state during compaction preparation
- `session_before_tree` event: Access state during branch navigation
- Custom session entries: Store extension-specific state alongside the built-in state

The `details` field in `CompactionEntry` and `BranchSummaryEntry` can include file tracking data that is merged into the codebase section of structured state.

## Configuration

State management is tied to compaction settings:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

State rendering respects the compaction token budget. Checkpoint and working state are capped to fit within available tokens.

## Troubleshooting

### State Not Persisting

- Check that the session directory is writable
- Verify the state file is being created alongside the session file
- Check for permission errors in the logs

### State Lost After Compaction

- State should survive compaction via state file and custom entries
- If state file is missing, custom entries provide fallback
- Verify `compaction.enabled` is true in settings

### Stale State

- State is refreshed after `update_session_state` tool calls
- If state appears stale, check for parsing errors in state update blocks
- The `malformed` flag in parsed blocks indicates parsing issues
