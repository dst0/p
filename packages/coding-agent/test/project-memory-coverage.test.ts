import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@dst0/p-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { do_pinProjectMemory } from "../src/core/agent-session/agentsession-methods/project-memory.ts";
import { capText } from "../src/core/project-memory/init.ts";
import { atomicWriteFileSync } from "../src/core/project-memory/migration.ts";
import { initProjectMemory, searchProjectMemory } from "../src/core/project-memory.ts";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";
import { do_handleMemoryCommand } from "../src/modes/interactive/interactive-mode/interactivemode-methods/memory-command.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const tempDirs: string[] = [];

function createTempProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-project-memory-coverage-"));
  mkdirSync(join(cwd, ".git"));
  writeFileSync(join(cwd, ".git/HEAD"), "ref: refs/heads/main\n", "utf8");
  tempDirs.push(cwd);
  return cwd;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

beforeAll(() => {
  initTheme("dark");
});

describe("project memory edge paths", () => {
  it("pins through the AgentSession delegate", () => {
    const cwd = createTempProject();
    const self = { _cwd: cwd } as Parameters<typeof do_pinProjectMemory>[0];

    const result = do_pinProjectMemory(self, "Delegate-pinned durable fact");

    expect(result.id).toMatch(/^pin-/);
    expect(searchProjectMemory(cwd, "Delegate-pinned").hits).toHaveLength(1);
  });

  it("caps oversized memory context with a truncation marker", () => {
    const text = `${"a".repeat(250)}UNREACHABLE_TAIL`;

    const capped = capText(text, 1);

    expect(capped).toHaveLength(198);
    expect(capped.endsWith("\n[truncated]")).toBe(true);
    expect(capped).not.toContain("UNREACHABLE_TAIL");
  });

  it("removes an atomic-write temporary file when rename fails", () => {
    const cwd = createTempProject();
    const destination = join(cwd, "destination.md");
    mkdirSync(destination);

    expect(() => atomicWriteFileSync(destination, "content")).toThrow();
    expect(readdirSync(cwd)).toContain("destination.md");
    expect(readdirSync(cwd).some((entry) => entry.endsWith(".tmp"))).toBe(false);
  });

  it("traverses visible memory subdirectories but skips hidden ones", () => {
    const cwd = createTempProject();
    initProjectMemory(cwd);
    mkdirSync(join(cwd, ".pdev/memory/.private"), { recursive: true });
    mkdirSync(join(cwd, ".pdev/memory/design"), { recursive: true });
    writeFileSync(join(cwd, ".pdev/memory/.private/secret.md"), "HIDDEN_MEMORY_TOKEN", "utf8");
    writeFileSync(join(cwd, ".pdev/memory/design/architecture.md"), "PUBLIC_MEMORY_TOKEN", "utf8");

    expect(searchProjectMemory(cwd, "HIDDEN_MEMORY_TOKEN").hits).toHaveLength(0);
    expect(searchProjectMemory(cwd, "PUBLIC_MEMORY_TOKEN").hits).toHaveLength(1);
  });
});

describe("memory command edge paths", () => {
  it("shows usage for an unknown memory command", () => {
    const children: Component[] = [];
    const self = {
      chatContainer: {
        addChild(child: Component): void {
          children.push(child);
        },
      },
      ui: { requestRender: vi.fn() },
      showError: vi.fn(),
    } as unknown as InteractiveMode;

    do_handleMemoryCommand(self, "/memory unsupported");

    const output = children.flatMap((child) => child.render(120)).join("\n");
    expect(output).toContain("Usage: /memory [status|init|search <query>|pin <text>|forget <id>]");
    expect(self.ui.requestRender).toHaveBeenCalledTimes(1);
  });
});
