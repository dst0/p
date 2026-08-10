export const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

export const zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;

export const leadingNonPrintingRegex =
  /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;

export const rgiEmojiRegex = /^\p{RGI_Emoji}$/v;

export const WIDTH_CACHE_SIZE = 512;

export const widthCache = new Map<string, number>();

export const cjkBreakRegex =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;

export const THAI_LAO_AM_REGEX = /[\u0e33\u0eb3]/;

export const THAI_LAO_AM_GLOBAL_REGEX = /[\u0e33\u0eb3]/g;

export const PUNCTUATION_REGEX = /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/;
