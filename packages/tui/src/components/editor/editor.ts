import type { AutocompleteProvider, AutocompleteSuggestions } from "../../autocomplete.ts";
import type { getKeybindings } from "../../keybindings.ts";
import { KillRing } from "../../kill-ring.ts";
import type { Component, Focusable, TUI } from "../../tui.ts";
import { UndoStack } from "../../undo-stack.ts";
import type { SelectList } from "../select-list.ts";
import { DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS } from "./constants.ts";
import {
  do_createAutocompleteList,
  do_forceFileAutocomplete,
  do_getAutocompleteDebounceMs,
  do_getBestAutocompleteMatchIndex,
  do_handleSlashCommandCompletion,
  do_handleTabCompletion,
  do_requestAutocomplete,
  do_setAutocompleteTriggerCharacters,
  do_startAutocompleteRequest,
  do_tryTriggerAutocomplete,
} from "./editor-methods/autocomplete-matching.ts";
import {
  do_applyAutocompleteSuggestions,
  do_cancelAutocomplete,
  do_cancelAutocompleteRequest,
  do_clearAutocompleteUi,
  do_isAutocompleteRequestCurrent,
  do_isShowingAutocomplete,
  do_runAutocompleteRequest,
  do_updateAutocomplete,
} from "./editor-methods/autocomplete-request.ts";
import { do_handleBackspace, do_moveToVisualLine, do_setCursorCol } from "./editor-methods/backspace-cursor.ts";
import {
  do_addToHistory,
  do_exitHistoryBrowsing,
  do_getAutocompleteMaxVisible,
  do_getPaddingX,
  do_invalidate,
  do_isOnFirstVisualLine,
  do_isOnLastVisualLine,
  do_navigateHistory,
  do_segment,
  do_setAutocompleteMaxVisible,
  do_setAutocompleteProvider,
  do_setPaddingX,
  do_setTextInternal,
  do_validPasteIds,
} from "./editor-methods/configuration.ts";
import {
  do_moveCursor,
  do_moveWordBackwards,
  do_pageScroll,
  do_yank,
  do_yankPop,
} from "./editor-methods/cursor-movement.ts";
import { do_handleInput } from "./editor-methods/input-handling.ts";
import {
  do_addNewLine,
  do_handlePaste,
  do_shouldSubmitOnBackslashEnter,
  do_submitValue,
} from "./editor-methods/paste-submit.ts";
import { do_render } from "./editor-methods/render.ts";
import { do_insertCharacter, do_insertTextAtCursorInternal } from "./editor-methods/text-insertion.ts";
import {
  do_expandPasteMarkers,
  do_getCursor,
  do_getExpandedText,
  do_getLines,
  do_getText,
  do_insertTextAtCursor,
  do_layoutText,
  do_normalizeText,
  do_setText,
} from "./editor-methods/text-layout.ts";
import {
  do_computeVerticalMoveColumn,
  do_deleteToEndOfLine,
  do_deleteToStartOfLine,
  do_deleteWordBackwards,
  do_moveToLineEnd,
  do_moveToLineStart,
} from "./editor-methods/vertical-movement.ts";
import {
  do_buildVisualLineMap,
  do_deleteWordForward,
  do_findCurrentVisualLine,
  do_findVisualLineAt,
  do_handleForwardDelete,
} from "./editor-methods/word-operations.ts";
import {
  do_deleteYankedText,
  do_insertYankedText,
  do_isAtStartOfMessage,
  do_isInSlashCommandContext,
  do_isSlashMenuAllowed,
  do_jumpToChar,
  do_moveWordForwards,
  do_pushUndoSnapshot,
  do_undo,
} from "./editor-methods/yank-undo.ts";
import { buildDebouncePattern, buildTriggerPattern } from "./trigger-patterns.ts";
import type { EditorOptions, EditorState, EditorTheme, LayoutLine } from "./types.ts";

export class Editor implements Component, Focusable {
  public state: EditorState = {
    lines: [""],
    cursorLine: 0,
    cursorCol: 0,
  };

  focused: boolean = false;

  public tui: TUI;

  public theme: EditorTheme;

  public paddingX: number = 0;

  public lastWidth: number = 80;

  public scrollOffset: number = 0;

  public borderColor: (str: string) => string;

  public autocompleteProvider?: AutocompleteProvider;

  public autocompleteTriggerCharacters = [...DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS];

  public autocompleteTriggerPattern = buildTriggerPattern(this.autocompleteTriggerCharacters);

  public autocompleteDebouncePattern = buildDebouncePattern(this.autocompleteTriggerCharacters);

  public autocompleteList?: SelectList;

  public autocompleteState: "regular" | "force" | null = null;

  public autocompletePrefix: string = "";

  public autocompleteMaxVisible: number = 5;

  public autocompleteAbort?: AbortController;

  public autocompleteDebounceTimer?: ReturnType<typeof setTimeout>;

  public autocompleteRequestTask: Promise<void> = Promise.resolve();

  public autocompleteStartToken: number = 0;

  public autocompleteRequestId: number = 0;

