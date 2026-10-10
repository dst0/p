import { StringDecoder } from "node:string_decoder";

const maxResponseEvidenceBytes = 1024 * 1024;
const maxResponseModelEvents = 65_536;

function modelFromJson(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    const model = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).model : undefined;
    return typeof model === "string" ? model : undefined;
  } catch {
    return undefined;
  }
}

export function createCertifiedResponseModelCollector(contentType: string | undefined): {
  push(chunk: Buffer): void;
  finish(): string[];
} {
  const sse = contentType?.toLowerCase().startsWith("text/event-stream") ?? false;
  const decoder = new StringDecoder("utf8");
  const models: string[] = [];
  let pending = "";
  let eventData: string[] = [];
  let eventBytes = 0;
  const consumeLines = (): void => {
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      if (Buffer.byteLength(pending.slice(0, newline), "utf8") > maxResponseEvidenceBytes) {
        throw new Error("Certified proxy response evidence limit exceeded");
      }
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line.startsWith("data:")) {
        const data = line.slice(5).trimStart();
        eventBytes += Buffer.byteLength(data, "utf8");
        if (eventBytes > maxResponseEvidenceBytes) {
          throw new Error("Certified proxy response evidence limit exceeded");
        }
        eventData.push(data);
      } else if (line === "") {
        const model = modelFromJson(eventData.join("\n"));
        if (model) {
          if (models.length >= maxResponseModelEvents) {
            throw new Error("Certified proxy response model event limit exceeded");
          }
          models.push(model);
        }
        eventData = [];
        eventBytes = 0;
      }
      newline = pending.indexOf("\n");
    }
  };
  return {
    push(chunk: Buffer): void {
      pending += decoder.write(chunk);
      if (sse) consumeLines();
      if (Buffer.byteLength(pending, "utf8") > maxResponseEvidenceBytes) {
        throw new Error("Certified proxy response evidence limit exceeded");
      }
    },
    finish(): string[] {
      pending += decoder.end();
      if (sse) {
        consumeLines();
        if (pending || eventData.length > 0) return [];
      } else {
        const model = modelFromJson(pending);
        if (model) models.push(model);
      }
      return models;
    },
  };
}
