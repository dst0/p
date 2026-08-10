import { readFileSync } from "node:fs";

export const DEFAULT_HOST = "127.0.0.1";

export const DEFAULT_PORT = 8787;

export const MAX_JSON_BYTES = 1024 * 1024;

export const VOICE_PAGE_HTML = readFileSync(new URL("./voice-page.html", import.meta.url), "utf8");
