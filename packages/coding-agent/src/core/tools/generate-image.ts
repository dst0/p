import type { AgentTool } from "@dst0/p-agent-core";
import { generateImages, type ImagesModel } from "@dst0/p-ai";
import { Container, Text } from "@dst0/p-tui";
import { mkdir as fsMkdir, rename as fsRename, unlink as fsUnlink, writeFile as fsWriteFile } from "fs/promises";
import { dirname, extname, relative } from "path";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { normalizeDisplayText, renderToolPath, str, stripHarnessMessages } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export const generateImageSchema = Type.Object({
  prompt: Type.String({ description: "Text description of the image to generate" }),
  outputPath: Type.Optional(
    Type.String({
      description: "Relative or absolute path where the image should be saved (e.g., 'assets/diagram.png')",
    }),
  ),
  size: Type.Optional(
    Type.String({
      description: "Image size / dimensions (e.g., '1024x1024', '1792x1024', '1024x1792')",
    }),
  ),
  aspectRatio: Type.Optional(
    Type.String({
      description: "Aspect ratio token (e.g., '1:1', '16:9', '9:16', '4:3', '3:2')",
    }),
  ),
  quality: Type.Optional(
    Type.String({
      description: "Image quality level ('standard' or 'hd')",
    }),
  ),
  style: Type.Optional(
    Type.String({
      description: "Image style ('vivid' or 'natural')",
    }),
  ),
});

export type GenerateImageToolInput = Static<typeof generateImageSchema>;

export interface GenerateImageToolDetails {
  outputPath: string;
  bytes: number;
  mimeType: string;
  prompt: string;
  revisedPrompt?: string;
  provider?: string;
  model?: string;
  dimensions?: string;
}

export interface GenerateImageOperations {
  writeFile: (absolutePath: string, buffer: Buffer) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}

