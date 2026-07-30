const REPETITIVE_TOOL_CALL_SUFFIX_WINDOW_CHARS = 1024;
const REPETITIVE_OUTPUT_SUFFIX_WINDOW_CHARS = 2048;
const MIN_REPETITIONS = 8;
const MAX_REPETITION_PERIOD_CHARS = 128;
const MAX_OUTPUT_REPETITION_PERIOD_CHARS = 1024;

export interface RepetitiveSuffix {
  period: number;
  start: number;
}

function findPeriodicSuffix(value: string, window: number, maxPeriod: number): RepetitiveSuffix | undefined {
  if (value.length < window) {
    return undefined;
  }

  const suffixStart = value.length - window;
  const effectiveMaxPeriod = Math.min(maxPeriod, Math.floor(window / MIN_REPETITIONS));
  for (let period = 1; period <= effectiveMaxPeriod; period++) {
    let repeats = true;
    for (let index = suffixStart + period; index < value.length; index++) {
      if (value[index] !== value[index - period]) {
        repeats = false;
        break;
      }
    }
    if (!repeats) {
      continue;
    }

    let start = suffixStart;
    while (start > 0 && value[start - 1] === value[start - 1 + period]) {
      start--;
    }
    return { period, start };
  }

  return undefined;
}

export function findRepetitiveToolCallSuffix(value: string): RepetitiveSuffix | undefined {
  return findPeriodicSuffix(value, REPETITIVE_TOOL_CALL_SUFFIX_WINDOW_CHARS, MAX_REPETITION_PERIOD_CHARS);
}

export function findRepetitiveOutputSuffix(value: string): RepetitiveSuffix | undefined {
  return findPeriodicSuffix(value, REPETITIVE_OUTPUT_SUFFIX_WINDOW_CHARS, MAX_OUTPUT_REPETITION_PERIOD_CHARS);
}

export function trimRepetitiveSuffix(value: string, repetition: RepetitiveSuffix): string {
  return value.slice(0, repetition.start + repetition.period * 2);
}
