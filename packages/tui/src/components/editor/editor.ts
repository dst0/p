import type { AutocompleteProvider } from "../../autocomplete.ts";
import { KillRing } from "../../kill-ring.ts";
import type { Component, Focusable, TUI } from "../../tui.ts";
import { UndoStack } from "../../undo-stack.ts";
import { type DelegatedMethods, installDelegatedMethods } from "../../utils/install-delegated-methods.ts";
import type { SelectList } from "../select-list.ts";
import { DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS } from "./constants.ts";
import * as autocompleteMatchingDelegates from "./editor-methods/autocomplete-matching.ts";
import * as autocompleteRequestDelegates from "./editor-methods/autocomplete-request.ts";
import * as backspaceCursorDelegates from "./editor-methods/backspace-cursor.ts";
import * as configurationDelegates from "./editor-methods/configuration.ts";
import * as cursorMovementDelegates from "./editor-methods/cursor-movement.ts";
import * as inputHandlingDelegates from "./editor-methods/input-handling.ts";
import * as pasteSubmitDelegates from "./editor-methods/paste-submit.ts";
import * as renderDelegates from "./editor-methods/render.ts";
import * as textInsertionDelegates from "./editor-methods/text-insertion.ts";
import * as textLayoutDelegates from "./editor-methods/text-layout.ts";
import * as verticalMovementDelegates from "./editor-methods/vertical-movement.ts";
import * as wordOperationsDelegates from "./editor-methods/word-operations.ts";
import * as yankUndoDelegates from "./editor-methods/yank-undo.ts";
import { buildDebouncePattern, buildTriggerPattern } from "./trigger-patterns.ts";
import type { EditorOptions, EditorState, EditorTheme } from "./types.ts";

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The installer below synchronously defines every delegated method.
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

  render(width: number): string[] {
    return renderDelegates.do_render(this, width);
  }

  handleInput(data: string): void {
    inputHandlingDelegates.do_handleInput(this, data);
  }
}

type EditorMethods = Omit<
  DelegatedMethods<
    Editor,
    typeof autocompleteMatchingDelegates &
      typeof autocompleteRequestDelegates &
      typeof backspaceCursorDelegates &
      typeof configurationDelegates &
      typeof cursorMovementDelegates &
      typeof inputHandlingDelegates &
      typeof pasteSubmitDelegates &
      typeof renderDelegates &
      typeof textInsertionDelegates &
      typeof textLayoutDelegates &
      typeof verticalMovementDelegates &
      typeof wordOperationsDelegates &
      typeof yankUndoDelegates
  >,
  "handleInput" | "render"
>;

export interface Editor extends EditorMethods {}

installDelegatedMethods(Editor.prototype, [
  autocompleteMatchingDelegates,
  autocompleteRequestDelegates,
  backspaceCursorDelegates,
  configurationDelegates,
  cursorMovementDelegates,
  inputHandlingDelegates,
  pasteSubmitDelegates,
  renderDelegates,
  textInsertionDelegates,
  textLayoutDelegates,
  verticalMovementDelegates,
  wordOperationsDelegates,
  yankUndoDelegates,
]);
