import {
  BenchmarkCollectionOverflowError,
  createBoundedTextCapture,
  DEFAULT_BENCHMARK_OUTPUT_LIMITS,
} from "../harness/output-capture.ts";
import { captureRuntimeContextEvidence, captureUserTurnEvidence } from "./evidence.ts";

type RuntimeContextEvidence = NonNullable<ReturnType<typeof captureRuntimeContextEvidence>>;
type UserTurnEvidence = NonNullable<ReturnType<typeof captureUserTurnEvidence>>;
type EventCaptureOptions = {
  maxMetricBytes?: number;
  maxRuntimeContexts?: number;
  maxMetricEvents?: number;
  progressEventTypes?: ReadonlySet<string>;
  stopMarker?: string;
};
export type BenchmarkEventCapture = {
  metricEventCount: number;
  rawEventCount: number;
  runtimeContexts: RuntimeContextEvidence[];
  stopMarkerSeen: boolean;
  userTurns: UserTurnEvidence[];
  readonly metricOutput: string;
  process(line: string): boolean;
  skipNonMetricLine(): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function captureBenchmarkStreamLine(
  line: string,
  eventOrdinal: number,
  metricEventTypes: Set<string>,
  progressEventTypes: ReadonlySet<string>,
) {
  try {
    const event: unknown = JSON.parse(line);
    if (!isRecord(event)) return {};
    const runtimeContext = captureRuntimeContextEvidence(event, eventOrdinal);
    const userTurn = captureUserTurnEvidence(event, eventOrdinal);
    const eventType =
      typeof event.type === "string" ? event.type : typeof event.event === "string" ? event.event : undefined;
    if (eventType && metricEventTypes.has(eventType)) {
      event.benchmarkEventOrdinal = eventOrdinal;
      return {
        metricLine: `${JSON.stringify(event)}\n`,
        progress: progressEventTypes.has(eventType),
        runtimeContext,
        userTurn,
      };
    }
    return { progress: eventType !== undefined && progressEventTypes.has(eventType), runtimeContext, userTurn };
  } catch {
    return {};
  }
}

export function createBenchmarkEventCapture(
  metricEventTypes: Set<string>,
  eventOrdinalBase = 0,
  options: EventCaptureOptions = {},
): BenchmarkEventCapture {
  const metricOutput = createBoundedTextCapture(
    "metric output",
    options.maxMetricBytes ?? DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxMetricBytes,
  );
  const maxRuntimeContexts = options.maxRuntimeContexts ?? DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxRuntimeContexts;
  const maxMetricEvents = options.maxMetricEvents ?? DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxMetricEvents;
  const progressEventTypes = options.progressEventTypes ?? metricEventTypes;
  const capture = {
    metricEventCount: 0,
    rawEventCount: 0,
    runtimeContexts: [] as RuntimeContextEvidence[],
    stopMarkerSeen: false,
    userTurns: [] as UserTurnEvidence[],
    process: (_line: string) => false,
    skipNonMetricLine: () => undefined,
  } as BenchmarkEventCapture;
  Object.defineProperty(capture, "metricOutput", { get: () => metricOutput.value() });
  capture.process = (line: string) => {
    if (!line.trim()) return false;
    capture.rawEventCount += 1;
    const event = captureBenchmarkStreamLine(
      line,
      eventOrdinalBase + capture.rawEventCount,
      metricEventTypes,
      progressEventTypes,
    );
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
        throw new BenchmarkCollectionOverflowError("metric events", maxMetricEvents, capture.metricEventCount + 1);
      }
      capture.metricEventCount += 1;
      metricOutput.append(event.metricLine);
      if (options.stopMarker && event.metricLine.includes(options.stopMarker)) capture.stopMarkerSeen = true;
    }
    return event.progress === true;
  };
  capture.skipNonMetricLine = () => {
    capture.rawEventCount += 1;
  };
  return capture;
}
