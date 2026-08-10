export const ESTIMATED_IMAGE_CHARS = 4800;

export const DATA_URL_PREFIX_CHARS = "data:;base64,".length;

export const FAILED_TOOL_RESULT_KEEP_TOKENS = 2000;

export const TOOL_STUB_KEY_LINE_COUNT = 12;

export const TOOL_STUB_LINE_MAX_CHARS = 240;

export const MAX_KEPT_LINES = 20;

export const MAX_KEPT_CHARS = 16000;

export const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[State the exact current goal. Preserve unchanged the original prompt or updated goal verbatim, incorporating any subsequent user corrections if they changed the goal.]

## Plan
[Preserve the actual step-by-step plan verbatim. Encode progress only in each plan item's status, correcting the plan only if new information requires it.]
- [ ] [Not started]
- [.] [In progress]
- [v] [Done]
- [-] [Failed]
- [!] [Blocked]

## Decisions
- **[Decision]**: [Brief rationale]

## Files
- [read|modified|created|deleted]: [Exact path] - [Concise summary]

## Risks
- [Unresolved failure, blocker, warning, or "(none)"]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new plan status, decisions, files, and risks from the new messages
- UPDATE Plan checkboxes: [] not started, [.] in progress, [v] done, [-] failed, [!] blocked
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve unchanged the original prompt or updated goal verbatim, adding new ones only if the task expanded]

## Plan
[Preserve the actual plan verbatim. Include previously done items and newly completed items. Use [] not started, [.] in progress, [v] done, [-] failed, [!] blocked.]

## Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Files
- [read|modified|created|deleted]: [Exact path] - [Concise summary]

## Risks
- [Preserve unresolved failures, blockers, and warnings; remove resolved items]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;
