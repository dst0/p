export interface DefaultTextStyle {
  /** Foreground color function */
  color?: (text: string) => string;
  /** Background color function */
  bgColor?: (text: string) => string;
  /** Bold text */
  bold?: boolean;
  /** Italic text */
  italic?: boolean;
  /** Strikethrough text */
  strikethrough?: boolean;
  /** Underline text */
  underline?: boolean;
}

export interface MarkdownTheme {
  heading: (text: string) => string;
  link: (text: string) => string;
  linkUrl: (text: string) => string;
  code: (text: string) => string;
  codeBlock: (text: string) => string;
  codeBlockBorder: (text: string) => string;
  quote: (text: string) => string;
  quoteBorder: (text: string) => string;
  hr: (text: string) => string;
  listBullet: (text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  strikethrough: (text: string) => string;
  underline: (text: string) => string;
  highlightCode?: (code: string, lang?: string) => string[];
  /** Prefix applied to each rendered code block line (default: "  ") */
  codeBlockIndent?: string;
}

export interface MarkdownOptions {
  /** Preserve source list markers instead of normalizing them. */
  preserveOrderedListMarkers?: boolean;
}

export interface InlineStyleContext {
  applyText: (text: string) => string;
  stylePrefix: string;
}