const defaultGenerateImageOperations: GenerateImageOperations = {
  writeFile: (path, buffer) => fsWriteFile(path, buffer),
  rename: (oldPath, newPath) => fsRename(oldPath, newPath),
  unlink: (path) => fsUnlink(path).catch(() => {}),
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface GenerateImageModelResolution {
  model: ImagesModel<any>;
  apiKey?: string;
}

export interface GenerateImageToolOptions {
  model?: ImagesModel<any>;
  apiKey?: string;
  resolveModel?: () => Promise<GenerateImageModelResolution | undefined> | GenerateImageModelResolution | undefined;
  operations?: GenerateImageOperations;
}

function resolveAspectRatio(aspectRatio?: string): string | undefined {
  if (!aspectRatio) return undefined;
  if (aspectRatio === "16:9") return "1792x1024";
  if (aspectRatio === "9:16") return "1024x1792";
  if (aspectRatio === "4:3") return "1024x768";
  if (aspectRatio === "3:2") return "1200x800";
  return "1024x1024";
}

function resolveDimensions(size?: string, aspectRatio?: string): string | undefined {
  if (size && aspectRatio) {
    const expected = resolveAspectRatio(aspectRatio);
    if (expected && expected !== size && size !== "1024x1024") {
      throw new Error(`Conflicting size ("${size}") and aspectRatio ("${aspectRatio}") specified`);
    }
  }
  if (size) return size;
  return resolveAspectRatio(aspectRatio);
}

function detectBufferMimeType(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[8] === 0x57 && buffer[9] === 0x45) {
    return "image/webp";
  }
  if (buffer.length >= 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  return "image/png";
}

function mimeToExtension(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

export function createGenerateImageToolDefinition(
  cwd: string,
  options?: GenerateImageToolOptions,
): ToolDefinition<typeof generateImageSchema, GenerateImageToolDetails> {
  const ops = options?.operations ?? defaultGenerateImageOperations;

  return {
    name: "generate_image",
    label: "generate_image",
    description:
      "Generate an image using the configured image generation model and save it to a file in the workspace.",
    promptSnippet: "Generate images and illustrations to file",
    promptGuidelines: ["Use generate_image to create visual assets, diagrams, UI mockups, or illustrations."],
    parameters: generateImageSchema,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const resolved = options?.resolveModel ? await options.resolveModel() : undefined;
      const model = resolved?.model ?? options?.model;
      const apiKey = resolved?.apiKey ?? options?.apiKey;

      if (!model) {
        throw new Error(
          "No image generation model configured. Configure defaultImageModel in settings or select one via /model:image",
        );
      }

      const targetDimensions = resolveDimensions(params.size, params.aspectRatio);
      const res = await generateImages(
        model,
        {
          input: [{ type: "text", text: params.prompt }],
        },
        {
          apiKey,
          signal,
          ...(targetDimensions ? { size: targetDimensions } : {}),
          ...(params.quality ? { quality: params.quality } : {}),
          ...(params.style ? { style: params.style } : {}),
        } as any,
      );

      if (res.stopReason === "error") {
        throw new Error(res.errorMessage || "Image generation failed");
      }
      if (res.stopReason === "aborted") {
        throw new Error("Image generation aborted");
      }

      const imagePart = res.output.find((part) => part.type === "image");
      if (!imagePart || imagePart.type !== "image") {
        throw new Error("No image data returned from provider");
      }

      const buffer = Buffer.from(imagePart.data, "base64");
      const detectedMime = detectBufferMimeType(buffer) || imagePart.mimeType || "image/png";
      const ext = mimeToExtension(detectedMime);
      const randomSuffix = Math.random().toString(36).slice(2, 8);
      const defaultName = `assets/generated_${Date.now()}_${randomSuffix}.${ext}`;
      const rawPath = params.outputPath
        ? extname(params.outputPath)
          ? params.outputPath
          : `${params.outputPath}.${ext}`
        : defaultName;

      const absolutePath = resolveToCwd(rawPath, cwd);
      const dir = dirname(absolutePath);
      const relPath = relative(cwd, absolutePath) || rawPath;
      const revisedPrompt = res.output.find((p) => p.type === "text")?.text;

      return withFileMutationQueue(absolutePath, async () => {
        if (signal?.aborted) throw new Error("Operation aborted");
        await ops.mkdir(dir);
        if (signal?.aborted) throw new Error("Operation aborted");

        const tempPath = `${absolutePath}.tmp.${Date.now()}.${randomSuffix}`;
        try {
          await ops.writeFile(tempPath, buffer);
          if (signal?.aborted) throw new Error("Operation aborted");
          await ops.rename(tempPath, absolutePath);
        } catch (err) {
          await ops.unlink(tempPath).catch(() => {});
          throw err;
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully generated image and saved to ${relPath} (${buffer.length} bytes, ${detectedMime})`,
            },
          ],
          details: {
            outputPath: relPath,
            bytes: buffer.length,
            mimeType: detectedMime,
            prompt: params.prompt,
            revisedPrompt,
            provider: model.provider,
            model: model.id,
            dimensions: targetDimensions,
          },
        };
      });
    },
    renderCall(args, theme, context) {
      const renderArgs = args as Partial<GenerateImageToolInput> | undefined;
      const prompt = str(renderArgs?.prompt);
      const outputPath = str(renderArgs?.outputPath);
      const target = outputPath ? renderToolPath(outputPath, theme, context.cwd) : "auto-generated path";
      const text = new Text("", 0, 0);
      const line = `${theme.fg("accent", "generate_image")} ${prompt ? theme.fg("dim", `"${normalizeDisplayText(prompt)}"`) : ""} → ${theme.fg("muted", target)}`;
      text.setText(line);
      return text;
    },
    renderResult(result, _options, theme, context) {
      if (context.isError) {
        let output = result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text || "")
          .join("\n");
        if (!context.showHarnessMessages) {
          output = stripHarnessMessages(output);
        }
        const text = new Text("", 0, 0);
        text.setText(`\n${theme.fg("error", output || "Failed to generate image")}`);
        return text;
      }
      const component = (context.lastComponent as Container | undefined) ?? new Container();
      component.clear();
      return component;
    },
  };
}

export function createGenerateImageTool(
  cwd: string,
  options?: GenerateImageToolOptions,
): AgentTool<typeof generateImageSchema> {
  return wrapToolDefinition(createGenerateImageToolDefinition(cwd, options));
}
