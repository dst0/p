import type { Token, Tokens } from "marked";
import type { Component } from "../../tui.ts";
import {
  do_getOrderedListMarker,
  do_getUnorderedListMarker,
  do_renderInlineTokens,
} from "./markdown-methods/inline-rendering.ts";
import { do_getLongestWordWidth, do_renderList, do_wrapCellText } from "./markdown-methods/list-table-helpers.ts";
import { do_renderTable } from "./markdown-methods/table-rendering.ts";
import { do_applyDefaultStyle, do_invalidate, do_render, do_setText } from "./markdown-methods/text-rendering.ts";
import {
  do_getDefaultInlineStyleContext,
  do_getDefaultStylePrefix,
  do_getStylePrefix,
} from "./markdown-methods/theming.ts";
import { do_renderToken } from "./markdown-methods/token-rendering.ts";
import type { DefaultTextStyle, InlineStyleContext, MarkdownOptions, MarkdownTheme } from "./types.ts";

export class Markdown implements Component {
  public text: string;

  public paddingX: number;

  public paddingY: number;

  public defaultTextStyle?: DefaultTextStyle;

  public theme: MarkdownTheme;

  public options: MarkdownOptions;

  public defaultStylePrefix?: string;

  public cachedText?: string;

  public cachedWidth?: number;

  public cachedLines?: string[];

  constructor(
    text: string,
    paddingX: number,
    paddingY: number,
    theme: MarkdownTheme,
    defaultTextStyle?: DefaultTextStyle,
    options?: MarkdownOptions,
  ) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.theme = theme;
    this.defaultTextStyle = defaultTextStyle;
    this.options = options ? { ...options } : {};
  }

  setText(text: string): void {
    do_setText(this, text);
  }

  invalidate(): void {
    do_invalidate(this);
  }

  render(width: number): string[] {
    return do_render(this, width);
  }

  applyDefaultStyle(text: string): string {
    return do_applyDefaultStyle(this, text);
  }

  getDefaultStylePrefix(): string {
    return do_getDefaultStylePrefix(this);
  }

  getStylePrefix(styleFn: (text: string) => string): string {
    return do_getStylePrefix(this, styleFn);
  }

  getDefaultInlineStyleContext(): InlineStyleContext {
    return do_getDefaultInlineStyleContext(this);
  }

  renderToken(token: Token, width: number, nextTokenType?: string, styleContext?: InlineStyleContext): string[] {
    return do_renderToken(this, token, width, nextTokenType, styleContext);
  }

  renderInlineTokens(tokens: Token[], styleContext?: InlineStyleContext): string {
    return do_renderInlineTokens(this, tokens, styleContext);
  }

  getOrderedListMarker(item: Tokens.ListItem): string | undefined {
    return do_getOrderedListMarker(this, item);
  }

  getUnorderedListMarker(item: Tokens.ListItem): string | undefined {
    return do_getUnorderedListMarker(this, item);
  }

  renderList(token: Tokens.List, depth: number, width: number, styleContext?: InlineStyleContext): string[] {
    return do_renderList(this, token, depth, width, styleContext);
  }

  getLongestWordWidth(text: string, maxWidth?: number): number {
    return do_getLongestWordWidth(this, text, maxWidth);
  }

  wrapCellText(text: string, maxWidth: number): string[] {
    return do_wrapCellText(this, text, maxWidth);
  }

  renderTable(
    token: Tokens.Table,
    availableWidth: number,
    nextTokenType?: string,
    styleContext?: InlineStyleContext,
  ): string[] {
    return do_renderTable(this, token, availableWidth, nextTokenType, styleContext);
  }
}
