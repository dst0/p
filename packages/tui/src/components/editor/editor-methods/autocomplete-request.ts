import type { AutocompleteSuggestions } from "../../../autocomplete.ts";
import type { Editor } from "../editor.ts";

export async function do_runAutocompleteRequest(
  self: Editor,
  requestId: number,
  controller: AbortController,
  snapshotText: string,
  snapshotLine: number,
  snapshotCol: number,
  options: { force: boolean; explicitTab: boolean },
): Promise<void> {
  if (!self.autocompleteProvider) return;

  const suggestions = await self.autocompleteProvider.getSuggestions(
    self.state.lines,
    self.state.cursorLine,
    self.state.cursorCol,
    { signal: controller.signal, force: options.force },
  );

  if (!self.isAutocompleteRequestCurrent(requestId, controller, snapshotText, snapshotLine, snapshotCol)) {
    return;
  }

  self.autocompleteAbort = undefined;

  if (!suggestions || !Array.isArray(suggestions.items) || suggestions.items.length === 0) {
    self.cancelAutocomplete();
    self.tui.requestRender();
    return;
  }

  if (options.force && options.explicitTab && suggestions.items.length === 1) {
    const item = suggestions.items[0]!;
    self.pushUndoSnapshot();
    self.lastAction = null;
    const result = self.autocompleteProvider.applyCompletion(
      self.state.lines,
      self.state.cursorLine,
      self.state.cursorCol,
      item,
      suggestions.prefix,
    );
    self.state.lines = result.lines;
    self.state.cursorLine = result.cursorLine;
    self.setCursorCol(result.cursorCol);
    if (self.onChange) self.onChange(self.getText());
    self.tui.requestRender();
    return;
  }

  self.applyAutocompleteSuggestions(suggestions, options.force ? "force" : "regular");
  self.tui.requestRender();
}

export function do_isAutocompleteRequestCurrent(
  self: Editor,
  requestId: number,
  controller: AbortController,
  snapshotText: string,
  snapshotLine: number,
  snapshotCol: number,
): boolean {
  return (
    !controller.signal.aborted &&
    requestId === self.autocompleteRequestId &&
    self.getText() === snapshotText &&
    self.state.cursorLine === snapshotLine &&
    self.state.cursorCol === snapshotCol
  );
}

export function do_applyAutocompleteSuggestions(
  self: Editor,
  suggestions: AutocompleteSuggestions,
  state: "regular" | "force",
): void {
  self.autocompletePrefix = suggestions.prefix;
  self.autocompleteList = self.createAutocompleteList(suggestions.prefix, suggestions.items);

  const bestMatchIndex = self.getBestAutocompleteMatchIndex(suggestions.items, suggestions.prefix);
  if (bestMatchIndex >= 0) {
    self.autocompleteList.setSelectedIndex(bestMatchIndex);
  }

  self.autocompleteState = state;
}

export function do_cancelAutocompleteRequest(self: Editor): void {
  self.autocompleteStartToken += 1;
  if (self.autocompleteDebounceTimer) {
    clearTimeout(self.autocompleteDebounceTimer);
    self.autocompleteDebounceTimer = undefined;
  }
  self.autocompleteAbort?.abort();
  self.autocompleteAbort = undefined;
}

export function do_clearAutocompleteUi(self: Editor): void {
  self.autocompleteState = null;
  self.autocompleteList = undefined;
  self.autocompletePrefix = "";
}

export function do_cancelAutocomplete(self: Editor): void {
  self.cancelAutocompleteRequest();
  self.clearAutocompleteUi();
}

export function do_isShowingAutocomplete(self: Editor): boolean {
  return self.autocompleteState !== null;
}

export function do_updateAutocomplete(self: Editor): void {
  if (!self.autocompleteState || !self.autocompleteProvider) return;
  self.requestAutocomplete({ force: self.autocompleteState === "force", explicitTab: false });
}
