# Cross-Platform Engineering

Developing CLI tools that work flawlessly across macOS, Linux, and Windows requires abstracting OS-specific behaviors and relying on standard libraries.

## Core Differences

- **Path Separators:** Windows uses `\` (and supports `/` in many APIs), while POSIX uses `/`.
- **Path Delimiters:** Environment variables like `PATH` use `:` on POSIX (e.g., `/usr/bin:/bin`) and `;` on Windows (e.g., `C:\Windows;C:\Program Files`).
- **Line Endings:** Windows uses `\r\n` (CRLF), POSIX uses `\n` (LF). Always process strings robustly and configure git to handle line endings correctly (`core.autocrlf`).
- **Case Sensitivity:**
  - Linux: Strict case-sensitive (`File.txt` != `file.txt`).
  - Windows: Case-insensitive, but case-preserving.
  - macOS: Usually case-insensitive, but case-preserving (can be formatted as case-sensitive).

## Environment Variables

Accessing environment variables can be subtle across platforms.
- **PATH vs Path:** On Windows, environment variable names are case-insensitive. `PATH`, `Path`, and `path` refer to the same variable. On POSIX, they are distinct. Node.js `process.env` handles this somewhat on Windows, but libraries like `cross-env` help normalize behavior in scripts.
- **User Directories:**
  - Home Directory: `$HOME` on POSIX, `%USERPROFILE%` on Windows.
  - Temporary Directory: `$TMPDIR` / `/tmp` on POSIX, `%TEMP%` / `%TMP%` on Windows.
  - Use standard library functions (e.g., Python `pathlib.Path.home()`, Node.js `os.homedir()`, Rust `directories` crate) to resolve these rather than manual lookups.

## Shell Differences

When your tool needs to generate shell scripts, source environments, or execute commands via a shell (avoid if possible), you must account for the user's shell:
- **POSIX:** `bash`, `zsh` (macOS default), `fish`. Syntax is generally similar but diverges on advanced features (arrays, string manipulation).
- **Windows:**
  - `cmd.exe`: Legacy DOS syntax. Escaping rules are notoriously complex.
  - `PowerShell`: Object-oriented shell. Uses entirely different syntax and aliases.

## Binary Distribution

Distributing tools easily is key to adoption.
- **Rust/Go/C++:** Static linking is preferred. Compile a single binary that requires no runtime. Use cross-compilation targets to build for macOS, Linux, and Windows from a single CI pipeline.
- **Node.js:** Use tools like `pkg` or `nexe` to bundle the Node runtime and your JavaScript code into a single executable.
- **Python:** Use `PyInstaller` or `cx_Freeze` to package the Python interpreter and script into a standalone executable. Note that these often extract themselves to a temporary directory on startup, impacting cold-start time.

## Feature Detection vs Platform Detection

Prefer feature detection over explicit platform detection where possible.
- **Bad (Platform Detection):** `if (os === 'windows') { useWindowsLocking(); } else { usePosixLocking(); }`
- **Better (Feature Detection):** Try the operation, and handle the specific error if it's unsupported.

When platform detection is necessary (e.g., deciding where to store configuration files based on OS conventions like AppData vs ~/.config), abstract it early in the application lifecycle.
