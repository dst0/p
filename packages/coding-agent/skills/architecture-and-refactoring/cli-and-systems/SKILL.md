---
name: cli-and-systems
description: CLI design patterns, process management, filesystem operations, and cross-platform engineering. Use when building command-line tools, managing child processes, or handling file I/O across platforms.
---

# CLI and Systems Programming

Building robust, composable command-line tools and systems utilities requires careful consideration of conventions, environments, and resource management. A well-designed CLI tool behaves predictably, integrates seamlessly into larger pipelines, and handles system interactions safely across platforms.

## Core Philosophy: Composable Tools
Modern CLI tools should be designed for composability and automation, adhering to the Unix philosophy:
- **Do one thing well:** Focus on a single responsibility.
- **Expect the output to become the input of another program:** Use standard formats (like JSON) and avoid unnecessary formatting when piping.
- **Design for machines first, humans second:** Offer structured output (e.g., `--json`) and keep diagnostic information (logs, progress bars) strictly on `stderr`.

## Language Selection

Choose the right language based on the tool's requirements and deployment context:

### Rust
**Best for:** Standalone binaries, high performance, strict resource constraints, and reliable systems programming.
- **Pros:** Fast, statically typed, fearless concurrency, exceptional cross-platform compilation (via Cargo), zero-dependency binaries.
- **Cons:** Slower compilation times, steeper learning curve.
- **Example Use Cases:** Text processing tools (`ripgrep`), system daemons, fast development tooling (`swc`, `turborepo`).

### TypeScript / Node.js
**Best for:** Tools tightly integrated with the JavaScript ecosystem, web tooling, and rapid iteration.
- **Pros:** Massive package ecosystem (npm), shared code with web projects, excellent JSON and async handling.
- **Cons:** Requires a Node.js runtime, slower startup time, larger memory footprint.
- **Example Use Cases:** Scaffolding tools, bundlers, frontend deployment scripts.

### Python
**Best for:** Data manipulation, scripting, machine learning integration, and complex orchestration.
- **Pros:** Ubiquitous, immense standard library and scientific computing ecosystem, rapid prototyping.
- **Cons:** Dependency management challenges (virtual environments), slower execution speed, runtime deployment complexity.
- **Example Use Cases:** Data pipelines, sysadmin scripts, ML tooling, cloud infrastructure management (e.g., AWS CLI).

## Skill Modules

This skill encompasses several critical areas of systems programming and CLI design:

1. [CLI Design Patterns](./cli-design-patterns.md): Conventions, argument parsing, environment variables, exit codes, and standard streams.
2. [Process Management and IPC](./process-and-ipc.md): Spawning child processes, managing standard I/O pipes, and inter-process communication.
3. [Filesystem and I/O](./filesystem-and-io.md): Safe file operations, atomic writes, locking, and performance considerations.
4. [Cross-Platform Engineering](./cross-platform.md): Handling differences in paths, line endings, shells, and distribution across OSes.
