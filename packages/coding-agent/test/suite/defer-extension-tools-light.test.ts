import type { AssistantMessage, Context, ToolCall } from "@dst0/p-ai";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { Settings } from "../../src/core/settings-manager.ts";
import type { ExtensionFactory } from "../../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

const WIDGET_TOOL_NAME = "widget_lookup";
const WIDGET_DESCRIPTION = "Look up SKU metadata from the internal widget catalog service";
const WIDGET_SNIPPET = "widget_lookup(id): fetch widget metadata from the catalog service";

/** A weakly-described tool: nothing in its text hints at what it does, only its exact name does. */
const OBSCURE_TOOL_NAME = "zzq_util7";

/** A supervisor-style tool that opts out of deferral via alwaysActive. */
const ALWAYS_ACTIVE_TOOL_NAME = "supervisor_ping";
const ALWAYS_ACTIVE_SNIPPET = "supervisor_ping(): heartbeat check-in";

/** Registers extension tools with a promptSnippet, gated behind session_start like a real MCP wrapper. */
const catalogExtension: ExtensionFactory = (pi) => {
  pi.on("session_start", () => {
    pi.registerTool({
      name: WIDGET_TOOL_NAME,
      label: "Widget Lookup",
      description: WIDGET_DESCRIPTION,
      promptSnippet: WIDGET_SNIPPET,
      parameters: Type.Object({ id: Type.String() }),
      execute: async (_toolCallId, params) => ({
        content: [{ type: "text", text: `widget:${params.id}` }],
        details: {},
      }),
    });
    pi.registerTool({
      name: OBSCURE_TOOL_NAME,
      label: "zzq_util7",
      description: "Does a thing.",
      promptSnippet: "zzq_util7(): does a thing",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "done" }], details: {} }),
    });
    pi.registerTool({
      name: ALWAYS_ACTIVE_TOOL_NAME,
      label: "Supervisor Ping",
      description: "Always-on heartbeat tool that must stay active every turn",
      promptSnippet: ALWAYS_ACTIVE_SNIPPET,
      alwaysActive: true,
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
    });
  });
};

function toolMessage(call: ToolCall): AssistantMessage {
  return fauxAssistantMessage([call], { stopReason: "toolUse" });
}

interface CapturedRequest {
  systemPrompt: string;
  tools: Array<{ name: string; description: string; parameters: unknown }>;
}

/** Captures the full provider request, including tool schemas, unlike the shared adaptive fixture. */
function captureRequests(harness: Harness, ...responses: AssistantMessage[]): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  harness.setResponses(
    responses.map((response) => (context: Context): AssistantMessage => {
      captured.push({
        systemPrompt: context.systemPrompt ?? "",
        tools: (context.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      });
      return response;
    }),
  );
  return captured;
}

function totalToolChars(request: CapturedRequest | undefined): number {
  if (!request) return 0;
  return request.tools.reduce(
    (sum, tool) => sum + tool.name.length + tool.description.length + JSON.stringify(tool.parameters).length,
    0,
  );
}

