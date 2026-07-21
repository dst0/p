import { formatContextFileForPrompt } from "./packages/coding-agent/src/core/system-prompt.ts";
const largeContent = "# Header\n\n".repeat(500) + "always do this\n\nregular line\n\nmust follow rules\n";
console.log(largeContent.length);
