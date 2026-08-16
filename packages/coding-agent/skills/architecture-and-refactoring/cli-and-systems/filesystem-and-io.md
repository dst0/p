# Filesystem and I/O

Safe and efficient file operations are critical for systems tools. Mishandling file I/O can lead to data corruption, race conditions, and performance bottlenecks.

## Atomic File Writes

When writing data to a file, especially configuration or state files, you must ensure the file is never left in an incomplete or corrupted state if the program crashes or loses power midway through the write.

**The Write-to-Temp-and-Rename Pattern:**
1. Write the new content to a temporary file in the *same filesystem/directory*.
2. Ensure the data is flushed to disk (e.g., `fsync`).
3. Atomically rename the temporary file over the target file. POSIX `rename()` is atomic.

```python
import os
import tempfile

def atomic_write(filepath, content):
    dirname = os.path.dirname(filepath)
    # Create temp file in the same directory to ensure atomic rename
    fd, temp_path = tempfile.mkstemp(dir=dirname)
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno()) # Ensure data is on disk
        os.replace(temp_path, filepath) # Atomic rename (overwrites)
    except Exception:
        os.remove(temp_path) # Cleanup on failure
        raise
```

## File Locking

When multiple processes might access the same file concurrently, use locking to prevent race conditions.
- **Advisory Locks (e.g., `flock`):** Require all participating processes to politely check for the lock before accessing the file. (Standard in Unix).
- **Mandatory Locks:** Enforced by the OS on every read/write. (Often problematic and disabled on modern systems).

```rust
// Rust Example using `fs4` crate for flock
use std::fs::File;
use fs4::FileExt;

let mut file = File::create("data.db").unwrap();
file.lock_exclusive().unwrap(); // Blocks until lock is acquired
// ... write to file ...
file.unlock().unwrap();
```

## Watch and Notify Patterns

To react to filesystem changes efficiently without polling (which wastes CPU and battery), use OS-level notification APIs.
- **Linux:** `inotify`
- **macOS:** `FSEvents`
- **BSD/macOS:** `kqueue`
- **Windows:** `ReadDirectoryChangesW`
- **Abstraction:** Always use a cross-platform library (like `chokidar` in Node.js, `notify` in Rust, or `watchdog` in Python) to abstract these underlying APIs.

## Large File Handling

Never read large files entirely into memory (e.g., `fs.readFileSync`).
- **Streaming:** Process data in chunks. Use streams (Node.js), Iterators (Rust `BufReader`), or generators (Python) to keep memory footprint low and constant.
- **Memory-Mapped I/O (`mmap`):** Maps a file directly into the process's address space. The OS handles paging data in and out of memory. Highly efficient for random access on large files.

## Path Handling Pitfalls

- **Unicode Normalization:** macOS normalizes filenames to a decomposed form (NFD). Other systems usually use NFC. This can cause path mismatch errors if you compare string literals.
- **Windows vs POSIX:** Always use platform-aware path building functions (`path.join` in Node.js, `PathBuf` in Rust, `os.path.join` or `pathlib` in Python) instead of hardcoding `/` or `\`.
- **Symlink Resolution:** Be aware of symlinks. Functions like `realpath` resolve symlinks to their absolute targets. When traversing directories, decide whether to follow symlinks to avoid infinite loops.

## Temporary Files and Cleanup

Always clean up temporary files and directories.
- **RAII (Resource Acquisition Is Initialization):** In Rust or C++, tie the temporary file's lifecycle to a struct that deletes it in its `Drop` implementation (e.g., the `tempfile` crate).
- **`try/finally` blocks:** In Python/TypeScript, ensure deletion happens in the `finally` block.
- **`atexit` handlers:** Register cleanup functions to run when the program exits, though these may not run on harsh terminations (e.g., SIGKILL).

## Final Newline Termination (POSIX & Diff Hygiene)

Unless a format specification explicitly requires the absence of a trailing newline, all text files (source code, JSON, JSONL, Markdown, YAML, configuration files) should terminate with a single newline (`\n`).

### Rationale:
1. **Clean Version Control Diffs (The Trailing Comma Principle):** Just as trailing commas in multi-line JavaScript/TypeScript objects prevent modifying previous lines when adding new properties, ending a file with a newline ensures that appending new code or records only adds new lines (`+ added_line`), rather than causing unnecessary diff churn (`- old_last_line`, `+ old_last_line\n+ added_line`).
2. **POSIX Line Definition:** Under IEEE Std 1003.1 (POSIX), a text line is strictly defined as a sequence of zero or more non-newline characters *terminated by a newline*. Files lacking a trailing newline end with an incomplete line, which causes issues with standard Unix stream processors (`cat`, `sed`, `awk`, `wc -l`).
3. **No-Newline Warnings:** Git and linters explicitly flag missing trailing newlines with `\ No newline at end of file`.

