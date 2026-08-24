const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143 });

export class BenchmarkInterruptedError extends Error {
  constructor(signalName) {
    if (!Object.hasOwn(SIGNAL_EXIT_CODES, signalName)) throw new Error("Unsupported benchmark interruption signal");
    super(`benchmark interrupted by ${signalName}`);
    this.name = "BenchmarkInterruptedError";
    this.signalName = signalName;
  }
}

export function isBenchmarkInterruptedError(error) {
  return error instanceof BenchmarkInterruptedError;
}

export function attachBenchmarkCleanupError(interruption, cleanupError) {
  if (!isBenchmarkInterruptedError(interruption)) return cleanupError;
  if (!Object.hasOwn(interruption, "cleanupErrors")) {
    Object.defineProperty(interruption, "cleanupErrors", { value: [], enumerable: false });
  }
  interruption.cleanupErrors.push(cleanupError);
  return interruption;
}

export function benchmarkInterruptionFromSignal(signal) {
  if (!signal?.aborted) return undefined;
  return isBenchmarkInterruptedError(signal.reason)
    ? signal.reason
    : new BenchmarkInterruptedError("SIGTERM");
}

export function throwIfBenchmarkInterrupted(signal) {
  const interruption = benchmarkInterruptionFromSignal(signal);
  if (interruption) throw interruption;
}

export function createBenchmarkSignalController(target = process) {
  const controller = new AbortController();
  const handlers = Object.fromEntries(
    Object.entries(SIGNAL_EXIT_CODES).map(([signalName, exitCode]) => [
      signalName,
      () => {
        if (controller.signal.aborted) return;
        target.exitCode = exitCode;
        controller.abort(new BenchmarkInterruptedError(signalName));
      },
    ]),
  );
  for (const [signalName, handler] of Object.entries(handlers)) target.on(signalName, handler);
  return {
    signal: controller.signal,
    dispose() {
      for (const [signalName, handler] of Object.entries(handlers)) target.off(signalName, handler);
    },
  };
}

export async function runBenchmarkSignalAwareMain(main, target = process) {
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
