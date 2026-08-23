# Using p

This page collects day-to-day usage details that do not fit on the quickstart page.

## Interactive Mode

<p align="center"><img src="images/interactive-mode.png" alt="Interactive Mode" width="600"></p>

The interface has four main areas:

- **Startup header** - shortcuts, loaded context files, prompt templates, skills, and extensions
- **Messages** - user messages, assistant responses, tool calls, tool results, notifications, errors, and extension UI
- **Editor** - where you type; border color indicates the current thinking level
- **Footer** - working directory, session name, token/cache usage, cost, context usage, and current model

The editor can be replaced temporarily by built-in UI such as `/settings` or by custom extension UI.

### Editor Features

| Feature              | How                                                            |
| -------------------- | -------------------------------------------------------------- |
| File reference       | Type `@` to fuzzy-search project files                         |
| Path completion      | Press Tab to complete paths                                    |
| Multi-line input     | Shift+Enter, or Ctrl+Enter on Windows Terminal                 |
| Images               | Paste with Ctrl+V, Alt+V on Windows, or drag into the terminal |
| Shell command        | `!command` runs and sends output to the model                  |
| Hidden shell command | `!!command` runs without sending output to the model           |
| External editor      | Ctrl+G opens `$VISUAL` or `$EDITOR`                            |

See [Keybindings](keybindings.md) for all shortcuts and customization.

## Slash Commands

Type `/` in the editor to open command completion. Extensions can register custom commands, skills are available as `/skill:name`, and prompt templates expand via `/templatename`.

| Command                                     | Description                                                          |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `/login`, `/logout`                         | Manage OAuth or API-key credentials                                  |
| `/plan [request]`                           | Plan first and wait for approval before execution                    |
| `/model`                                    | Switch models                                                        |
| `/scoped-models`                            | Enable/disable models for Ctrl+P cycling                             |
| `/settings`                                 | Thinking level, theme, message delivery, transport                   |
| `/index`, `/index enable`, `/index disable`, `/index up` | Inspect, change, or prioritize background code indexing for the active repository |
| `/resume`                                   | Pick from previous sessions                                          |
| `/new`                                      | Start a new session                                                  |
| `/name <name>`                              | Set session display name                                             |
| `/session`                                  | Show session file, ID, messages, tokens, and cost                    |
| `/tree`                                     | Jump to any point in the session and continue from there             |
| `/fork`                                     | Create a new session from a previous user message                    |
| `/clone`                                    | Duplicate the current active branch into a new session               |
| `/compact [prompt]`                         | Manually compact context, optionally with custom instructions        |
| `/copy`                                     | Copy last assistant message to clipboard                             |
| `/export [file]`                            | Export session to HTML                                               |
| `/share`                                    | Upload as private GitHub gist with shareable HTML link               |
| `/reload`                                   | Reload keybindings, extensions, skills, prompts, and context files   |
| `/hotkeys`                                  | Show all keyboard shortcuts                                          |
| `/changelog`                                | Display version history                                              |
| `/quit`                                     | Quit p                                                              |

## Message Queue

You can submit messages while the agent is still working:

- **Enter** queues a steering message, delivered after the current assistant turn finishes executing its tool calls.
- **Alt+Enter** queues a follow-up message, delivered after the agent finishes all work.
- **Escape** aborts and restores queued messages to the editor.
- **Alt+Up** retrieves queued messages back to the editor.

On Windows Terminal, Alt+Enter is fullscreen by default. Remap it as described in [Terminal setup](terminal-setup.md) if you want p to receive the shortcut.

Configure delivery in [Settings](settings.md) with `steeringMode` and `followUpMode`.

## Completion Protocol

p defaults to `completionMode: "explicit_finish"`. The agent only treats work as complete after the model calls the terminal tool `finish_work`; a plain assistant response with no tool calls does not end the loop in this mode.

This avoids a common local-model failure mode:

```text
Without explicit completion:
assistant says "I will inspect the file"
agent may stop accidentally.

With explicit completion:
assistant says "I will inspect the file"
agent continues because `finish_work` was not called.
```

When the task is done, the model calls:

```text
finish_work({
  status: "success" | "partial" | "failed",
  summary: string,
  verification_token?: string,
  files_changed?: string[],
  tests_run?: string[],
  remaining_work?: string[],
  notes?: string
})
```

Print mode displays `summary`. After a successful requirement audit, the controller can populate an omitted `verification_token`; a supplied token must match exactly. Malformed or truncated tool-call-looking output is retried with a short internal correction prompt. Safety limits such as `maxNoProgressTurns` and `maxMalformedToolRetries` stop weak models from looping forever.

### Evidence-backed completion

Before `finish_work`, `ready_to_finish` freezes the current acceptance checks and evidence. The model then uses `record_requirement_audit` to define stable requirement IDs from user-authored prompts and submits every verdict together in one `action: "verdict"` call. A missing, duplicate, unexpected, stale, or unsupported verdict rejects the whole batch without persisting a partial result.

When a user prompt names local Markdown, AsciiDoc, reStructuredText, or text documents, the controller blocks non-read-only shell commands and file mutations before baseline setup. One `action: "prepare_definition"` call must select zero to three authoritative paths and classify every other candidate. Every referenced local document fails closed as authoritative unless its exact prompt context makes it only a requested output. A model-authored reason cannot discard an authoritative or already frozen source; only a later direct-user prompt that explicitly deauthorizes the exact path can do so, and that prompt identity is persisted. A newer authorization for the same path invalidates the earlier deauthorization. Selected sources must be bounded, Git-tracked UTF-8 files without symlinks, hardlinks, or detected secrets. The controller checks size before allocation, reads through a no-follow descriptor, and stores hash-bound immutable session snapshots rather than copying source text into ordinary task state.

On the next model turn, `action: "define"` must classify every extracted source clause exactly once, including headings and fenced content: map each surviving normative clause to semantically relevant atomic requirements or identify structurally justified informational, example, superseded, or controller-detected unsafe content. Definition rejection reports independent diagnostics together in deterministic order, suppresses errors that depend only on a malformed item, and stores no partial definition. Responses that would exceed 32 KiB are grouped by repair class with exact instance counts, one stable bounded example per class, and complete-batch resubmission guidance. A referenced-file conflict has no implicit precedence; `superseded` requires the index of an explicit conflicting direct-user clarification. Current-revision source drift fails closed before the first mutation. Later prompts retain already frozen bytes, add newly delegated sources incrementally, and cannot adopt changed file contents unless the latest direct prompt explicitly authorizes that exact path. Pure status or continuation nudges and redundant completion reminders preserve the frozen definition; a real new requirement invalidates it normally. Missing, corrupt, secret-bearing, or otherwise unsafe restored snapshots also fail closed.

The controller derives proof policies for recognized high-risk relationships. Newline-terminated artifacts that reject truncation require a complete truncation requirement and focused evidence naming exact final-byte removal. Its witness is valid only when the original ends in LF (`0x0A`) and the rejected candidate is exactly the original minus that byte. Corruption evidence must identify a changed artifact, and failed-operation rollback claims for state, log, version, position, and command identity must be split into independently verifiable requirements. Rollback witnesses must record a thrown failure; monotonic counters must remain unchanged on failure and advance by exactly one on success. Each matching focused test emits a bounded one-line `P_PROOF_V1` frame. The controller validates the before/after or original/candidate relationship, reports rejected or duplicate frame counts immediately, persists only its digest bound to the requirement-set hash and mutation revision, and redacts raw frame values from both returned tool content and durable evidence summaries. The proof policies are checked in the single verdict batch. They improve honest-agent evidence quality; arbitrary test code can still fabricate its observations, so this is not a cryptographic proof of production behavior.