  public pastes: Map<number, string> = new Map();

  public pasteCounter: number = 0;

  public pasteBuffer: string = "";

  public isInPaste: boolean = false;

  public history: string[] = [];

  public historyIndex: number = -1;

  public historyDraft: EditorState | null = null;

  public killRing = new KillRing();

  public lastAction: "kill" | "yank" | "type-word" | null = null;

  public jumpMode: "forward" | "backward" | null = null;

  public preferredVisualCol: number | null = null;

  public snappedFromCursorCol: number | null = null;

  public undoStack = new UndoStack<EditorState>();

  public onSubmit?: (text: string) => void;

  public onChange?: (text: string) => void;

  public disableSubmit: boolean = false;

  constructor(tui: TUI, theme: EditorTheme, options: EditorOptions = {}) {
    this.tui = tui;
    this.theme = theme;
    this.borderColor = theme.borderColor;
    const paddingX = options.paddingX ?? 0;
    this.paddingX = Number.isFinite(paddingX) ? Math.max(0, Math.floor(paddingX)) : 0;
    const maxVisible = options.autocompleteMaxVisible ?? 5;
    this.autocompleteMaxVisible = Number.isFinite(maxVisible) ? Math.max(3, Math.min(20, Math.floor(maxVisible))) : 5;
  }

  validPasteIds(): Set<number> {
    return do_validPasteIds(this);
  }

  segment(text: string, mode: "word" | "grapheme"): Iterable<Intl.SegmentData> {
    return do_segment(this, text, mode);
  }

  getPaddingX(): number {
    return do_getPaddingX(this);
  }

  setPaddingX(padding: number): void {
    do_setPaddingX(this, padding);
  }

  getAutocompleteMaxVisible(): number {
    return do_getAutocompleteMaxVisible(this);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    do_setAutocompleteMaxVisible(this, maxVisible);
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    do_setAutocompleteProvider(this, provider);
  }

  addToHistory(text: string): void {
    do_addToHistory(this, text);
  }

  isOnFirstVisualLine(): boolean {
    return do_isOnFirstVisualLine(this);
  }

  isOnLastVisualLine(): boolean {
    return do_isOnLastVisualLine(this);
  }

  navigateHistory(direction: 1 | -1): void {
    do_navigateHistory(this, direction);
  }

  exitHistoryBrowsing(): void {
    do_exitHistoryBrowsing(this);
  }

  setTextInternal(text: string, cursorPlacement: "start" | "end" = "end"): void {
    do_setTextInternal(this, text, cursorPlacement);
  }

  invalidate(): void {
    do_invalidate(this);
  }

  render(width: number): string[] {
    return do_render(this, width);
  }

  handleInput(data: string): void {
    do_handleInput(this, data);
  }

  layoutText(contentWidth: number): LayoutLine[] {
    return do_layoutText(this, contentWidth);
  }

  getText(): string {
    return do_getText(this);
  }

  expandPasteMarkers(text: string): string {
    return do_expandPasteMarkers(this, text);
  }

  getExpandedText(): string {
    return do_getExpandedText(this);
  }

  getLines(): string[] {
    return do_getLines(this);
  }

  getCursor(): { line: number; col: number } {
    return do_getCursor(this);
  }

  setText(text: string): void {
    do_setText(this, text);
  }

  insertTextAtCursor(text: string): void {
    do_insertTextAtCursor(this, text);
  }

  normalizeText(text: string): string {
    return do_normalizeText(this, text);
  }

  insertTextAtCursorInternal(text: string): void {
    do_insertTextAtCursorInternal(this, text);
  }

  insertCharacter(char: string, skipUndoCoalescing?: boolean): void {
    do_insertCharacter(this, char, skipUndoCoalescing);
  }

  handlePaste(pastedText: string): void {
    do_handlePaste(this, pastedText);
  }

  addNewLine(): void {
    do_addNewLine(this);
  }

  shouldSubmitOnBackslashEnter(data: string, kb: ReturnType<typeof getKeybindings>): boolean {
    return do_shouldSubmitOnBackslashEnter(this, data, kb);
  }

  submitValue(): void {
    do_submitValue(this);
  }

  handleBackspace(): void {
    do_handleBackspace(this);
  }

  setCursorCol(col: number): void {
    do_setCursorCol(this, col);
  }

  moveToVisualLine(
    visualLines: Array<{ logicalLine: number; startCol: number; length: number }>,
    currentVisualLine: number,
    targetVisualLine: number,
  ): void {
    do_moveToVisualLine(this, visualLines, currentVisualLine, targetVisualLine);
  }

  computeVerticalMoveColumn(currentVisualCol: number, sourceMaxVisualCol: number, targetMaxVisualCol: number): number {
    return do_computeVerticalMoveColumn(this, currentVisualCol, sourceMaxVisualCol, targetMaxVisualCol);
  }

  moveToLineStart(): void {
    do_moveToLineStart(this);
  }

  moveToLineEnd(): void {
    do_moveToLineEnd(this);
  }

