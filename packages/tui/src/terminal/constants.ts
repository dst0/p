import { createRequire } from "node:module";

export const cjsRequire = createRequire(import.meta.url);

export const TERMINAL_PROGRESS_KEEPALIVE_MS = 1000;

export const TERMINAL_PROGRESS_ACTIVE_SEQUENCE = "\x1b]9;4;3\x07";

export const TERMINAL_PROGRESS_CLEAR_SEQUENCE = "\x1b]9;4;0;\x07";

export const APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";

export const DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS = 7;

export const KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS = 150;

export const KITTY_KEYBOARD_PROTOCOL_QUERY = `\x1b[>${DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS}u\x1b[?u\x1b[c`;