Every passing verdict needs current non-error evidence. Security, integrity, durability, persistence, lifecycle, transaction, and concurrency requirements additionally need a focused executable test selector and an independently positive result matching the invariant's concrete behavior, subject, qualifiers, and polarity. A generic `npm test` or `npm run check`, manual reproduction, output prose, or same-domain test for a different behavior is insufficient. Only a completely passing batch issues the completion token supplied unchanged to `finish_work`.

Use `--completion-mode implicit` for the old behavior or `--completion-mode hybrid` during migration.

## Sessions

Sessions are saved automatically to `~/.p/agent/sessions/`, organized by working directory.

```bash
p -c                  # Continue most recent session
p -r                  # Browse and select a session
p --no-session        # Ephemeral mode; do not save
p --name "my task"    # Set session display name at startup
p --session <path|id> # Use a specific session file or session ID
p --fork <path|id>    # Fork a session into a new session file
```

Useful session commands:

- `/session` shows the current session file and ID.
- `/tree` navigates the in-file session tree and can summarize abandoned branches.
- `/fork` creates a new session from an earlier user message.
- `/clone` duplicates the current active branch into a new session file.
- `/compact` summarizes older messages to free context.

See [Sessions](sessions.md) and [Compaction](compaction.md) for details.

## Context Files

p loads `AGENTS.md` or `CLAUDE.md` at startup from:

- `~/.p/agent/AGENTS.md` for global instructions
- parent directories, walking up from the current working directory
- the current directory

Use context files for project conventions, commands, safety rules, and preferences. p hashes the complete source chain, injects an exact or compiled block under 5,000 characters, and keeps exact large-file sections available through `read_rules`. Select `--project-instructions compiled` (default), `legacy`, or `off`; see [Project instructions](project-instructions.md). `--no-context-files` and `-nc` are aliases for `off`.

### System Prompt Files

Replace the default system prompt with:

- `.p/SYSTEM.md` for a project
- `~/.p/agent/SYSTEM.md` globally

Append to the default prompt without replacing it with `APPEND_SYSTEM.md` in either location.

### Project Trust

On interactive startup, p asks before trusting a project folder that contains project-local settings, resources, or project `.agents/skills` and has no saved decision for the folder or a parent folder in `~/.p/agent/trust.json`. Trusting a project allows p to load `.p/settings.json` and `.p` resources, install missing project packages, and execute project extensions.

