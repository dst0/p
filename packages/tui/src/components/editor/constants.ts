import { getGraphemeSegmenter, getWordSegmenter } from "../../utils.ts";
import type { SelectListLayoutOptions } from "../select-list.ts";

export const graphemeSegmenter = getGraphemeSegmenter();

export const wordSegmenter = getWordSegmenter();

export const PASTE_MARKER_REGEX = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;

export const PASTE_MARKER_SINGLE = /^\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]$/;

export const SLASH_COMMAND_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
  minPrimaryColumnWidth: 12,
  maxPrimaryColumnWidth: 32,
};

export const ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS = 20;

export const DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS = ["@", "#"];
