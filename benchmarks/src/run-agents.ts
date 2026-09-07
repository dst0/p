#!/usr/bin/env node
import { runBenchmarkSignalAwareMain } from "./harness/interruption.ts";
import { runAgentBenchmark } from "./workloads/benchmark-run.ts";

await runBenchmarkSignalAwareMain(runAgentBenchmark);
