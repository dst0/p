import chalk from "chalk";
import { APP_NAME, CONFIG_DIR_NAME } from "../config.ts";
import type { ExtensionFlag } from "../core/extensions/types.ts";
import { ENVIRONMENT_HELP } from "./environment-help.ts";

export function printHelp(extensionFlags?: ExtensionFlag[]): void {
  const extensionFlagsText =
    extensionFlags && extensionFlags.length > 0
      ? `\n${chalk.bold("Extension CLI Flags:")}\n${extensionFlags
          .map((flag) => {
            const value = flag.type === "string" ? " <value>" : "";
            const description = flag.description ?? `Registered by ${flag.extensionPath}`;
            return `  --${flag.name}${value}`.padEnd(30) + description;
          })
          .join("\n")}\n`
      : "";
  console.log(`${chalk.bold(APP_NAME)} - AI task assistant with workspace and user-input tools

${chalk.bold("Usage:")}
  ${APP_NAME} [options] [@files...] [messages...]

${chalk.bold("Commands:")}
  ${APP_NAME} install <source> [-l]     Install extension source and add to settings
  ${APP_NAME} remove <source> [-l]      Remove extension source from settings
  ${APP_NAME} uninstall <source> [-l]   Alias for remove
  ${APP_NAME} update [source|self|p]   Update p and installed extensions
  ${APP_NAME} list                      List installed extensions from settings
  ${APP_NAME} config                    Open TUI to enable/disable package resources
  ${APP_NAME} <command> --help          Show help for install/remove/uninstall/update/list

${chalk.bold("Options:")}
  --provider <name>              Provider name (default: google)
  --model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")
  --api-key <key>                API key (defaults to env vars)
  --system-prompt <text>         System prompt (default: task assistant prompt)
  --append-system-prompt <text>  Append text or file contents to the system prompt (can be used multiple times)
  --mode <mode>                  Output mode: text (default), json, or rpc
  --print, -p                    Non-interactive mode: process prompt and exit
  --continue, -c                 Continue previous session
  --resume, -r                   Select a session to resume
  --session <path|id>            Use specific session file or partial UUID
  --session-id <id>              Use exact project session ID, creating it if missing
  --fork <path|id>               Fork specific session file or partial UUID into a new session
  --session-dir <dir>            Directory for session storage and lookup
  --no-session                   Don't save session (ephemeral)
  --name, -n <name>              Set session display name
  --models <patterns>            Comma-separated model patterns for Ctrl+P cycling
                                 Supports globs (anthropic/*, *sonnet*) and fuzzy matching
  --no-tools, -nt                Disable all tools by default (built-in and extension)
  --no-builtin-tools, -nbt       Disable built-in tools by default but keep extension/custom tools enabled
  --tools, -t <tools>            Comma-separated allowlist of tool names to enable
                                 Applies to built-in, extension, and custom tools
  --exclude-tools, -xt <tools>   Comma-separated denylist of tool names to disable
                                 Applies to built-in, extension, and custom tools
  --thinking <level>             Set thinking level: off, minimal, low, medium, high, xhigh
  --max-tokens <n>               Limit provider output tokens for each model request
  --budget <policy>              unlimited | requests:N | tokens:N | usd:N (session budget)
  --completion-mode <mode>       Completion mode: explicit (default), hybrid, implicit
  --project-instructions <mode>  Project rules: compiled (default), legacy, or off
  --task-verification <mode>     Task verification: evidence (default), audit (experimental), or off
  --project-instruction-compiler-model <provider/id>  Dedicated compiler model (default: task model)
  --extension, -e <path>         Load an extension file (can be used multiple times)
  --no-extensions, -ne           Disable extension discovery (explicit -e paths still work)
  --skill <path>                 Load a skill file or directory (can be used multiple times)
  --no-skills, -ns               Disable skills discovery and loading
  --prompt-template <path>       Load a prompt template file or directory (can be used multiple times)
  --no-prompt-templates, -np     Disable prompt template discovery and loading
  --theme <path>                 Load a theme file or directory (can be used multiple times)
  --no-themes                    Disable theme discovery and loading
  --no-context-files, -nc        Disable AGENTS.md and CLAUDE.md discovery and loading
  --export <file>                Export session file to HTML and exit
  --list-models [search]         List available models (with optional fuzzy search)
  --verbose                      Force verbose startup (overrides quietStartup setting)
  --approve, -a                  Trust project-local files for this run
  --no-approve, -na              Ignore project-local files for this run
  --offline                      Disable startup network operations (same as P_OFFLINE=1)
  --help, -h                     Show this help
  --version, -v                  Show version number

Extensions can register additional flags (e.g., --profile from an extension).${extensionFlagsText}

${chalk.bold("Examples:")}
  # Interactive mode
  ${APP_NAME}

  # Plan first and wait for approval before execution
  ${APP_NAME} "/plan"

  # Interactive mode with initial prompt
  ${APP_NAME} "List all .ts files in src/"

  # Include files in initial message
  ${APP_NAME} @prompt.md @image.png "What color is the sky?"

  # Non-interactive mode (process and exit)
  ${APP_NAME} -p "List all .ts files in src/"

  # Multiple messages (interactive)
  ${APP_NAME} "Read package.json" "What dependencies do we have?"

  # Continue previous session
  ${APP_NAME} --continue "What did we discuss?"

  # Start a named session
  ${APP_NAME} --name "Refactor auth module"

  # Use different model
  ${APP_NAME} --provider openai --model gpt-4o-mini "Help me refactor this code"

  # Use model with provider prefix (no --provider needed)
  ${APP_NAME} --model openai/gpt-4o "Help me refactor this code"
  # Use model with thinking level shorthand
  ${APP_NAME} --model sonnet:high "Solve this complex problem"

  # Limit model cycling to specific models
  ${APP_NAME} --models claude-sonnet,claude-haiku,gpt-4o

  # Limit to a specific provider with glob pattern
  ${APP_NAME} --models "github-copilot/*"

  # Cycle models with fixed thinking levels
  ${APP_NAME} --models sonnet:high,haiku:low

  # Start with a specific thinking level
  ${APP_NAME} --thinking high "Solve this complex problem"

  # Opt out of mandatory finish_work completion
  ${APP_NAME} --completion-mode implicit -p "Say exactly: ok"

  # Read-only mode (no file modifications possible)
  ${APP_NAME} --tools read,grep,find,ls -p "Review the code in src/"

  # Disable one tool while keeping the rest available
  ${APP_NAME} --exclude-tools confirm_user

  # Export a session file to HTML
  ${APP_NAME} --export ~/${CONFIG_DIR_NAME}/agent/sessions/--path--/session.jsonl
  ${APP_NAME} --export session.jsonl output.html

${chalk.bold("Environment Variables:")}
${ENVIRONMENT_HELP}

${chalk.bold("Built-in Tool Names:")}
  read         - Read file contents\n  list_skills  - Discover cataloged skills in bounded pages\n  read_rules   - Read integrity-checked project instruction modules\n  read_skills  - Read cataloged skills and skill-relative resources
  bash         - Execute bash commands
  edit         - Edit files with find/replace
  write        - Write files (creates/overwrites)
  grep         - Search file contents (read-only, off by default)
  find         - Find files by glob pattern (read-only, off by default)
  ls           - List directory contents (read-only, off by default)
  sleep        - Wait, then run a required concrete check
  process      - Wait for, inspect, or interrupt an asynchronous bash process\n  generate_image - Generate an image with the configured image model and save it to the workspace
  update_session_state - Record/re-plan goal and plan status for each user turn
  ask_user     - Ask the user a question when explicitly requested
  confirm_user - Wait for user confirmation when explicitly requested
  submit_plan  - Submit a plan for approval in /plan mode
`);
}
