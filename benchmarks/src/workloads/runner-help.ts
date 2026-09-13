export function printRunnerHelp(defaults: {
  supportedAgents: readonly string[];
  defaultPiVersion: string;
  defaultKiloVersion: string;
  defaultTimeoutSeconds: number;
  defaultMaxRuntimeSeconds: number;
  defaultKiloStartupTimeoutSeconds: number;
}): void {
  console.log(`Usage:
  npm run benchmark:agents -- --model <provider/id> [options]

Compare this checkout (p) with PI and optional Kilo, Codex, and AGY CLIs, using the same
underlying model and four deterministic TypeScript coding fixtures, including
transactional event sourcing and an extreme durable workflow/saga challenge.

Options:
  --model <provider/id>       PI/P model alias (required when either is selected)
  --p-cli <path>              P CLI entry point (default: this checkout's build)
  --agents <list>             Comma-separated sequential order
                              (default: pi,p; supported: ${defaults.supportedAgents.join(",")})
  --models-file <path>        Custom models.json copied into temporary agent dirs
                              (default: ~/.p/agent/models.json)
  --pi-version <ver>          PI package version (default: ${defaults.defaultPiVersion})
  --pi-executable <path>      Pi executable entry point
  --kilo-model <provider/id>  Kilo model alias (required when Kilo is selected)
  --kilo-version <ver>        Required installed Kilo version (default: ${defaults.defaultKiloVersion})
  --kilo-config <path>        Kilo config copied into an isolated temporary XDG home
                              (default: ~/.config/kilo/kilo.jsonc)
  --kilo-executable <path>    Kilo executable entry point
  --expected-resolved-model <provider/id>
                              Backend model Kilo must resolve before fixtures start
  --kilo-startup-timeout-seconds <n>
                              Bounded timeout for each Kilo startup probe
                              (default: ${defaults.defaultKiloStartupTimeoutSeconds})
  --codex-model <provider/id> Codex model alias (required when Codex is selected)
  --codex-config <path>       Codex config.toml (default: ~/.codex/config.toml)
  --agy-model <model-id>      Google Antigravity model (required when AGY is selected)
  --task <id>                 Run only one fixture (optional)
  --project-instructions <mode> P-only mode: compiled, legacy, or off
  --task-verification <mode>   P-only verification: evidence, audit, or off
  --project-instruction-compiler-model <provider/id> Dedicated P compiler model
  --project-instructions-file <path> Authoritative source copied into each P fixture
  --thinking <level>           P reasoning level: off, minimal, low, medium, high, or xhigh
  --certified                 Require p, pi, kilo across all 4 tasks and >=3 runs
  --certified-network-host <host[:port]>
                              Repeat per required LLM endpoint; all other network egress is denied
  --max-duration-ratio <n>    Maximum allowed P / baseline duration ratio (default: 1.0)
  --max-token-ratio <n>       Maximum allowed P / baseline token ratio (default: 1.0)
  --max-cost-ratio <n>        Maximum allowed P / baseline cost ratio (opt-in)
  --runs <n>                  Complete repetitions (default: 1, certified requires >= 3)
  --timeout-seconds <n>       Per-agent nominal budget and semantic-inactivity watchdog
                              (default: ${defaults.defaultTimeoutSeconds})
  --minimum-timeout-seconds <n> Raise shorter fixture timeouts to at least this value
  --max-runtime-seconds <n>   Overall deadline (exploratory default: ${defaults.defaultMaxRuntimeSeconds};
                              certified default is derived from the complete matrix)
  --output <dir>              Results directory (default: benchmarks/results/<timestamp>)
  --help                      Show this help

Each result directory contains compressed JSONL session recordings, stderr logs, the
final fixture workspaces, results.json, and report.md. No real session files
are created; auth and model configuration are copied only to a temporary
directory and removed when the benchmark exits.
`);
}
