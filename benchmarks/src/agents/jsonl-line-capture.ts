import { BenchmarkOutputOverflowError } from "../harness/output-capture.ts";
import { createStreamingJsonArrayValidator } from "./streaming-json-array.ts";

const CANONICAL_P_AGENT_END_PREFIX = '{"type":"agent_end","messages":[';
const CANONICAL_P_AGENT_END_SUFFIXES = [',"willRetry":false}', ',"willRetry":true}'] as const;

interface BenchmarkJsonlLineCaptureOptions {
  allowCanonicalPAgentEnd?: boolean;
  maxLineBytes: number;
  onLine(line: string): void;
  onOversizedNonMetricLine(): void;
}

export interface BenchmarkJsonlLineCapture {
  append(text: string): void;
  finish(text?: string): void;
}

interface CanonicalAgentEndTracker {
  append(text: string): void;
  readonly complete: boolean;
  readonly possible: boolean;
}

function createCanonicalAgentEndTracker(enabled: boolean): CanonicalAgentEndTracker {
  let prefixOffset = 0;
  let suffix = "";
  let possible = enabled;
  const messages = createStreamingJsonArrayValidator();

  const suffixIsPossible = (): boolean =>
    CANONICAL_P_AGENT_END_SUFFIXES.some((candidate) => candidate.startsWith(suffix));

  return {
    append(text) {
      if (!possible) return;
      for (const character of text) {
        if (prefixOffset < CANONICAL_P_AGENT_END_PREFIX.length) {
          if (character !== CANONICAL_P_AGENT_END_PREFIX[prefixOffset]) {
            possible = false;
            return;
          }
          prefixOffset += 1;
          continue;
        }
        if (messages.complete) {
          suffix += character;
          if (!suffixIsPossible()) {
            possible = false;
            return;
          }
          continue;
        }
        messages.append(character);
        if (!messages.possible) {
          possible = false;
          return;
        }
      }
    },
    get complete() {
      return (
        possible &&
        prefixOffset === CANONICAL_P_AGENT_END_PREFIX.length &&
        messages.complete &&
        CANONICAL_P_AGENT_END_SUFFIXES.some((candidate) => candidate === suffix)
      );
    },
    get possible() {
      return possible;
    },
  };
}

export function createBenchmarkJsonlLineCapture(options: BenchmarkJsonlLineCaptureOptions): BenchmarkJsonlLineCapture {
  let parts: string[] = [];
  let bytes = 0;
  let discarding = false;
  let pendingCarriageReturn = false;
  let canonicalAgentEnd = createCanonicalAgentEndTracker(options.allowCanonicalPAgentEnd === true);

  const overflow = (): BenchmarkOutputOverflowError =>
    new BenchmarkOutputOverflowError("stdout line", options.maxLineBytes, bytes);

  const reset = (): void => {
    parts = [];
    bytes = 0;
    discarding = false;
    canonicalAgentEnd = createCanonicalAgentEndTracker(options.allowCanonicalPAgentEnd === true);
  };

  const appendContent = (content: string): void => {
    if (!content) return;
    bytes += Buffer.byteLength(content, "utf8");
    canonicalAgentEnd.append(content);
    if (discarding) {
      if (!canonicalAgentEnd.possible) throw overflow();
      return;
    }
    parts.push(content);
    if (bytes <= options.maxLineBytes) return;
    if (!canonicalAgentEnd.possible) throw overflow();
    parts = [];
    discarding = true;
  };

  const completeLine = (): void => {
    if (discarding) {
      if (!canonicalAgentEnd.complete) throw overflow();
      options.onOversizedNonMetricLine();
    } else {
      options.onLine(parts.join(""));
    }
    reset();
  };

  const append = (text: string): void => {
    let offset = 0;
    if (pendingCarriageReturn && text.startsWith("\n")) {
      pendingCarriageReturn = false;
      completeLine();
      offset = 1;
    } else if (pendingCarriageReturn && text.length > 0) {
      pendingCarriageReturn = false;
      appendContent("\r");
    }
    while (offset < text.length) {
      const lineFeed = text.indexOf("\n", offset);
      if (lineFeed < 0) {
        const tail = text.slice(offset);
        if (tail.endsWith("\r")) {
          appendContent(tail.slice(0, -1));
          pendingCarriageReturn = true;
        } else {
          appendContent(tail);
        }
        return;
      }
      const line = text.slice(offset, lineFeed);
      appendContent(line.endsWith("\r") ? line.slice(0, -1) : line);
      completeLine();
      offset = lineFeed + 1;
    }
  };

  return {
    append,
    finish(text = "") {
      append(text);
      if (pendingCarriageReturn) {
        pendingCarriageReturn = false;
        appendContent("\r");
      }
      if (discarding) throw overflow();
      if (bytes > 0) options.onLine(parts.join(""));
      reset();
    },
  };
}
