import { LANG_MAP } from "../../config.ts";

export const KNOWN_LANGUAGES = new Set(Object.values(LANG_MAP));

export const KNOWN_SYMBOL_TYPES = new Set(["function", "class", "module", "section", "text"]);

export const MAX_CHUNKS_PER_FILE = 2_000;

export const SCROLL_PROGRESS_INTERVAL = 256;

export const MEBIBYTE = 1024 * 1024;

export const PREPARATION_SPOOL_DISK_RESERVE_BYTES = 512 * MEBIBYTE;
