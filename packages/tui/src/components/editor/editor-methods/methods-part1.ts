import type { AutocompleteProvider } from "../../../autocomplete.ts";
import { graphemeSegmenter, wordSegmenter } from "../constants.ts";
import type { Editor } from "../editor.ts";
import { segmentWithMarkers } from "../helpers-part1.ts";

export function do_validPasteIds(self: Editor): Set<number> {
  return new Set(self.pastes.keys());
}

export function do_segment(self: Editor, text: string, mode: "word" | "grapheme"): Iterable<Intl.SegmentData> {
  return segmentWithMarkers(text, mode === "word" ? wordSegmenter : graphemeSegmenter, self.validPasteIds());
}

export function do_getPaddingX(self: Editor): number {
  return self.paddingX;
}

export function do_setPaddingX(self: Editor, padding: number): void {
  const newPadding = Number.isFinite(padding) ? Math.max(0, Math.floor(padding)) : 0;
  if (self.paddingX !== newPadding) {
    self.paddingX = newPadding;
    self.tui.requestRender();
  }
}

export function do_getAutocompleteMaxVisible(self: Editor): number {
  return self.autocompleteMaxVisible;
}

export function do_setAutocompleteMaxVisible(self: Editor, maxVisible: number): void {
  const newMaxVisible = Number.isFinite(maxVisible) ? Math.max(3, Math.min(20, Math.floor(maxVisible))) : 5;
  if (self.autocompleteMaxVisible !== newMaxVisible) {
    self.autocompleteMaxVisible = newMaxVisible;
    self.tui.requestRender();
  }
}

export function do_setAutocompleteProvider(self: Editor, provider: AutocompleteProvider): void {
  self.cancelAutocomplete();
  self.autocompleteProvider = provider;
  self.setAutocompleteTriggerCharacters(provider.triggerCharacters ?? []);
}

export function do_addToHistory(self: Editor, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Don't add consecutive duplicates
  if (self.history.length > 0 && self.history[0] === trimmed) return;
  self.history.unshift(trimmed);
  // Limit history size
  if (self.history.length > 100) {
    self.history.pop();
  }
}

export function do_isOnFirstVisualLine(self: Editor): boolean {
  const visualLines = self.buildVisualLineMap(self.lastWidth);
  const currentVisualLine = self.findCurrentVisualLine(visualLines);
  return currentVisualLine === 0;
}

export function do_isOnLastVisualLine(self: Editor): boolean {
  const visualLines = self.buildVisualLineMap(self.lastWidth);
  const currentVisualLine = self.findCurrentVisualLine(visualLines);
  return currentVisualLine === visualLines.length - 1;
}

export function do_navigateHistory(self: Editor, direction: 1 | -1): void {
  self.lastAction = null;
  if (self.history.length === 0) return;

  const newIndex = self.historyIndex - direction; // Up(-1) increases index, Down(1) decreases
  if (newIndex < -1 || newIndex >= self.history.length) return;

  // Capture state when first entering history browsing mode
  if (self.historyIndex === -1 && newIndex >= 0) {
    self.pushUndoSnapshot();
    self.historyDraft = structuredClone(self.state);
  }

  self.historyIndex = newIndex;

  if (self.historyIndex === -1) {
    const draft = self.historyDraft;
    self.historyDraft = null;
    if (draft) {
      self.state = draft;
      self.preferredVisualCol = null;
      self.snappedFromCursorCol = null;
      self.scrollOffset = 0;
      if (self.onChange) self.onChange(self.getText());
    } else {
      self.setTextInternal("");
    }
  } else {
    self.setTextInternal(self.history[self.historyIndex] || "", direction === -1 ? "start" : "end");
  }
}

export function do_exitHistoryBrowsing(self: Editor): void {
  self.historyIndex = -1;
  self.historyDraft = null;
}

export function do_setTextInternal(self: Editor, text: string, cursorPlacement: "start" | "end" = "end"): void {
  const lines = text.split("\n");
  self.state.lines = lines.length === 0 ? [""] : lines;
  self.state.cursorLine = cursorPlacement === "start" ? 0 : self.state.lines.length - 1;
  self.setCursorCol(cursorPlacement === "start" ? 0 : self.state.lines[self.state.cursorLine]?.length || 0);
  // Reset scroll - render() will adjust to show cursor
  self.scrollOffset = 0;

  if (self.onChange) {
    self.onChange(self.getText());
  }
}

export function do_invalidate(_self: Editor): void {
  // No cached state to invalidate currently
}
