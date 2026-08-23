import { createBenchmarkRecording } from "./benchmark-recording-lifecycle.js";
import { benchmarkRecordingOptions } from "./benchmark-recording-options.js";

export const benchmarkRunnerRecordingFactory = Object.freeze({
  command(finalPath, options) {
    return createBenchmarkRecording(finalPath, benchmarkRecordingOptions(options));
  },
  task(finalPath, options) {
    return createBenchmarkRecording(finalPath, benchmarkRecordingOptions(options));
  },
});
