const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143 });
type BenchmarkSignalName = keyof typeof SIGNAL_EXIT_CODES;

export class BenchmarkInterruptedError extends Error {
  readonly signalName: BenchmarkSignalName;
  cleanupErrors?: unknown[];

  constructor(signalName: BenchmarkSignalName) {
    if (!Object.hasOwn(SIGNAL_EXIT_CODES, signalName)) throw new Error("Unsupported benchmark interruption signal");
    super(`benchmark interrupted by ${signalName}`);
    this.name = "BenchmarkInterruptedError";
    this.signalName = signalName;
  }
}

export function isBenchmarkInterruptedError(error: unknown): error is BenchmarkInterruptedError {
  return error instanceof BenchmarkInterruptedError;
}

export function attachBenchmarkCleanupError(interruption: unknown, cleanupError: unknown): unknown {
  if (!isBenchmarkInterruptedError(interruption)) return cleanupError;
  if (!Array.isArray(interruption.cleanupErrors)) {
    Object.defineProperty(interruption, "cleanupErrors", { value: [], enumerable: false });
  }
  interruption.cleanupErrors?.push(cleanupError);
  return interruption;
}

export function benchmarkInterruptionFromSignal(
  signal: AbortSignal | undefined,
): BenchmarkInterruptedError | undefined {
  if (!signal?.aborted) return undefined;
  return isBenchmarkInterruptedError(signal.reason) ? signal.reason : new BenchmarkInterruptedError("SIGTERM");
}

export function throwIfBenchmarkInterrupted(signal: AbortSignal | undefined): void {
  const interruption = benchmarkInterruptionFromSignal(signal);
  if (interruption) throw interruption;
}

export function createBenchmarkSignalController(target: Pick<NodeJS.Process, "on" | "off" | "exitCode"> = process): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const handler =
    (signalName: BenchmarkSignalName): (() => void) =>
    () => {
      if (controller.signal.aborted) return;
      target.exitCode = SIGNAL_EXIT_CODES[signalName];
      controller.abort(new BenchmarkInterruptedError(signalName));
    };
  const handlers: Record<BenchmarkSignalName, () => void> = {
    SIGINT: handler("SIGINT"),
    SIGTERM: handler("SIGTERM"),
  };
  for (const signalName of Object.keys(handlers) as BenchmarkSignalName[]) {
    target.on(signalName, handlers[signalName]);
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const signalName of Object.keys(handlers) as BenchmarkSignalName[]) {
        target.off(signalName, handlers[signalName]);
      }
    },
  };
}

export async function runBenchmarkSignalAwareMain(
  main: (signal: AbortSignal) => Promise<void>,
  target: Pick<NodeJS.Process, "on" | "off" | "exitCode"> = process,
): Promise<void> {
  const controller = createBenchmarkSignalController(target);
  try {
    await main(controller.signal);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (!isBenchmarkInterruptedError(error)) target.exitCode = 1;
  } finally {
    controller.dispose();
  }
}