Before the trust decision, p loads only context files, user/global extensions, and CLI `-e` extensions so they can handle the `project_trust` event. Project-local extensions, project package-managed extensions, and project settings are loaded only after the project is trusted. This split also applies when switching to a session from a different cwd whose trust has not been resolved in the current process.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, they use `defaultProjectTrust` from global settings: `ask` (default) and `never` ignore those project resources, while `always` trusts them. Pass `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

If no extension or saved decision applies, `defaultProjectTrust` controls the fallback behavior. Set it to `"ask"`, `"always"`, or `"never"` in `~/.p/agent/settings.json`, or change it with `/settings`.

`p config` and package commands use the same project trust flow, except `p update` never prompts. Pass `--approve` to trust project-local settings for one command or `--no-approve` to ignore them.

Use `/trust` in interactive mode to save a project trust decision for future sessions, including trust for the immediate parent folder. It writes `~/.p/agent/trust.json` only; the current session is not reloaded, so restart p for changes to take effect.

## Exporting and Sharing Sessions

Use `/export [file]` to write a session to HTML.

Use `/share` to upload a private GitHub gist with a shareable HTML link.

If you use p for open source work and want to publish sessions for model, prompt, tool, and evaluation research, share them publicly on Hugging Face or similar platforms.

## CLI Reference

```bash
p [options] [@files...] [messages...]
```

### Package Commands

```bash
p install <source> [-l]     # Install package, -l for project-local
p remove <source> [-l]      # Remove package
p uninstall <source> [-l]   # Alias for remove
p update [source|self|p]   # Update p and packages; reconcile pinned git refs
p update --extensions       # Update packages only; reconcile pinned git refs
p update --self             # Update p only
p update --extension <src>  # Update one package
p list                      # List installed packages
p config                    # Enable/disable package resources
```

These commands manage p packages, not the p CLI installation. To uninstall p itself, see [Quickstart](quickstart.md#uninstall). `p config` and project package commands accept `--approve`/`--no-approve` to trust or ignore project-local settings for one command. `p update` never prompts for project trust.

See [p Packages](packages.md) for package sources and security notes.

### Modes

| Flag                  | Description                                               |
| --------------------- | --------------------------------------------------------- |
| default               | Interactive mode                                          |
| `-p`, `--print`       | Print response and exit                                   |
| `--mode json`         | Output all events as JSON lines; see [JSON mode](json.md) |
| `--mode rpc`          | RPC mode over stdin/stdout; see [RPC mode](rpc.md)        |
| `--export <in> [out]` | Export a session to HTML                                  |

In print mode, p also reads piped stdin and merges it into the initial prompt:

```bash
cat README.md | p -p "Summarize this text"
```

### Model Options

| Option                     | Description                                                            |
| -------------------------- | ---------------------------------------------------------------------- |
| `--provider <name>`        | Provider, such as `anthropic`, `openai`, or `google`                   |
| `--model <pattern>`        | Model pattern or ID; supports `provider/id` and optional `:<thinking>` |
| `--api-key <key>`          | API key, overriding environment variables                              |
| `--thinking <level>`       | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`                     |
| `--models <patterns>`      | Comma-separated patterns for Ctrl+P cycling                            |
| `--list-models [search]`   | List available models                                                  |
| `--completion-mode <mode>` | `explicit_finish` (default), `hybrid`, or `implicit`                   |

### Session Options

| Option                       | Description                                            |
| ---------------------------- | ------------------------------------------------------ |
| `-c`, `--continue`           | Continue the most recent session                       |
| `-r`, `--resume`             | Browse and select a session                            |
| `--session <path\|id>`       | Use a specific session file or partial UUID            |
| `--fork <path\|id>`          | Fork a session file or partial UUID into a new session |
| `--session-dir <dir>`        | Custom session storage directory                       |
| `--no-session`               | Ephemeral mode; do not save                            |
| `--name <name>`, `-n <name>` | Set session display name at startup                    |

### Tool Options

| Option                                 | Description                                                    |
| -------------------------------------- | -------------------------------------------------------------- |
| `--tools <list>`, `-t <list>`          | Allowlist specific built-in, extension, and custom tools       |
| `--exclude-tools <list>`, `-xt <list>` | Disable specific built-in, extension, and custom tools         |
| `--no-builtin-tools`, `-nbt`           | Disable built-in tools but keep extension/custom tools enabled |
| `--no-tools`, `-nt`                    | Disable all tools                                              |

Built-in tools: `read`, `list_skills`, `read_rules`, `read_skills`, `semantic_search`, `bash`, `process`, `edit`, `write`, `grep`, `find`, `ls`, `sleep`, `update_session_state`, `ask_user`, `confirm_user`, `submit_plan`.

`update_session_state` is active by default. The model is instructed to call it before other tools on each user turn so the durable goal and plan are revised explicitly instead of being inferred from the latest message. In interactive mode, `ask_user` and `confirm_user` are active by default. The model is instructed to use them only when you explicitly ask it to ask, collect information, or wait for confirmation. Type `/plan` or `/plan <request>` to enter plan mode: p may gather context and ask targeted questions, then must call `submit_plan` and wait for your approval before executing. The footer shows `PLAN` while this mode is active, and plan mode turns off automatically after you approve the suggested plan. Non-interactive modes do not enable user-input tools by default; RPC clients can enable them with `--tools` and answer the emitted UI requests.

### Resource Options