  deleteToStartOfLine(): void {
    do_deleteToStartOfLine(this);
  }

  deleteToEndOfLine(): void {
    do_deleteToEndOfLine(this);
  }

  deleteWordBackwards(): void {
    do_deleteWordBackwards(this);
  }

  deleteWordForward(): void {
    do_deleteWordForward(this);
  }

  handleForwardDelete(): void {
    do_handleForwardDelete(this);
  }

  buildVisualLineMap(width: number): Array<{ logicalLine: number; startCol: number; length: number }> {
    return do_buildVisualLineMap(this, width);
  }

  findVisualLineAt(
    visualLines: Array<{ logicalLine: number; startCol: number; length: number }>,
    line: number,
    col: number,
  ): number {
    return do_findVisualLineAt(this, visualLines, line, col);
  }

  findCurrentVisualLine(visualLines: Array<{ logicalLine: number; startCol: number; length: number }>): number {
    return do_findCurrentVisualLine(this, visualLines);
  }

  moveCursor(deltaLine: number, deltaCol: number): void {
    do_moveCursor(this, deltaLine, deltaCol);
  }

  pageScroll(direction: -1 | 1): void {
    do_pageScroll(this, direction);
  }

  moveWordBackwards(): void {
    do_moveWordBackwards(this);
  }

  yank(): void {
    do_yank(this);
  }

  yankPop(): void {
    do_yankPop(this);
  }

  insertYankedText(text: string): void {
    do_insertYankedText(this, text);
  }

  deleteYankedText(): void {
    do_deleteYankedText(this);
  }

  pushUndoSnapshot(): void {
    do_pushUndoSnapshot(this);
  }

  undo(): void {
    do_undo(this);
  }

  jumpToChar(char: string, direction: "forward" | "backward"): void {
    do_jumpToChar(this, char, direction);
  }

  moveWordForwards(): void {
    do_moveWordForwards(this);
  }

  isSlashMenuAllowed(): boolean {
    return do_isSlashMenuAllowed(this);
  }

  isAtStartOfMessage(): boolean {
    return do_isAtStartOfMessage(this);
  }

  isInSlashCommandContext(textBeforeCursor: string): boolean {
    return do_isInSlashCommandContext(this, textBeforeCursor);
  }

  getBestAutocompleteMatchIndex(items: Array<{ value: string; label: string }>, prefix: string): number {
    return do_getBestAutocompleteMatchIndex(this, items, prefix);
  }

  createAutocompleteList(
    prefix: string,
    items: Array<{ value: string; label: string; description?: string }>,
  ): SelectList {
    return do_createAutocompleteList(this, prefix, items);
  }

  tryTriggerAutocomplete(explicitTab: boolean = false): void {
    do_tryTriggerAutocomplete(this, explicitTab);
  }

  handleTabCompletion(): void {
    do_handleTabCompletion(this);
  }

  handleSlashCommandCompletion(): void {
    do_handleSlashCommandCompletion(this);
  }

  forceFileAutocomplete(explicitTab: boolean = false): void {
    do_forceFileAutocomplete(this, explicitTab);
  }

  requestAutocomplete(options: { force: boolean; explicitTab: boolean }): void {
    do_requestAutocomplete(this, options);
  }

  async startAutocompleteRequest(startToken: number, options: { force: boolean; explicitTab: boolean }): Promise<void> {
    return do_startAutocompleteRequest(this, startToken, options);
  }

  setAutocompleteTriggerCharacters(triggerCharacters: string[]): void {
    do_setAutocompleteTriggerCharacters(this, triggerCharacters);
  }

  getAutocompleteDebounceMs(options: { force: boolean; explicitTab: boolean }): number {
    return do_getAutocompleteDebounceMs(this, options);
  }

  async runAutocompleteRequest(
    requestId: number,
    controller: AbortController,
    snapshotText: string,
    snapshotLine: number,
    snapshotCol: number,
    options: { force: boolean; explicitTab: boolean },
  ): Promise<void> {
    return do_runAutocompleteRequest(this, requestId, controller, snapshotText, snapshotLine, snapshotCol, options);
  }

  isAutocompleteRequestCurrent(
    requestId: number,
    controller: AbortController,
    snapshotText: string,
    snapshotLine: number,
    snapshotCol: number,
  ): boolean {
    return do_isAutocompleteRequestCurrent(this, requestId, controller, snapshotText, snapshotLine, snapshotCol);
  }

  applyAutocompleteSuggestions(suggestions: AutocompleteSuggestions, state: "regular" | "force"): void {
    do_applyAutocompleteSuggestions(this, suggestions, state);
  }

  cancelAutocompleteRequest(): void {
    do_cancelAutocompleteRequest(this);
  }

  clearAutocompleteUi(): void {
    do_clearAutocompleteUi(this);
  }

  cancelAutocomplete(): void {
    do_cancelAutocomplete(this);
  }

  isShowingAutocomplete(): boolean {
    return do_isShowingAutocomplete(this);
  }

  updateAutocomplete(): void {
    do_updateAutocomplete(this);
  }
}
