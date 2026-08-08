import type { ResourceType } from "./types.ts";

export const NETWORK_TIMEOUT_MS = 10000;

export const UPDATE_CHECK_CONCURRENCY = 4;

export const GIT_UPDATE_CONCURRENCY = 4;

export const RESOURCE_TYPES: ResourceType[] = ["extensions", "skills", "prompts", "themes"];

export const FILE_PATTERNS: Record<ResourceType, RegExp> = {
  extensions: /\.(ts|js)$/,
  skills: /\.md$/,
  prompts: /\.md$/,
  themes: /\.json$/,
};

export const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];
