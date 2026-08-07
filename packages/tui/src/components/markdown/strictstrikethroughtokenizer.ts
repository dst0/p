import { Tokenizer, type Tokens } from "marked";

export const STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;

export class StrictStrikethroughTokenizer extends Tokenizer {
  override del(src: string): Tokens.Del | undefined {
    const match = STRICT_STRIKETHROUGH_REGEX.exec(src);
    if (!match) {
      return undefined;
    }

    const text = match[2];
    return {
      type: "del",
      raw: match[0],
      text,
      tokens: this.lexer.inlineTokens(text),
    };
  }
}
