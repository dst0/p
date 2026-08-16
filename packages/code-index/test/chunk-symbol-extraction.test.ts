import { describe, expect, it } from "vitest";
import { chunkFile } from "../src/chunk.ts";

describe("code chunking and multi-language symbol extraction", () => {
  it("handles empty content", () => {
    expect(chunkFile("", "typescript")).toEqual([]);
    expect(chunkFile("\n", "typescript")).toEqual([]);
  });

  it("handles fallback to fixed size for unsupported language", () => {
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`).join("\n");
    const chunks = chunkFile(lines, "plaintext", 50, 100);
    expect(chunks.length).toBe(3);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(50);
  });

  it("chunks by symbols for Go language", () => {
    const goCode = [
      "package main",
      "",
      "func HandleRequest() {",
      "  println(1)",
      "}",
      "",
      "func main() {",
      "  println(2)",
      "}",
    ].join("\n");
    const chunks = chunkFile(goCode, "go", 10, 50);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.symbol === "func HandleRequest()")).toBe(true);
  });

  it("chunks by symbols for Rust, Python, Swift, Ruby, C, CPP, Java", () => {
    const rustCode = "pub struct User {\n  id: u64,\n}\n\npub fn calculate() {\n}\n";
    const rustChunks = chunkFile(rustCode, "rust", 10, 50);
    expect(rustChunks.length).toBe(2);
    expect(rustChunks[0].symbol).toBe("struct User");
    expect(rustChunks[1].symbol).toBe("fn calculate");

    const pyCode = "def process():\n  pass\n\n@decorator\n# comment\nclass Runner:\n  pass\n";
    const pyChunks = chunkFile(pyCode, "python", 10, 50);
    expect(pyChunks.length).toBe(2);
    expect(pyChunks[0].symbol).toBe("def process");
    expect(pyChunks[1].symbol).toBe("class Runner");

    const swiftCode = "struct Item {\n}\n\nfunc execute() {\n}\n";
    const swiftChunks = chunkFile(swiftCode, "swift", 10, 50);
    expect(swiftChunks.length).toBe(2);
    expect(swiftChunks[0].symbol).toBe("struct Item");
    expect(swiftChunks[1].symbol).toBe("func execute");

    const rubyCode = "class Worker\nend\n\ndef perform\nend\n";
    const rubyChunks = chunkFile(rubyCode, "ruby", 10, 50);
    expect(rubyChunks.length).toBe(2);
    expect(rubyChunks[0].symbol).toBe("class Worker");
    expect(rubyChunks[1].symbol).toBe("def perform");

    const cppCode = "class Engine {\n};\n\nint run() {\n  return 0;\n}\n";
    const cppChunks = chunkFile(cppCode, "cpp", 10, 50);
    expect(cppChunks.length).toBe(2);
    expect(cppChunks[0].symbol).toBe("class Engine");
    expect(cppChunks[1].symbol).toBe("int run");

    const cCode = "struct Point {\n  int x;\n};\n\nvoid draw() {\n}\n";
    const cChunks = chunkFile(cCode, "c", 10, 50);
    expect(cChunks.length).toBe(2);
    expect(cChunks[0].symbol).toBe("struct Point");
    expect(cChunks[1].symbol).toBe("void draw");

    const javaCode = "public class App {\n}\n\npublic static void main() {\n}\n";
    const javaChunks = chunkFile(javaCode, "java", 10, 50);
    expect(javaChunks.length).toBe(2);
    expect(javaChunks[0].symbol).toBe("class App");
    expect(javaChunks[1].symbol).toBe("void main");
  });

  it("handles JSDoc block comments and contiguous decorators", () => {
    const tsCode = [
      "/**",
      " * Documentation for function",
      " */",
      "@logged",
      "@timed",
      "export function doWork() {",
      "  return 42;",
      "}",
    ].join("\n");
    const chunks = chunkFile(tsCode, "typescript", 10, 50);
    expect(chunks.length).toBe(1);
    expect(chunks[0].symbol).toBe("function doWork");
    expect(chunks[0].text).toContain("/**");
  });

  it("splits large symbol chunks exceeding maxChunkLines into fixed pieces", () => {
    const largeFunc = [
      "function massiveFunction() {",
      ...Array.from({ length: 250 }, (_, i) => `  data[${i}] = ${i};`),
      "}",
    ].join("\n");
    const chunks = chunkFile(largeFunc, "typescript", 50, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].chunkType).toBe("section");
  });

  it("handles consecutive declarations that backtrack to previous boundaries", () => {
    const code = ["// First comment", "const a = 1;", "// Second comment immediately attached", "const b = 2;"].join(
      "\n",
    );
    const chunks = chunkFile(code, "typescript", 10, 50);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.symbol)).toEqual(["const a", "const b"]);
  });

  it("handles multi-line decorators with blank lines and python comments", () => {
    const code = [
      "",
      "",
      "# Controller doc",
      "# line 2",
      "",
      "@decorator1",
      "",
      "@decorator2",
      "def handle():",
      "    pass",
    ].join("\n");

    const chunks = chunkFile(code, "python", 10, 50);
    expect(chunks.length).toBe(1);
    expect(chunks[0].symbol).toBe("def handle");
    expect(chunks[0].text).toContain("# Controller doc");
  });
});
