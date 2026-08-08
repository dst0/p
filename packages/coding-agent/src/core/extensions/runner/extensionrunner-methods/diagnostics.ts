import type { ImageContent } from "@dst0/p-ai";
import type {
  InputEvent,
  InputEventResult,
  InputSource,
  ResourcesDiscoverEvent,
  ResourcesDiscoverResult,
} from "../../types.ts";
import type { ExtensionRunner } from "../extensionrunner.ts";

export async function do_emitResourcesDiscover(
  self: ExtensionRunner,
  cwd: string,
  reason: ResourcesDiscoverEvent["reason"],
): Promise<{
  skillPaths: Array<{ path: string; extensionPath: string }>;
  promptPaths: Array<{ path: string; extensionPath: string }>;
  themePaths: Array<{ path: string; extensionPath: string }>;
}> {
  const ctx = self.createContext();
  const skillPaths: Array<{ path: string; extensionPath: string }> = [];
  const promptPaths: Array<{ path: string; extensionPath: string }> = [];
  const themePaths: Array<{ path: string; extensionPath: string }> = [];

  for (const ext of self.extensions) {
    const handlers = ext.handlers.get("resources_discover");
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      try {
        const event: ResourcesDiscoverEvent = { type: "resources_discover", cwd, reason };
        const handlerResult = await handler(event, ctx);
        const result = handlerResult as ResourcesDiscoverResult | undefined;

        if (result?.skillPaths?.length) {
          skillPaths.push(...result.skillPaths.map((path) => ({ path, extensionPath: ext.path })));
        }
        if (result?.promptPaths?.length) {
          promptPaths.push(...result.promptPaths.map((path) => ({ path, extensionPath: ext.path })));
        }
        if (result?.themePaths?.length) {
          themePaths.push(...result.themePaths.map((path) => ({ path, extensionPath: ext.path })));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        self.emitError({
          extensionPath: ext.path,
          event: "resources_discover",
          error: message,
          stack,
        });
      }
    }
  }

  return { skillPaths, promptPaths, themePaths };
}

export async function do_emitInput(
  self: ExtensionRunner,
  text: string,
  images: ImageContent[] | undefined,
  source: InputSource,
  streamingBehavior?: "steer" | "followUp",
): Promise<InputEventResult> {
  const ctx = self.createContext();
  let currentText = text;
  let currentImages = images;

  for (const ext of self.extensions) {
    for (const handler of ext.handlers.get("input") ?? []) {
      try {
        const event: InputEvent = {
          type: "input",
          text: currentText,
          images: currentImages,
          source,
          streamingBehavior,
        };
        const result = (await handler(event, ctx)) as InputEventResult | undefined;
        if (result?.action === "handled") return result;
        if (result?.action === "transform") {
          currentText = result.text;
          currentImages = result.images ?? currentImages;
        }
      } catch (err) {
        self.emitError({
          extensionPath: ext.path,
          event: "input",
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }
  }
  return currentText !== text || currentImages !== images
    ? { action: "transform", text: currentText, images: currentImages }
    : { action: "continue" };
}
