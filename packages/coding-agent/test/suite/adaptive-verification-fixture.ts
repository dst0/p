import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AssistantMessage, Context, FauxContentBlock, FauxResponseFactory } from "@dst0/p-ai";
import { fauxAssistantMessage } from "@dst0/p-ai";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

/** Tools that belong to the STRICT verification ceremony and must not reach a LIGHT request. */
export const CEREMONY_TOOL_NAMES = [
  "record_task_verification",
  "finish_work",
  "update_session_state",
  "mark_session_progress",
] as const;

export interface CapturedRequest {
  systemPrompt: string;
  toolNames: string[];
  messageTexts: string[];
}

export interface AdaptiveHarness {
  harness: Harness;
  requests: CapturedRequest[];
  respond(...responses: Array<AssistantMessage | ((request: CapturedRequest) => AssistantMessage)>): void;
}

function messageText(message: Context["messages"][number]): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : part.type === "toolCall" ? `toolCall:${part.name}` : ""))
    .join("\n");
}

/** Harness whose faux responses record every provider request they answer. */
export async function createAdaptiveHarness(options: HarnessOptions = {}): Promise<AdaptiveHarness> {
  const harness = await createHarness({ taskVerificationMode: "auto", ...options });
  const requests: CapturedRequest[] = [];
  return {
    harness,
    requests,
    respond(...responses) {
      harness.setResponses(
        responses.map(
          (response): FauxResponseFactory =>
            (context) => {
              const request = {
                systemPrompt: context.systemPrompt ?? "",
                toolNames: (context.tools ?? []).map((tool) => tool.name),
                messageTexts: context.messages.map(messageText),
              };
              requests.push(request);
              return typeof response === "function" ? response(request) : response;
            },
        ),
      );
    },
  };
}

export function tools(...calls: FauxContentBlock[]): AssistantMessage {
  return fauxAssistantMessage(calls, { stopReason: "toolUse" });
}

export function writeWorkspaceFile(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Commits the fixture so the controller tracks changes through Git status. */
export function initGitRepository(root: string): void {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "maintenance.auto", "false");
  git("config", "gc.auto", "0");
  git("config", "gc.autoDetach", "false");
  git("add", "-A");
  git("-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "fixture", "--allow-empty");
}
