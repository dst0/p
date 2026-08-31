export function printPairedBenchmarkHelp() {
  console.log(`Usage:
  npm run benchmark:project-instructions -- --model <provider/id> [options]

Run randomized, counterbalanced three-condition blocks against the same P build.
Every block runs legacy/evidence, compiled/evidence, and compiled/audit on fresh
copies of the same fixture.

Options:
  --model <provider/id>       P model alias (required)
  --compiler-model <provider/id> Project-instruction compiler (default: task model)
  --models-file <path>        models.json used by the isolated P configuration
  --task <id>                 Select a fixture; repeat to select multiple
  --runs <n>                  Block repetitions, from 3 through 5 (default: 3)
  --seed <value>              Reproduce randomized condition order (random by default)
  --timeout-seconds <n>       Minimum per-cell timeout; raises shorter fixture caps
  --max-runtime-seconds <n>   Overall deadline (default: 54000)
  --thinking <level>          P reasoning level: off, minimal, low, medium, high, or xhigh
  --output <dir>              Evidence directory
  --help                      Show this help

The harness stops on the first incomplete or incorrect sample. Token and runtime
medians require every repetition of all three conditions on all four canonical tasks.
`);
}
