import type { AgentTool } from "@dst0/p-agent-core";
import { detectImageMimeType, generateImages, type ImagesModel } from "@dst0/p-ai";
import { Container, Text } from "@dst0/p-tui";
import { mkdir as fsMkdir, rename as fsRename, unlink as fsUnlink, writeFile as fsWriteFile } from "fs/promises";
import { dirname, extname, relative } from "path";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveDimensions } from "./image-dimensions.ts";
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
  writeFile: (absolutePath: string, buffer: Buffer, signal?: AbortSignal) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}

const defaultGenerateImageOperations: GenerateImageOperations = {
  writeFile: (path, buffer, signal) => fsWriteFile(path, buffer, { signal }),
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
      const detectedMime = detectImageMimeType(buffer);
      if (!detectedMime) {
        throw new Error("Generated image data contains unrecognized or invalid binary format");
      }

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
          await ops.writeFile(tempPath, buffer, signal);
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