| Option                       | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `-e`, `--extension <source>` | Load an extension from path, npm, or git; repeatable |
| `--no-extensions`            | Disable extension discovery                          |
| `--skill <path>`             | Load a skill; repeatable                             |
| `--no-skills`                | Disable skill discovery                              |
| `--prompt-template <path>`   | Load a prompt template; repeatable                   |
| `--no-prompt-templates`      | Disable prompt template discovery                    |
| `--theme <path>`             | Load a theme; repeatable                             |
| `--no-themes`                | Disable theme discovery                              |
| `--project-instructions <mode>` | Use `compiled` (default), `legacy`, or `off`      |
| `--project-instruction-compiler-model <provider/id>` | Pin a dedicated model for cold compiled-instruction generation |
| `--no-context-files`, `-nc`  | Alias for `--project-instructions off`               |

Combine `--no-*` with explicit flags to load exactly what you need, ignoring settings. Example:

```bash
p --no-extensions -e ./my-extension.ts
```

### Other Options

| Option                          | Description                                                         |
| ------------------------------- | ------------------------------------------------------------------- |
| `--system-prompt <text>`        | Replace default prompt; context files and skills are still appended |
| `--append-system-prompt <text>` | Append to system prompt                                             |
| `--verbose`                     | Force verbose startup                                               |
| `-a`, `--approve`               | Trust project-local files for this run                              |
| `-na`, `--no-approve`           | Ignore project-local files for this run                             |
| `-h`, `--help`                  | Show help                                                           |
| `-v`, `--version`               | Show version                                                        |

### File Arguments

Prefix files with `@` to include them in the message:

```bash
p @prompt.md "Answer this"
p -p @screenshot.png "What's in this image?"
p @code.ts @test.ts "Review these files"
```

### Examples

```bash
# Interactive with initial prompt
p "List all .ts files in src/"

# Non-interactive
p -p "Summarize this codebase"

# Non-interactive with piped stdin
cat README.md | p -p "Summarize this text"

# Named one-shot session
p --name "release audit" -p "Audit this repository"

# Different model
p --provider openai --model gpt-4o "Help me refactor"

# Model with provider prefix
p --model openai/gpt-4o "Help me refactor"

# Model with thinking level shorthand
p --model sonnet:high "Solve this complex problem"

# Limit model cycling
p --models "claude-*,gpt-4o"

# Read-only mode
p --tools read,grep,find,ls -p "Review the code"

# Disable one extension or built-in tool while keeping the rest available
p --exclude-tools confirm_user

# Opt out of mandatory finish_work for one run
p --completion-mode implicit -p "Say exactly: ok"
```

### Environment Variables

| Variable                     | Description                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `P_CODING_AGENT_DIR`         | Override config directory; default is `~/.p/agent`                                                                                            |
| `P_CODING_AGENT_SESSION_DIR` | Override session storage directory; overridden by `--session-dir`                                                                             |
| `P_PACKAGE_DIR`              | Override package directory, useful for Nix/Guix store paths                                                                                   |
| `P_OFFLINE`                  | Disable startup network operations, including update checks, package update checks, and install/update telemetry                              |
| `P_SKIP_VERSION_CHECK`       | Skip the p version update check at startup. This prevents the `p.pages.dev` latest-version request                                            |
| `P_TELEMETRY`                | Override install/update telemetry and provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no`. This does not disable update checks |
| `P_CACHE_RETENTION`          | Set to `long` for extended prompt cache where supported                                                                                       |
| `VISUAL`, `EDITOR`           | External editor for Ctrl+G                                                                                                                    |

## Design Principles

p keeps the core small and pushes workflow-specific behavior into extensions, skills, prompt templates, and packages.

It intentionally does not include built-in MCP, sub-agents, permission popups, to-dos, or background bash. You can build or install those workflows as extensions or packages, or use external tools such as containers and tmux.

For the full rationale, read the [source repo](https://github.com/dst0/p).
