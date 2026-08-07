import type { MarkdownTheme } from "@dst0/p-tui";
import chalk from "chalk";

export const SELF_UPDATE_NOTE_MARKDOWN_THEME: MarkdownTheme = {
  heading: (text) => chalk.bold(chalk.yellow(text)),
  link: (text) => chalk.cyan(text),
  linkUrl: (text) => chalk.dim(text),
  code: (text) => chalk.yellow(text),
  codeBlock: (text) => chalk.dim(text),
  codeBlockBorder: (text) => chalk.dim(text),
  quote: (text) => chalk.dim(text),
  quoteBorder: (text) => chalk.dim(text),
  hr: (text) => chalk.dim(text),
  listBullet: (text) => chalk.yellow(text),
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
};
