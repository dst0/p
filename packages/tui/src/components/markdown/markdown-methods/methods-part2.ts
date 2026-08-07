import type { Markdown } from "../markdown.ts";
import type { InlineStyleContext } from "../types.ts";

export function do_getDefaultStylePrefix(self: Markdown): string {
  if (!self.defaultTextStyle) {
    return "";
  }

  if (self.defaultStylePrefix !== undefined) {
    return self.defaultStylePrefix;
  }

  const sentinel = "\u0000";
  let styled = sentinel;

  if (self.defaultTextStyle.color) {
    styled = self.defaultTextStyle.color(styled);
  }

  if (self.defaultTextStyle.bold) {
    styled = self.theme.bold(styled);
  }
  if (self.defaultTextStyle.italic) {
    styled = self.theme.italic(styled);
  }
  if (self.defaultTextStyle.strikethrough) {
    styled = self.theme.strikethrough(styled);
  }
  if (self.defaultTextStyle.underline) {
    styled = self.theme.underline(styled);
  }

  const sentinelIndex = styled.indexOf(sentinel);
  self.defaultStylePrefix = sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
  return self.defaultStylePrefix;
}

export function do_getStylePrefix(_self: Markdown, styleFn: (text: string) => string): string {
  const sentinel = "\u0000";
  const styled = styleFn(sentinel);
  const sentinelIndex = styled.indexOf(sentinel);
  return sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
}

export function do_getDefaultInlineStyleContext(self: Markdown): InlineStyleContext {
  return {
    applyText: (text: string) => self.applyDefaultStyle(text),
    stylePrefix: self.getDefaultStylePrefix(),
  };
}
