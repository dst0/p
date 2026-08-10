const REPETITIVE_TOOL_CALL_SUFFIX_WINDOW_CHARS = 1024;
const REPETITIVE_OUTPUT_SUFFIX_WINDOW_CHARS = 2048;
const MIN_REPETITIONS = 8;
const MAX_REPETITION_PERIOD_CHARS = 128;
const MAX_OUTPUT_REPETITION_PERIOD_CHARS = 1024;
const REASONING_ACTION_LOOP_MIN_CHARS = 12_288;
const REASONING_ACTION_LOOP_WINDOW_CHARS = 24_576;
const REASONING_ACTION_LOOP_MIN_COMMITMENTS = 6;
const REASONING_ACTION_LOOP_MIN_RECONSIDERATIONS = 5;
const REASONING_ACTION_LOOP_MIN_CYCLES = 3;
const REASONING_ACTION_LOOP_MIN_SPAN_CHARS = 6_144;
const ACTION_COMMITMENT_PATTERN =
  /\b(?:let me|i(?:'ll| will)|i need to|now i(?:'ll| will)?)[^.!?\n]{0,120}\b(?:implement|write|create|code|coding|build|start)\b/gi;
const RECONSIDERATION_PATTERN =
  /\b(?:actually|but wait|wait[,;:]|one more (?:thing|thought)|one final thought|before i (?:do|write|implement|start)|think (?:about|more carefully)|be (?:very )?careful|clear picture|mental model)\b/gi;

export interface RepetitiveSuffix {
  period: number;
  start: number;
}

export interface ReasoningActionLoop {
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

export function findReasoningActionLoop(value: string): ReasoningActionLoop | undefined {
  if (value.length < REASONING_ACTION_LOOP_MIN_CHARS) {
    return undefined;
  }

  const windowStart = Math.max(0, value.length - REASONING_ACTION_LOOP_WINDOW_CHARS);
  const window = value.slice(windowStart);
  const precedingFenceCount = value.slice(0, windowStart).split("```").length - 1;
  const windowWithLeadingFence = precedingFenceCount % 2 === 0 ? window : `\`\`\`${window}`;
  const prose = windowWithLeadingFence
    .replace(/```[\s\S]*?(?:```|$)/g, (code) => " ".repeat(code.length))
    .slice(windowWithLeadingFence.length - window.length);
  const commitments = [...prose.matchAll(ACTION_COMMITMENT_PATTERN)].map((match) => match.index);
  const reconsiderations = [...prose.matchAll(RECONSIDERATION_PATTERN)].map((match) => match.index);
  if (
    commitments.length < REASONING_ACTION_LOOP_MIN_COMMITMENTS ||
    reconsiderations.length < REASONING_ACTION_LOOP_MIN_RECONSIDERATIONS ||
    commitments.at(-1)! - commitments[0]! < REASONING_ACTION_LOOP_MIN_SPAN_CHARS
  ) {
    return undefined;
  }

  const events = [
    ...commitments.map((index) => ({ index, kind: "commitment" as const })),
    ...reconsiderations.map((index) => ({ index, kind: "reconsideration" as const })),
  ].sort((left, right) => left.index - right.index);
  const alternatingEvents = events.filter((event, index) => index === 0 || event.kind !== events[index - 1]!.kind);
  let cycles = 0;
  for (let index = 2; index < alternatingEvents.length; index++) {
    if (
      alternatingEvents[index - 2]!.kind === "commitment" &&
      alternatingEvents[index - 1]!.kind === "reconsideration" &&
      alternatingEvents[index]!.kind === "commitment"
    ) {
      cycles += 1;
    }
  }
  if (cycles < REASONING_ACTION_LOOP_MIN_CYCLES) {
    return undefined;
  }

  return { start: windowStart + commitments[1]! };
}

export function trimRepetitiveSuffix(value: string, repetition: RepetitiveSuffix): string {
  return value.slice(0, repetition.start + repetition.period * 2);
}