describe("defer extension tools while LIGHT", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  async function setup(settings?: Partial<Settings>): Promise<Harness> {
    const harness = await createHarness({
      taskVerificationMode: "auto",
      extensionFactories: [catalogExtension],
      settings,
    });
    harnesses.push(harness);
    await harness.session.bindExtensions({});
    return harness;
  }

  it("keeps the schema and snippet out of the first LIGHT request, then finds and runs it via tool_search", async () => {
    const harness = await setup();
    expect(harness.session.getVerificationTierStatus()?.tier).toBe("light");
    expect(harness.session.getActiveToolNames()).not.toContain(WIDGET_TOOL_NAME);

    const firstRequests = captureRequests(harness, fauxAssistantMessage("2+2 is 4."));
    await harness.session.prompt("What is 2+2?");
    expect(firstRequests[0]?.tools.map((tool) => tool.name)).not.toContain(WIDGET_TOOL_NAME);
    expect(firstRequests[0]?.systemPrompt).not.toContain(WIDGET_SNIPPET);
    expect(firstRequests[0]?.systemPrompt).not.toContain(WIDGET_DESCRIPTION);
    // Deferred tools still show up in a compact catalog (name + truncated description), so the model
    // knows to tool_search for them instead of assuming they don't exist.
    expect(firstRequests[0]?.systemPrompt).toContain(`${WIDGET_TOOL_NAME} — ${WIDGET_DESCRIPTION.slice(0, 60)}`);
    expect(firstRequests[0]?.systemPrompt).toContain(`${OBSCURE_TOOL_NAME} — Does a thing.`);

    const secondRequests = captureRequests(
      harness,
      toolMessage(fauxToolCall("tool_search", { query: "widget catalog lookup" })),
      toolMessage(fauxToolCall(WIDGET_TOOL_NAME, { id: "42" })),
      fauxAssistantMessage("It is a small blue widget."),
    );
    await harness.session.prompt("Look up widget 42 in the catalog.");

    const search = harness.eventsOfType("tool_execution_end").find((event) => event.toolName === "tool_search");
    expect((search?.result.details as { activated: string[] }).activated).toContain(WIDGET_TOOL_NAME);
    expect(secondRequests[1]?.tools.map((tool) => tool.name)).toContain(WIDGET_TOOL_NAME);

    const widgetCall = harness.eventsOfType("tool_execution_end").find((event) => event.toolName === WIDGET_TOOL_NAME);
    expect(widgetCall?.isError).toBe(false);
    expect(JSON.stringify(widgetCall?.result.content)).toContain("widget:42");

    // Sticky by design: a tool activated via tool_search stays active for later LIGHT turns too.
    const thirdRequests = captureRequests(harness, fauxAssistantMessage("Nothing else to do."));
    await harness.session.prompt("Anything else?");
    expect(harness.session.getVerificationTierStatus()?.tier).toBe("light");
    expect(thirdRequests[0]?.tools.map((tool) => tool.name)).toContain(WIDGET_TOOL_NAME);
  });

  it("keeps the tool active from turn 1 under STRICT", async () => {
    const harness = await createHarness({ taskVerificationMode: "strict", extensionFactories: [catalogExtension] });
    harnesses.push(harness);
    await harness.session.bindExtensions({});

    expect(harness.session.getVerificationTierStatus()?.tier).toBe("strict");
    expect(harness.session.getActiveToolNames()).toContain(WIDGET_TOOL_NAME);
    expect(harness.session.systemPrompt).toContain(WIDGET_SNIPPET);
  });

  it("defers even under STRICT when the setting is 'always', until tool_search activates it", async () => {
    const harness = await createHarness({
      taskVerificationMode: "strict",
      extensionFactories: [catalogExtension],
      settings: { tools: { deferExtensionTools: "always" } },
    });
    harnesses.push(harness);
    await harness.session.bindExtensions({});

    expect(harness.session.getVerificationTierStatus()?.tier).toBe("strict");
    expect(harness.session.getActiveToolNames()).not.toContain(WIDGET_TOOL_NAME);
    expect(harness.session.systemPrompt).not.toContain(WIDGET_SNIPPET);
    expect(harness.session.systemPrompt).toContain(WIDGET_TOOL_NAME);

    const requests = captureRequests(
      harness,
      toolMessage(fauxToolCall("tool_search", { names: [WIDGET_TOOL_NAME] })),
      fauxAssistantMessage("Found it."),
    );
    await harness.session.prompt("Look up widget 1 in the catalog.");
    expect(harness.session.getActiveToolNames()).toContain(WIDGET_TOOL_NAME);
    expect(requests[1]?.tools.map((tool) => tool.name)).toContain(WIDGET_TOOL_NAME);
  });

  it("keeps an alwaysActive tool active while sibling extension tools defer under LIGHT", async () => {
    const harness = await setup();

    expect(harness.session.getActiveToolNames()).toContain(ALWAYS_ACTIVE_TOOL_NAME);
    expect(harness.session.getActiveToolNames()).not.toContain(WIDGET_TOOL_NAME);
    expect(harness.session.systemPrompt).toContain(ALWAYS_ACTIVE_SNIPPET);
  });

  it("restores today's behavior when the setting is 'never'", async () => {
    const harness = await setup({ tools: { deferExtensionTools: "never" } });

    expect(harness.session.getVerificationTierStatus()?.tier).toBe("light");
    expect(harness.session.getActiveToolNames()).toContain(WIDGET_TOOL_NAME);
    expect(harness.session.systemPrompt).toContain(WIDGET_SNIPPET);
  });

  it("finds a weakly-described deferred tool by its exact name", async () => {
    const harness = await setup();
    expect(harness.session.getActiveToolNames()).not.toContain(OBSCURE_TOOL_NAME);

    const requests = captureRequests(
      harness,
      toolMessage(fauxToolCall("tool_search", { query: "unrelated capability", names: [OBSCURE_TOOL_NAME] })),
      fauxAssistantMessage("Done."),
    );
    await harness.session.prompt("Run the obscure utility.");

    const search = harness.eventsOfType("tool_execution_end").find((event) => event.toolName === "tool_search");
    expect((search?.result.details as { activated: string[] }).activated).toContain(OBSCURE_TOOL_NAME);
    expect(requests[1]?.tools.map((tool) => tool.name)).toContain(OBSCURE_TOOL_NAME);
  });

  it("measures a smaller static system prompt and tool schema footprint than the 'never' setting", async () => {
    const lightHarness = await setup();
    const neverHarness = await setup({ tools: { deferExtensionTools: "never" } });

    const lightRequests = captureRequests(lightHarness, fauxAssistantMessage("hi"));
    await lightHarness.session.prompt("hi");
    const neverRequests = captureRequests(neverHarness, fauxAssistantMessage("hi"));
    await neverHarness.session.prompt("hi");
    const lightRequest = lightRequests[0];
    const neverRequest = neverRequests[0];

    expect(lightRequest?.tools.map((tool) => tool.name)).not.toContain(WIDGET_TOOL_NAME);
    expect(neverRequest?.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([WIDGET_TOOL_NAME, OBSCURE_TOOL_NAME]),
    );

    const lightTotal = (lightRequest?.systemPrompt.length ?? 0) + totalToolChars(lightRequest);
    const neverTotal = (neverRequest?.systemPrompt.length ?? 0) + totalToolChars(neverRequest);
    expect(neverTotal).toBeGreaterThan(lightTotal);
    expect(neverTotal - lightTotal).toBeGreaterThan(WIDGET_DESCRIPTION.length);
  });
});
