# Process Management and IPC

Command-line tools often orchestrate other programs or run long-lived background tasks. Safe process management prevents resource leaks, deadlocks, and security vulnerabilities.

## Subprocess Execution

### Node.js: `child_process`
- **`exec`**: Buffers output into memory. Use only for short commands with small output. Vulnerable to shell injection if inputs aren't sanitized.
- **`spawn`**: Streams output. Ideal for long-running processes or large data. Does not run in a shell by default.
- **`fork`**: Specifically for spawning new Node.js processes, providing a built-in IPC channel.

```typescript
import { spawn } from 'node:child_process';

// spawn does NOT use a shell by default, preventing shell injection
const child = spawn('ls', ['-l', '/var/log']);

child.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
});

child.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
});
```

### Rust: `std::process::Command`
- **`status()`**: Waits for the child and returns the exit status. Inherits standard streams (output goes to terminal).
- **`output()`**: Waits for the child and collects `stdout` and `stderr` into memory.
- **`spawn()`**: Starts the child and returns immediately, returning a `Child` handle for asynchronous management.

```rust
use std::process::Command;

let mut child = Command::new("sleep")
    .arg("5")
    .spawn()
    .expect("failed to execute child");

let status = child.wait().expect("failed to wait on child");
assert!(status.success());
```

### Python: `subprocess`
- **`subprocess.run()`**: The recommended way to run commands. Use `capture_output=True` to get stdout/stderr.
- **`subprocess.Popen()`**: For advanced use cases requiring asynchronous interaction with the process streams.
- **CRITICAL:** Always use `shell=False` (the default) unless absolutely necessary. If `shell=True`, sanitize all inputs using `shlex.quote()`.

```python
import subprocess

# Safe execution without a shell
result = subprocess.run(["ls", "-l", "/tmp"], capture_output=True, text=True, check=True)
print(result.stdout)
```

## Pipe Buffering and Deadlocks

When connecting processes via pipes (e.g., reading a child's stdout while writing to its stdin), beware of deadlocks.
OS pipes have a fixed buffer size (often 64KB on Linux).
- If the child writes more than the buffer size to stdout, it blocks until the parent reads it.
- If the parent is simultaneously blocked trying to write to the child's stdin (which is full), both processes hang indefinitely.
- **Solution:** Use asynchronous I/O, threads, or higher-level abstractions (like Python's `Popen.communicate()`) to read and write concurrently.

## Inter-Process Communication (IPC)

When processes need to exchange complex data or coordinate:

- **Standard Streams (stdin/stdout):** Best for linear pipelines and simple text/JSON data.
- **Named Pipes (FIFOs):** Appear as files on the filesystem but exist in memory. Allows communication between unrelated processes.
- **Unix Domain Sockets:** Bidirectional stream communication (like TCP) but restricted to the local filesystem. Highly efficient and allows passing file descriptors between processes.
- **Shared Memory:** Fastest IPC method, but requires careful synchronization (mutexes, semaphores) to avoid race conditions.

## Daemon Patterns

Creating background services (daemons) requires specific techniques to detach from the controlling terminal.

- **Double Fork:** The traditional POSIX way to orphan a process and detach it from the session leader.
- **PID Files:** Write the process ID to a file (e.g., `/var/run/mydaemon.pid`) to ensure only one instance runs and to allow easily sending signals to it (e.g., `kill $(cat daemon.pid)`).
- **Modern Approach:** Instead of daemonizing internally, write a standard CLI application that runs in the foreground and let modern init systems like **systemd** (Linux) or **launchd** (macOS) manage daemonization, restarts, and logging.
