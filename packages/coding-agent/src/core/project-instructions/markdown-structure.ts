export interface MarkdownFenceState {
  character?: "`" | "~";
  length: number;
}

export type MarkdownFenceEvent = "open" | "inside" | "close";

export function createMarkdownFenceState(): MarkdownFenceState {
  return { length: 0 };
}

export function consumeMarkdownFence(line: string, state: MarkdownFenceState): MarkdownFenceEvent | undefined {
  if (state.character) {
    const closing = /^ {0,3}(`{3,}|~{3,})\s*$/u.exec(line)?.[1];
    if (closing?.[0] === state.character && closing.length >= state.length) {
      state.character = undefined;
      state.length = 0;
      return "close";
    }
    return "inside";
  }
  const opening = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
  if (!opening) return undefined;
  state.character = opening[0] as "`" | "~";
  state.length = opening.length;
  return "open";
}

export function getMarkdownHeadingMarker(line: string): string | undefined {
  return /^ {0,3}(#{1,6})\s+\S/u.exec(line)?.[1];
}
