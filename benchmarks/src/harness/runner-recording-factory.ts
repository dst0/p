import { createBenchmarkRecording } from "./recording-lifecycle.ts";
import type { BenchmarkRecordingOptionsInput } from "./recording-options.ts";
import { benchmarkRecordingOptions } from "./recording-options.ts";

export const benchmarkRunnerRecordingFactory = Object.freeze({
  command(finalPath: string, options: BenchmarkRecordingOptionsInput) {
    return createBenchmarkRecording(finalPath, benchmarkRecordingOptions(options));
  },
  task(finalPath: string, options: BenchmarkRecordingOptionsInput) {
    return createBenchmarkRecording(finalPath, benchmarkRecordingOptions(options));
  },
});
