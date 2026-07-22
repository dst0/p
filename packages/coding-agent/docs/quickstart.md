# Quickstart

This page gets you from install to a useful first p session.

## Install

p is distributed as an npm package:

```bash
npm install -g --ignore-scripts @dst0/p
```

`--ignore-scripts` disables dependency lifecycle scripts during install. P does not require install scripts for normal npm installs.

### Uninstall

Use the package manager that installed p. The curl installer uses npm globally, so curl and npm installs are removed with npm:

```bash
# curl installer or npm install -g
npm uninstall -g @dst0/p

# pnpm
pnpm remove -g @dst0/p

# Yarn
yarn global remove @dst0/p

# Bun
bun uninstall -g @dst0/p
```

Uninstalling p leaves settings, credentials, sessions, and installed p packages in `~/.p/agent/`.

Then start p in the project directory you want it to work on:

```bash
cd /path/to/project
p
```

## Authenticate

P can use subscription providers through `/login`, or API-key providers through environment variables or the auth file.

### Option 1: subscription login

Start p and run:

```text
/login
```

Then select a provider. Built-in subscription logins include Claude Pro/Max, ChatGPT Plus/Pro (Codex), and GitHub Copilot.

### Option 2: API key

Set an API key before launching p:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
p
```

You can also run `/login` and select an API-key provider to store the key in `~/.p/agent/auth.json`.

See [Providers](providers.md) for all supported providers, environment variables, and cloud-provider setup.

## First session

Once p starts, type a request and press Enter:

```text
Summarize this repository and tell me how to run its checks.
```

By default, p gives the model core coding tools:

- `read` - read files
- `write` - create or overwrite files
- `edit` - patch files
- `bash` - run shell commands

Additional built-in tools include `sleep`, read-only tools (`grep`, `find`, `ls`), and interactive user-input tools (`ask_user`, `confirm_user`). Type `/plan` before a task when you want p to gather context, propose a plan, and wait for your approval before modifying anything; the footer shows `PLAN` until you approve the suggested plan. p runs in your current working directory and can modify files there. Use git or another checkpointing workflow if you want easy rollback.

## Give p project instructions

p loads context files at startup. Add an `AGENTS.md` file to tell it how to work in a project:

```markdown
# Project Instructions

- Run `npm run check` after code changes.
- Do not run production migrations locally.
- Keep responses concise.
```

p loads:

- `~/.p/agent/AGENTS.md` for global instructions
- `AGENTS.md` or `CLAUDE.md` from parent directories and the current directory

Restart p, or run `/reload`, after changing context files.

## Common things to try

### Reference files

Type `@` in the editor to fuzzy-search files, or pass files on the command line:

```bash
p @README.md "Summarize this"
p @src/app.ts @src/app.test.ts "Review these together"
```

Images can be pasted with Ctrl+V (Alt+V on Windows) or dragged into supported terminals.

### Run shell commands

In interactive mode:

```text
!npm run lint
```

The command output is sent to the model. Use `!!command` to run a command without adding its output to the model context.

### Switch models

Use `/model` or Ctrl+L to choose a model. Use Shift+Tab to cycle thinking level. Use Ctrl+P / Shift+Ctrl+P to cycle through scoped models.

### Continue later

Sessions are saved automatically:

```bash
p -c                  # Continue most recent session
p -r                  # Browse previous sessions
p --name "my task"    # Set session display name at startup
p --session <path|id> # Open a specific session
```

Inside p, use `/resume`, `/new`, `/tree`, `/fork`, and `/clone` to manage sessions.

### Non-interactive mode

For one-shot prompts:

```bash
p -p "Summarize this codebase"
cat README.md | p -p "Summarize this text"
p -p @screenshot.png "What's in this image?"
```

Use `--mode json` for JSON event output or `--mode rpc` for process integration.

## Next steps

- [Using p](usage.md) - interactive mode, slash commands, sessions, context files, and CLI reference.
- [Providers](providers.md) - authentication and model setup.
- [Settings](settings.md) - global and project configuration.
- [Keybindings](keybindings.md) - shortcuts and customization.
- [p Packages](packages.md) - install shared extensions, skills, prompts, and themes.

Platform notes: [Windows](windows.md), [Termux](termux.md), [tmux](tmux.md), [Terminal setup](terminal-setup.md), [Shell aliases](shell-aliases.md).
