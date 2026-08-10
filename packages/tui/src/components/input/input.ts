import { KillRing } from "../../kill-ring.ts";
import type { Component, Focusable } from "../../tui.ts";
import { UndoStack } from "../../undo-stack.ts";
import { do_handleInput } from "./input-methods/input-handling.ts";
import { do_render } from "./input-methods/render.ts";
import {
  do_deleteToLineEnd,
  do_deleteToLineStart,
  do_deleteWordBackwards,
  do_deleteWordForward,
  do_handleBackspace,
  do_handleForwardDelete,
  do_handlePaste,
  do_insertCharacter,
  do_invalidate,
  do_moveWordBackwards,
  do_moveWordForwards,
  do_pushUndo,
  do_undo,
  do_yank,
  do_yankPop,
} from "./input-methods/text-editing.ts";
import { do_getValue, do_setValue } from "./input-methods/value-access.ts";
import type { InputState } from "./types.ts";

export class Input implements Component, Focusable {
  public value: string = "";

  public cursor: number = 0;

  public scrollOffset: number = 0;

  public onSubmit?: (value: string) => void;

  public onEscape?: () => void;

  focused: boolean = false;

  public pasteBuffer: string = "";

  public isInPaste: boolean = false;

  public killRing = new KillRing();

  public lastAction: "kill" | "yank" | "type-word" | null = null;

  public undoStack = new UndoStack<InputState>();

  getValue(): string {
    return do_getValue(this);
  }

  setValue(value: string): void {
    do_setValue(this, value);
  }

  handleInput(data: string): void {
    do_handleInput(this, data);
  }

  insertCharacter(char: string): void {
    do_insertCharacter(this, char);
  }

  handleBackspace(): void {
    do_handleBackspace(this);
  }

  handleForwardDelete(): void {
    do_handleForwardDelete(this);
  }

  deleteToLineStart(): void {
    do_deleteToLineStart(this);
  }

  deleteToLineEnd(): void {
    do_deleteToLineEnd(this);
  }

  deleteWordBackwards(): void {
    do_deleteWordBackwards(this);
  }

  deleteWordForward(): void {
    do_deleteWordForward(this);
  }

  yank(): void {
    do_yank(this);
  }

  yankPop(): void {
    do_yankPop(this);
  }

  pushUndo(): void {
    do_pushUndo(this);
  }

  undo(): void {
    do_undo(this);
  }

  moveWordBackwards(): void {
    do_moveWordBackwards(this);
  }

  moveWordForwards(): void {
    do_moveWordForwards(this);
  }

  handlePaste(pastedText: string): void {
    do_handlePaste(this, pastedText);
  }

  invalidate(): void {
    do_invalidate(this);
  }

  render(width: number): string[] {
    return do_render(this, width);
  }
}
