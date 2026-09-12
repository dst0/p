import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectTrustContext } from "../src/core/extensions/types.ts";
import { resolveProjectTrusted } from "../src/core/project-trust.ts";
import { ProjectTrustStore } from "../src/core/trust-manager.ts";

describe("project-agent trust source binding", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `project-agent-trust-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not let a nested cwd decision authorize agents discovered from an ancestor", async () => {
    const projectRoot = join(tempDir, "project");
    const nestedCwd = join(projectRoot, "packages", "feature");
    const agentDir = join(tempDir, "agent-home");
    mkdirSync(join(projectRoot, ".p", "agents"), { recursive: true });
    mkdirSync(nestedCwd, { recursive: true });
    const store = new ProjectTrustStore(agentDir);
    const context: ProjectTrustContext = {
      cwd: nestedCwd,
      mode: "json",
      hasUI: false,
      ui: {
        select: vi.fn(async () => undefined),
        confirm: vi.fn(async () => false),
        input: vi.fn(async () => undefined),
        notify: vi.fn(),
      },
    };

    store.set(nestedCwd, true);
    expect(await resolveProjectTrusted({ cwd: nestedCwd, trustStore: store, projectTrustContext: context })).toBe(
      false,
    );

    store.set(projectRoot, true);
    expect(await resolveProjectTrusted({ cwd: nestedCwd, trustStore: store, projectTrustContext: context })).toBe(true);
  });

  it("requires every mixed-source resource root to be trusted", async () => {
    const projectRoot = join(tempDir, "mixed-project");
    const nestedCwd = join(projectRoot, "packages", "feature");
    const agentDir = join(tempDir, "mixed-agent-home");
    mkdirSync(join(projectRoot, ".p", "agents"), { recursive: true });
    mkdirSync(join(nestedCwd, ".p"), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(nestedCwd, ".p", "settings.json"), "{}");
    const store = new ProjectTrustStore(agentDir);
    const context: ProjectTrustContext = {
      cwd: nestedCwd,
      mode: "json",
      hasUI: false,
      ui: {
        select: vi.fn(async () => undefined),
        confirm: vi.fn(async () => false),
        input: vi.fn(async () => undefined),
        notify: vi.fn(),
      },
    };

    store.set(projectRoot, true);
    store.set(nestedCwd, false);
    expect(await resolveProjectTrusted({ cwd: nestedCwd, trustStore: store, projectTrustContext: context })).toBe(
      false,
    );

    store.set(projectRoot, false);
    store.set(nestedCwd, true);
    expect(await resolveProjectTrusted({ cwd: nestedCwd, trustStore: store, projectTrustContext: context })).toBe(
      false,
    );

    store.set(projectRoot, true);
    expect(await resolveProjectTrusted({ cwd: nestedCwd, trustStore: store, projectTrustContext: context })).toBe(true);
  });
});
