import type { ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { ImageContent, TextContent } from "../../types.ts";
import { EMPTY_TEXT_PLACEHOLDER } from "./constants.ts";
import { createImageBlock, createNonBlankTextBlock } from "./helpers-part2.ts";

export function convertToolResultContent(content: (TextContent | ImageContent)[]): ToolResultContentBlock[] {
  const result: ToolResultContentBlock[] = [];
  for (const c of content) {
    if (c.type === "image") {
      result.push({ image: createImageBlock(c.mimeType, c.data) });
    } else {
      const textBlock = createNonBlankTextBlock(c.text);
      if (textBlock) result.push(textBlock);
    }
  }
  if (result.length === 0) result.push({ text: EMPTY_TEXT_PLACEHOLDER });
  return result;
}
