import {
  captureRuntimeContextEvidence,
  captureUserTurnEvidence,
} from "./benchmark-project-instruction-evidence.js";
import {
  BenchmarkCollectionOverflowError,
  DEFAULT_BENCHMARK_OUTPUT_LIMITS,
  createBoundedTextCapture,
} from "./benchmark-output-capture.js";

function captureBenchmarkStreamLine(line, eventOrdinal, metricEventTypes) {
  try {
    const event = JSON.parse(line);
    const runtimeContext = captureRuntimeContextEvidence(event, eventOrdinal);
    const userTurn = captureUserTurnEvidence(event, eventOrdinal);
    if (metricEventTypes.has(event?.type ?? event?.event)) {
      event.benchmarkEventOrdinal = eventOrdinal;
      return { metricLine: `${JSON.stringify(event)}\n`, runtimeContext, userTurn };
    }
    return { runtimeContext, userTurn };
  } catch {
    return {};
  }
}

export function createBenchmarkEventCapture(metricEventTypes, eventOrdinalBase = 0, options = {}) {
  const metricOutput = createBoundedTextCapture(
    "metric output",
    options.maxMetricBytes ?? DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxMetricBytes,
  );
  const maxRuntimeContexts = options.maxRuntimeContexts ?? DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxRuntimeContexts;
  const maxMetricEvents = options.maxMetricEvents ?? DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxMetricEvents;
  const capture = {
    metricEventCount: 0,
    rawEventCount: 0,
    runtimeContexts: [],
    stopMarkerSeen: false,
    userTurns: [],
  };
  Object.defineProperty(capture, "metricOutput", { get: () => metricOutput.value() });
  capture.process = (line) => {
    if (!line.trim()) return;
    capture.rawEventCount += 1;
    const event = captureBenchmarkStreamLine(line, eventOrdinalBase + capture.rawEventCount, metricEventTypes);
    if (event.runtimeContext) {
      if (capture.runtimeContexts.length >= maxRuntimeContexts) {
        throw new BenchmarkCollectionOverflowError(
          "runtime contexts",
          maxRuntimeContexts,
          capture.runtimeContexts.length + 1,
        );
      }
      capture.runtimeContexts.push(event.runtimeContext);
    }
    if (event.userTurn && capture.userTurns.length === 0) capture.userTurns.push(event.userTurn);
    if (event.metricLine) {
      if (capture.metricEventCount >= maxMetricEvents) {
        throw new BenchmarkCollectionOverflowError(
          "metric events",
          maxMetricEvents,
          capture.metricEventCount + 1,
        );
      }
      capture.metricEventCount += 1;
      metricOutput.append(event.metricLine);
      if (options.stopMarker && event.metricLine.includes(options.stopMarker)) capture.stopMarkerSeen = true;
    }
  };
  return capture;
}
