import { describe, expect, it } from "vitest";
import {
  type DeferredToolCatalogEntry,
  formatDeferredToolsCatalog,
} from "../src/core/system-prompt/deferred-tools-catalog.ts";

const LONG_DESCRIPTION = (index: number): string =>
  `Overflow test tool number ${String(index).padStart(2, "0")} exercising the deferred catalog line budget cap`;

describe("formatDeferredToolsCatalog", () => {
  it("returns undefined for no deferred tools", () => {
    expect(formatDeferredToolsCatalog([])).toBeUndefined();
  });

  it("renders a full 'name — truncated description' entry for a single short-enough tool", () => {
    const result = formatDeferredToolsCatalog([{ name: "widget_lookup", description: "Look up widget metadata" }]);
    expect(result).toBe("- widget_lookup — Look up widget metadata");
  });

  it("truncates a description longer than 60 characters with an ellipsis", () => {
    const description = LONG_DESCRIPTION(1); // 74 chars, well over the 60-char entry cap
    const result = formatDeferredToolsCatalog([{ name: "long_tool", description }]);
    expect(result).toBe(`- long_tool — ${description.slice(0, 60)}…`);
  });

  it("lists entries beyond the ~600-char catalog cap by name only, never dropping a tool entirely", () => {
    // 20 long-description entries comfortably exceed the ~600-char cap well before the last one,
    // proving both that early entries still render in full and that later ones are not silently hidden.
    const entries: DeferredToolCatalogEntry[] = Array.from({ length: 20 }, (_, i) => ({
      name: `ext_tool_${String(i).padStart(2, "0")}`,
      description: LONG_DESCRIPTION(i),
    }));

    const result = formatDeferredToolsCatalog(entries);
    expect(result).toBeDefined();
    const text = result ?? "";

    // The first entry comfortably fits and renders as a full "name — description" line.
    expect(text).toContain(`- ext_tool_00 — ${LONG_DESCRIPTION(0).slice(0, 60)}…`);

    // The names-only overflow line exists and names the last (definitely overflowed) tool.
    expect(text).toContain("- Also available via tool_search:");
    expect(text).toMatch(/Also available via tool_search:.*ext_tool_19/);

    // Every entry's name is still present somewhere (nothing is silently dropped from the catalog)...
    for (const entry of entries) {
      expect(text).toContain(entry.name);
    }

    // ...but the overflowed tool is named only in the trailing summary, never rendered as a full entry.
    expect(text).not.toContain(`- ext_tool_19 — `);

    // The cap actually did something: far shorter than if all 20 entries rendered in full.
    const uncapped = formatDeferredToolsCatalog(entries, Number.POSITIVE_INFINITY) ?? "";
    expect(text.length).toBeLessThan(uncapped.length);
  });

  it("always includes at least one full entry even if it alone exceeds the cap", () => {
    const hugeDescription = "x".repeat(500);
    const result = formatDeferredToolsCatalog([{ name: "solo_tool", description: hugeDescription }], 50);
    expect(result).toBe(`- solo_tool — ${hugeDescription.slice(0, 60)}…`);
  });
});
