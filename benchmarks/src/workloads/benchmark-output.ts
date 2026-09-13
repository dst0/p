import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindCertifiedOutputRoot } from "../harness/certified-output-integrity.ts";
import { type RunnerOptions, repoRoot } from "./runner-options.ts";

export function createBenchmarkOutputPath(options: Pick<RunnerOptions, "certified" | "output">): string {
  if (options.output) {
    if (options.certified) prepareCertifiedExplicitOutput(options.output);
    if (options.certified) bindCertifiedOutputRoot(options.output);
    return options.output;
  }
  if (options.certified) {
    const output = mkdtempSync(join(tmpdir(), "p-certified-benchmark-"));
    chmodSync(output, 0o700);
    bindCertifiedOutputRoot(output);
    return output;
  }
  return join(repoRoot, "benchmarks", "results", new Date().toISOString().replaceAll(/[:.]/g, "-"));
}

function prepareCertifiedExplicitOutput(output: string): void {
  if (!existsSync(output)) mkdirSync(output, { mode: 0o700 });
  const stat = lstatSync(output);
  if (stat.isSymbolicLink()) throw new Error("Certified output must not be a symbolic link");
  if (!stat.isDirectory()) throw new Error("Certified output must be a directory");
  if ((stat.mode & 0o777) !== 0o700) throw new Error("Certified output directory must have mode 0700");
  if (readdirSync(output).length !== 0) throw new Error("Certified output directory must be empty");
  writeFileSync(join(output, ".p-benchmark-owner"), `${process.pid}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}
