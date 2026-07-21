import { formatContextFileForPrompt } from "./packages/coding-agent/src/core/system-prompt.ts";
const largeContent = "# Header\n\n".repeat(500) + "always do this\n\nregular line\n\nmust follow rules\n";
const result = formatContextFileForPrompt("/test/large.md", largeContent);
console.log(result.includes("[Large project rules file compacted from"));
console.log(result.includes("always do this"));
console.log(result.includes("must follow rules"));
