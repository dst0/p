import { describe, expect, it } from "vitest";
import { getImagesApiProvider, registerImagesApiProvider } from "../src/images-api-registry.ts";

describe("Images API Registry", () => {
  it("registers and gets", () => {
    let generated = false;
    registerImagesApiProvider(
      {
        api: "openai-images" as any,
        generateImages: async () => {
          generated = true;
          return {} as any;
        },
      },
      "src1",
    );

    const p = getImagesApiProvider("openai-images" as any);
    expect(p).toBeDefined();

    p!.generateImages({ api: "openai-images" } as any, {} as any, {});
    expect(generated).toBe(true);

    expect(() => p!.generateImages({ api: "wrong" } as any, {} as any, {})).toThrow("Mismatched api");
  });
});
