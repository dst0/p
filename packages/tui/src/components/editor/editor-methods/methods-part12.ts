import { isWhitespaceChar } from "../../../utils.ts";
import { SelectList } from "../../select-list.ts";
import {
  ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS,
  DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS,
  SLASH_COMMAND_SELECT_LIST_LAYOUT,
} from "../constants.ts";
import type { Editor } from "../editor.ts";
import { buildDebouncePattern, buildTriggerPattern } from "../helpers-part2.ts";

export function do_getBestAutocompleteMatchIndex(
  _self: Editor,
  items: Array<{ value: string; label: string }>,
  prefix: string,
): number {
  if (!prefix) return -1;

  let firstPrefixIndex = -1;

  for (let i = 0; i < items.length; i++) {
    const value = items[i]!.value;
    if (value === prefix) {
      return i; // Exact match always wins
    }
    if (firstPrefixIndex === -1 && value.startsWith(prefix)) {
      firstPrefixIndex = i;
    }
  }

  return firstPrefixIndex;
}

export function do_createAutocompleteList(
  self: Editor,
  prefix: string,
  items: Array<{ value: string; label: string; description?: string }>,
): SelectList {
  const layout = prefix.startsWith("/") ? SLASH_COMMAND_SELECT_LIST_LAYOUT : undefined;
  return new SelectList(items, self.autocompleteMaxVisible, self.theme.selectList, layout);
}

export function do_tryTriggerAutocomplete(self: Editor, explicitTab: boolean = false): void {
  self.requestAutocomplete({ force: false, explicitTab });
}

export function do_handleTabCompletion(self: Editor): void {
  if (!self.autocompleteProvider) return;

  const currentLine = self.state.lines[self.state.cursorLine] || "";
  const beforeCursor = currentLine.slice(0, self.state.cursorCol);

  if (self.isInSlashCommandContext(beforeCursor) && !beforeCursor.trimStart().includes(" ")) {
    self.handleSlashCommandCompletion();
  } else {
    self.forceFileAutocomplete(true);
  }
}

export function do_handleSlashCommandCompletion(self: Editor): void {
  self.requestAutocomplete({ force: false, explicitTab: true });
}

export function do_forceFileAutocomplete(self: Editor, explicitTab: boolean = false): void {
  self.requestAutocomplete({ force: true, explicitTab });
}

export function do_requestAutocomplete(self: Editor, options: { force: boolean; explicitTab: boolean }): void {
  if (!self.autocompleteProvider) return;

  if (options.force) {
    const shouldTrigger =
      !self.autocompleteProvider.shouldTriggerFileCompletion ||
      self.autocompleteProvider.shouldTriggerFileCompletion(
        self.state.lines,
        self.state.cursorLine,
        self.state.cursorCol,
      );
    if (!shouldTrigger) {
      return;
    }
  }

  self.cancelAutocompleteRequest();
  const startToken = ++self.autocompleteStartToken;

  const debounceMs = self.getAutocompleteDebounceMs(options);
  if (debounceMs > 0) {
    self.autocompleteDebounceTimer = setTimeout(() => {
      self.autocompleteDebounceTimer = undefined;
      void self.startAutocompleteRequest(startToken, options);
    }, debounceMs);
    return;
  }

  void self.startAutocompleteRequest(startToken, options);
}

export async function do_startAutocompleteRequest(
  self: Editor,
  startToken: number,
  options: { force: boolean; explicitTab: boolean },
): Promise<void> {
  const previousTask = self.autocompleteRequestTask;
  self.autocompleteRequestTask = (async () => {
    await previousTask;
    if (startToken !== self.autocompleteStartToken || !self.autocompleteProvider) {
      return;
    }

    const controller = new AbortController();
    self.autocompleteAbort = controller;
    const requestId = ++self.autocompleteRequestId;
    const snapshotText = self.getText();
    const snapshotLine = self.state.cursorLine;
    const snapshotCol = self.state.cursorCol;

    await self.runAutocompleteRequest(requestId, controller, snapshotText, snapshotLine, snapshotCol, options);
  })();
  await self.autocompleteRequestTask;
}

export function do_setAutocompleteTriggerCharacters(self: Editor, triggerCharacters: string[]): void {
  const next = [...DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS];
  for (const character of triggerCharacters) {
    if (character.length !== 1 || character === "/" || isWhitespaceChar(character) || next.includes(character)) {
      continue;
    }
    next.push(character);
  }
  self.autocompleteTriggerCharacters = next;
  self.autocompleteTriggerPattern = buildTriggerPattern(next);
  self.autocompleteDebouncePattern = buildDebouncePattern(next);
}

export function do_getAutocompleteDebounceMs(self: Editor, options: { force: boolean; explicitTab: boolean }): number {
  if (options.explicitTab || options.force) {
    return 0;
  }

  const currentLine = self.state.lines[self.state.cursorLine] || "";
  const textBeforeCursor = currentLine.slice(0, self.state.cursorCol);
  return self.autocompleteDebouncePattern.test(textBeforeCursor) ? ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS : 0;
}
