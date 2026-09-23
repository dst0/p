# Development

See [AGENTS.md](https://github.com/dst0/p/blob/main/AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/dst0/p
cd p
npm install
npm run build
```

Run from source:

```bash
npm run dev --
```

From another directory, pass the repository explicitly. P keeps the caller's current working directory:

```bash
npm --prefix /path/to/p run dev --
```

For a quicker alias during local development, add to `~/.zshrc`:

```bash
alias p='/path/to/p/packages/coding-agent/dist/cli.js'
```

After making code changes, run `./reinstall.sh` from the repo root to rebuild and relink. The script updates every npm-backed `p` command visible on `PATH` and verifies that each reports the newly built version, so another global checkout cannot silently shadow the reinstall in a different shell. This is the correct way to install — do not use `npm run build` + `npm link` manually.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "piConfig": {
    "name": "p",
    "configDir": ".p"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.p/agent/p-debug.log`:

- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
npm test                          # Run all workspace tests with current credentials/endpoints
npm run test:unit                 # Run non-e2e tests without API keys
npm run test:unit:coverage        # Run the non-e2e suite with coverage
npm run test:cli                  # Smoke-test source CLI execution
node ../../node_modules/vitest/dist/cli.js --run test/indexing-version.test.ts # Test indexing version hash
```

Coding-agent Vitest runs never use the real `~/.p/agent`. A global setup (`test/vitest-global-setup-agent-dir-root.ts`) creates one temporary root per run and deletes it at teardown; a per-file setup (`test/vitest-setup-isolated-agent-dir.ts`) points `P_CODING_AGENT_DIR` at a fresh directory inside that root and clears `P_CODING_AGENT_SESSION_DIR`. Default-path code such as `SessionManager.create(cwd)` without a session dir therefore writes into disposable storage. Tests that need specific agent-dir contents still set `P_CODING_AGENT_DIR` or pass `agentDir`/`sessionDir` explicitly.

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
