import { describe, expect, it } from "vitest";
import { parseJsonWithRepair, parseStreamingJson, repairJson } from "../src/utils/json-parse.ts";

describe("json-parse utilities", () => {
  describe("repairJson", () => {
    it("leaves valid JSON untouched", () => {
      const valid = '{"name":"test","count":42,"active":true,"list":[1,2,3]}';
      expect(repairJson(valid)).toBe(valid);
    });

    it("escapes control characters inside string literals", () => {
      const jsonWithControl = '{"msg":"hello\nworld\ttab\rreturn\bback\fform\x07bell"}';
      const repaired = repairJson(jsonWithControl);
      expect(repaired).toContain("\\n");
      expect(repaired).toContain("\\t");
      expect(repaired).toContain("\\r");
      expect(repaired).toContain("\\b");
      expect(repaired).toContain("\\f");
      expect(repaired).toContain("\\u0007");
      expect(() => JSON.parse(repaired)).not.toThrow();
    });

    it("repairs dangling backslashes and invalid escape sequences", () => {
      expect(repairJson(String.raw`{"str":"invalid \x escape"}`)).toBe(String.raw`{"str":"invalid \\x escape"}`);
      expect(repairJson(String.raw`{"str":"incomplete unicode \u12"}`)).toBe(
        String.raw`{"str":"incomplete unicode \u12"}`,
      );
      expect(repairJson(String.raw`{"str":"valid unicode \u0041"}`)).toBe(String.raw`{"str":"valid unicode \u0041"}`);
    });
  });

  describe("parseJsonWithRepair", () => {
    it("parses valid JSON directly", () => {
      const res = parseJsonWithRepair<{ a: number }>('{"a":123}');
      expect(res).toEqual({ a: 123 });
    });

    it("repairs malformed JSON and parses it successfully", () => {
      const res = parseJsonWithRepair<{ text: string }>('{"text":"line1\nline2"}');
      expect(res).toEqual({ text: "line1\nline2" });
    });

    it("throws error if JSON cannot be repaired", () => {
      expect(() => parseJsonWithRepair("not json")).toThrow();
    });
  });

  describe("parseStreamingJson", () => {
    it("returns empty object for empty or undefined input", () => {
      expect(parseStreamingJson(undefined)).toEqual({});
      expect(parseStreamingJson("")).toEqual({});
      expect(parseStreamingJson("   ")).toEqual({});
    });

    it("parses complete and partial JSON structures", () => {
      expect(parseStreamingJson('{"status": "ok"}')).toEqual({ status: "ok" });
      expect(parseStreamingJson('{"key": "val')).toEqual({ key: "val" });
      expect(parseStreamingJson('{"items": [1, 2,')).toEqual({ items: [1, 2] });
    });

    it("handles fallback to repairJson on partial JSON", () => {
      const res = parseStreamingJson('{"path": "C:\\Program Files\\');
      expect(res).toBeDefined();
    });

    it("returns empty object for completely unparseable input", () => {
      expect(parseStreamingJson("<<<<>>>")).toEqual({});
    });
  });
});
