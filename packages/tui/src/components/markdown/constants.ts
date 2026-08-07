import { Marked } from "marked";
import { StrictStrikethroughTokenizer } from "./strictstrikethroughtokenizer.ts";

export const STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;

export const markdownParser = new Marked();
markdownParser.setOptions({
  tokenizer: new StrictStrikethroughTokenizer(),
});
