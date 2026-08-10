import type { SelectListTheme } from "../select-list.ts";

export interface TextChunk {
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface EditorState {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
}

export interface LayoutLine {
  text: string;
  hasCursor: boolean;
  cursorPos?: number;
}

export interface EditorTheme {
  borderColor: (str: string) => string;
  selectList: SelectListTheme;
}

export interface EditorOptions {
  paddingX?: number;
  autocompleteMaxVisible?: number;
}
