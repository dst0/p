import { getImageModel } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import {
  parseAspectRatio,
  parseSize,
  resolveAspectRatio,
  resolveDimensions,
  validateDimensionsForModel,
} from "../src/core/tools/image-dimensions.ts";

describe("image-dimensions calculation and validation", () => {
  it("allows arbitrary freely set dimensions without aspectRatio", () => {
    expect(resolveDimensions("1920x1080")).toBe("1920x1080");
    expect(resolveDimensions("800x600")).toBe("800x600");
    expect(resolveDimensions("3840x2160")).toBe("3840x2160");
    expect(resolveDimensions("512x512")).toBe("512x512");
    expect(resolveDimensions("1234x567")).toBe("1234x567");
  });

  it("calculates dimensions from standard and custom aspect ratios", () => {
    expect(resolveAspectRatio("1:1")).toBe("1024x1024");
    expect(resolveAspectRatio("16:9")).toBe("1792x1024");
    expect(resolveAspectRatio("9:16")).toBe("1024x1792");
    expect(resolveAspectRatio("4:3")).toBe("1024x768");
    expect(resolveAspectRatio("3:2")).toBe("1200x800");
    expect(resolveAspectRatio("21:9")).toBe("1792x768");

    // Custom arbitrary ratios calculate dimensions near 1 megapixel
    const custom54 = resolveAspectRatio("5:4");
    expect(custom54).toBeDefined();
    const parsed54 = parseSize(custom54);
    expect(parsed54).toBeDefined();
    expect(Math.abs(parsed54!.ratio - 1.25)).toBeLessThan(0.05);

    const decimalRatio = resolveAspectRatio("1.5");
    expect(decimalRatio).toBeDefined();
    const parsedDecimal = parseSize(decimalRatio);
    expect(Math.abs(parsedDecimal!.ratio - 1.5)).toBeLessThan(0.05);
  });

  it("accepts freely set dimensions when matching calculated aspectRatio within tolerance", () => {
    expect(resolveDimensions("1920x1080", "16:9")).toBe("1920x1080");
    expect(resolveDimensions("1792x1024", "16:9")).toBe("1792x1024");
    expect(resolveDimensions("1280x720", "16:9")).toBe("1280x720");
    expect(resolveDimensions("800x600", "4:3")).toBe("800x600");
    expect(resolveDimensions("1024x768", "4:3")).toBe("1024x768");
    expect(resolveDimensions("500x500", "1:1")).toBe("500x500");
  });

  it("throws error when freely set dimensions conflict with specified aspectRatio", () => {
    expect(() => resolveDimensions("1920x1080", "9:16")).toThrow("Conflicting size");
    expect(() => resolveDimensions("1024x1024", "16:9")).toThrow("Conflicting size");
    expect(() => resolveDimensions("1792x1024", "1:1")).toThrow("Conflicting size");
    expect(() => resolveDimensions("800x600", "16:9")).toThrow("Conflicting size");
  });

  it("throws error on invalid aspectRatio format", () => {
    expect(() => parseAspectRatio("invalid")).toThrow("Invalid aspectRatio format");
    expect(() => parseAspectRatio("0:0")).toThrow("Invalid aspectRatio format");
    expect(() => parseAspectRatio("-1:5")).toThrow("Invalid aspectRatio format");
    expect(() => parseAspectRatio("abc:def")).toThrow("Invalid aspectRatio format");
  });

  it("parses various size formats correctly", () => {
    expect(parseSize("1920x1080")).toEqual({ width: 1920, height: 1080, ratio: 1920 / 1080 });
    expect(parseSize("800*600")).toEqual({ width: 800, height: 600, ratio: 800 / 600 });
    expect(parseSize("1024×1024")).toEqual({ width: 1024, height: 1024, ratio: 1 });
    expect(parseSize("invalid")).toBeUndefined();
    expect(parseSize("")).toBeUndefined();
  });

  it("rejects malformed explicit dimensions instead of forwarding them to a provider", () => {
    expect(() => resolveDimensions("invalid")).toThrow("Invalid size format");
    expect(() => resolveDimensions("0x1024")).toThrow("Invalid size format");
    expect(() => resolveDimensions("1024x0")).toThrow("Invalid size format");
  });

  it("applies GPT Image 2 limits without constraining llm-orchestrator dimensions", () => {
    const openaiModel = getImageModel("openai", "gpt-image-2");
    const orchestratorModel = getImageModel("llm-orchestrator", "flux2-klein-4b");
    expect(openaiModel).toBeDefined();
    expect(orchestratorModel).toBeDefined();

    expect(() => validateDimensionsForModel(openaiModel!, "1024x1024")).not.toThrow();
    expect(() => validateDimensionsForModel(openaiModel!, "1234x567")).toThrow("multiples of 16");
    expect(() => validateDimensionsForModel(openaiModel!, "4096x1024")).toThrow("3840 pixels");
    expect(() => validateDimensionsForModel(orchestratorModel!, "1234x567")).not.toThrow();
  });
});
