# CLI Design Patterns

A robust CLI tool follows established conventions to ensure predictability and interoperability within the command-line ecosystem.

## POSIX Conventions

Adhering to POSIX standards makes tools feel native to experienced users.

- **Short Flags:** Single character, prefixed with a single dash (e.g., `-v`, `-f`).
- **Long Flags:** Descriptive words, prefixed with a double dash (e.g., `--verbose`, `--force`).
- **Flag Combining:** Short flags without arguments can often be combined (e.g., `rm -rf` is equivalent to `rm -r -f`).
- **Standard Flags:** Always implement `--help` (or `-h`) and `--version` (or `-V` / `-v`).
- **The `--` Separator:** Use `--` to indicate the end of options. Anything following `--` should be treated as a positional argument, even if it starts with a dash (e.g., `rm -- -filename`).

## Subcommand Architecture

Complex tools use subcommands to group related functionality, similar to `git` or `cargo`.
- Example: `mytool [global-options] <command> [command-options] [arguments]`
- e.g., `git --git-dir=.git commit -m "Message"`

## Exit Codes

Exit codes communicate success or failure to the calling shell or script.
- **`0`**: Success.
- **`1`**: General error (catch-all).
- **`2`**: Misuse of shell builtins or CLI usage error (e.g., invalid arguments).
- **`126`**: Command invoked cannot execute (permission denied).
- **`127`**: Command not found.
- **`128 + N`**: Fatal error signal `N` (e.g., killed by SIGKILL (9) = 137).

## Standard Streams

Strictly separate output streams to enable composability.

- **`stdout` (Standard Output):** Reserved *exclusively* for the primary data output of the tool. If your tool generates a list of files, only the filenames go here. This allows piping output to other tools (e.g., `mytool list | grep 'pattern'`).
- **`stderr` (Standard Error):** Used for all diagnostic information, logs, warnings, errors, and interactive UI elements like progress bars.

```typescript
// TypeScript Example
console.log(JSON.stringify(data)); // Data goes to stdout
console.error("Warning: Deprecated option used."); // Diagnostics to stderr
```

## Interactive vs Non-Interactive Detection

Detect if the tool is running in a terminal (TTY) to decide whether to show interactive elements (colors, progress bars, prompts).

```python
# Python Example
import sys

if sys.stdout.isatty():
    # Running in a terminal, safe to show progress bar
    show_progress_bar()
else:
    # Output is piped or redirected, use simple logging or be quiet
    log_simple_status()
```

## Color and Formatting

Respect user preferences for terminal output formatting.
- **Check `NO_COLOR`**: If the `NO_COLOR` environment variable is set (to anything), disable all colors.
- **Check `TERM`**: If `TERM=dumb`, disable colors and advanced formatting.
- **Check `FORCE_COLOR`**: If set, force color output even if not connected to a TTY.

## Configuration Hierarchy

Determine configuration values using a predictable precedence order (highest to lowest):
1. **CLI Flags** (e.g., `--port 8080`)
2. **Environment Variables** (e.g., `PORT=8080`)
3. **Configuration Files** (e.g., `.mytoolrc` or `~/.config/mytool/config.toml`)
4. **Default Values** (Hardcoded defaults)

## Progress Reporting

When operations take time, provide feedback.
- **Use `stderr`:** Always write progress bars to `stderr` so they don't corrupt piped output on `stdout`.
- **Provide `--quiet` (`-q`):** Allow suppressing all non-essential output, including progress bars.
- **Provide `--verbose` (`-v`, `-vv`):** Allow increasing diagnostic output verbosity.

## Signal Handling

Gracefully handle termination signals to clean up resources (temporary files, network connections, child processes).

```rust
// Rust Example (using `ctrlc` crate)
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn main() {
    let running = Arc::new(AtomicBool::new(true));
    let r = running.clone();

    ctrlc::set_handler(move || {
        eprintln!("Received Ctrl-C, shutting down gracefully...");
        r.store(false, Ordering::SeqCst);
    }).expect("Error setting Ctrl-C handler");

    while running.load(Ordering::SeqCst) {
        // Do work...
    }
}
```

## Argument Parsing Libraries

Don't write your own parser; use robust ecosystem libraries.
- **Node.js:** `commander`, `yargs`, `mri`.
- **Rust:** `clap` (feature-rich, macro-based or builder-based), `structopt` (legacy, merged into `clap`).
- **Python:** `argparse` (standard library), `click` (decorator-based, excellent for subcommands), `typer` (type-hint based, built on click).
