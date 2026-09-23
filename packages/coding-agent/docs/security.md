# Security

P is a local coding agent. It runs with the permissions of the user account that starts it, and it treats files writable by that user as inside the same local trust boundary.

## Project Trust

Project trust controls whether p loads project-local settings, resources, packages, and extensions. It is not a sandbox and it does not restrict what the model can ask tools to do after you start working in a directory.

P considers a project to have resources that require trust when it finds any of these from the current working directory:

- `.p/settings.json`
- `.p/extensions`, `.p/skills`, `.p/prompts`, or `.p/themes`
- `.p/SYSTEM.md` or `.p/APPEND_SYSTEM.md`
- project `.agents/skills` in the current directory or an ancestor directory

A bare `.p` directory does not count as a project resource that requires trust.

When an interactive session starts in a project with resources that require trust and no saved decision for the current directory or a parent directory, p follows `defaultProjectTrust` from global settings. The default value is `"ask"`, which asks whether to trust the project when UI is available. Saved decisions are stored by canonical directory in `~/.p/agent/trust.json`, and the closest saved decision on the current or parent path applies before the global default.

Trusting a project allows p to load project resources that require trust, including:

- `.p/settings.json`
- `.p` resources such as extensions, skills, prompt templates, themes, and system prompt files
- missing project packages configured through project settings
- project-local extensions and project package-managed extensions

Declining trust skips protected resources. `AGENTS.md` and `CLAUDE.md` context files are loaded regardless of project trust unless context loading is disabled. Before trust is resolved, p only loads context files, user/global extensions, and CLI `-e` extensions. User/global and CLI extensions can handle the `project_trust` event; the first extension that returns a yes/no decision owns the decision.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, `defaultProjectTrust: "ask"` and `"never"` ignore such resources, while `"always"` trusts them. Use `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

## No Built-in Sandbox

P does not include a built-in sandbox. Built-in tools can read files, write files, edit files, and run shell commands with the permissions of the p process. Extensions are TypeScript modules that run with the same permissions. Package installs, shell commands, language servers, test commands, and other developer tools behave as ordinary local processes.

This is intentional. P is designed to operate on local source trees, invoke project toolchains, and integrate with the user's existing development environment. A partial in-process sandbox would be easy to misunderstand as a security boundary while still depending on the host shell, filesystem, package managers, credentials, and extension code. Real isolation needs to come from the operating system or a virtualization/container boundary.

Project trust is only an input-loading guard. It prevents a repository from silently changing p's settings or extensions before you approve it. It does not make untrusted code, untrusted prompts, or untrusted model output safe. Prompt injection from repository files, comments, documentation, context files, or build output is expected local-agent risk and cannot be reliably prevented by p.

## Running Untrusted or Unmonitored Work

For untrusted repositories, generated code you do not intend to monitor closely, or unattended automation, run p in a contained environment. Use a container, VM, micro-VM, remote sandbox, or policy-controlled sandbox with only the files and credentials required for the task.

Common patterns are documented in [Containerization](containerization.md):

- run the whole `p` process inside a container/sandbox
- run host p while routing built-in tool execution into a Gondolin micro-VM
- mount only the workspace paths the agent should access
- avoid mounting host `~/.p/agent` unless the container should access host sessions, settings, and credentials
- pass the minimum required API keys or use short-lived credentials
- restrict network access when the task does not need it
- review diffs and outputs before copying results back to trusted systems

If you bind-mount a host workspace read/write, writes from inside the container or VM can still modify host files. Use read-only mounts or copy files into and out of the sandbox when you need stronger protection from unintended writes.

## Update Source and Project Endpoints

`p update` reinstalls `@dst0/p` in place with the package manager that installed it. The update check reads the latest version from p's own npm registry entry (`https://registry.npmjs.org/@dst0%2fp/latest`) and, only when that version is newer, reads release notes from the fork's GitHub releases (`https://api.github.com/repos/dst0/p/releases/tags/v<version>`). No response can change which package is installed, and self-update never uninstalls p to install another package.

When the check found a newer version, `p update` installs exactly that version (`@dst0/p@<version>`), so a lagging registry mirror cannot silently reinstall the old release, and it reports an error instead of success if the installed version still differs. Self-update runs with `--ignore-scripts` and turns off the package manager's minimum-release-age cooldown (`--min-release-age=0` for npm, `--config.minimumReleaseAge=0` for pnpm, `--minimum-release-age=0` for Bun) so the announced release can install. That override applies to the whole install: npm honors the `npm-shrinkwrap.json` published with p, which pins every dependency version, but pnpm and Bun do not read it, so their dependency resolution also skips the cooldown.

p's own network endpoints (update check, release notes, install/update telemetry, `/share` viewer links, and provider attribution headers) use only hosts the project controls: the npm registry entry for `@dst0/p`, `github.com/dst0/p`, and `p-agent.pages.dev`. Upstream pi endpoints are never contacted. `p-agent.pages.dev` does not serve the install telemetry endpoint or a `/share` session viewer yet; the telemetry ping is fire-and-forget, so nothing is recorded.

### Known issue: p ≤ 5.0.2 self-update

p 5.0.2 and every earlier release check for updates at upstream pi's version endpoint and follow the package name it returns. That endpoint currently names upstream's `@earendil-works/pi-coding-agent`, so on those versions a bare `p update` or `p update --self` uninstalls `@dst0/p` and installs the upstream package instead. On p 5.0.2 or earlier, never run a bare `p update`. Update with `p update --self --force`, which skips the version check and reinstalls `@dst0/p`, or reinstall directly with `npm i -g --ignore-scripts @dst0/p@latest`. Releases after 5.0.2 read the version from p's own npm registry entry and always reinstall `@dst0/p`.

## Reporting Security Issues

To report a security issue, follow the repository [Security Policy](https://github.com/dst0/p/blob/main/SECURITY.md). Do not open a public issue for security-sensitive reports.

Expected local-agent behavior, lack of a built-in sandbox, prompt injection from untrusted content, and behavior of user-installed extensions or skills are generally outside the security boundary unless the report demonstrates a real privilege-boundary bypass or shows how p grants access that the local user did not already have.
