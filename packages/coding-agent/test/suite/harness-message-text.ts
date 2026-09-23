/**
 * Text extraction shared by suite harness helpers and tests.
 */

type MessageTextPart = { type: "text"; text: string };

export function getMessageText(message: unknown): string {
  if (!message || typeof message !== "object" || !("content" in message)) {
    return "";
  }
  const content = (message as { content?: string | Array<{ type: string; text?: string }> }).content;
  if (content === undefined) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part): part is MessageTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
