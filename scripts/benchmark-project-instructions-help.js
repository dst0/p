export function printPairedBenchmarkHelp() {
  console.log(`Usage:
  npm run benchmark:project-instructions -- --model <provider/id> [options]

Run randomized, counterbalanced pairs against the same P build. Every pair runs
compiled and legacy project-instruction modes on a fresh copy of the same fixture.

Options:
  --model <provider/id>       P model alias (required)
  --compiler-model <provider/id> Project-instruction compiler (default: task model)
  --models-file <path>        models.json used by the isolated P configuration
  --task <id>                 Select a fixture; repeat to select multiple
  --runs <n>                  Paired repetitions, from 3 through 5 (default: 3)
  --seed <value>              Reproduce randomized pair order (random by default)
  --timeout-seconds <n>       Minimum per-cell timeout; raises shorter fixture caps
  --max-runtime-seconds <n>   Overall deadline (default: 54000)
  --output <dir>              Evidence directory
  --help                      Show this help

The harness stops on the first incomplete or incorrect sample. Token and runtime
medians are emitted only when every configured sample passes the correctness gate.
`);
}
