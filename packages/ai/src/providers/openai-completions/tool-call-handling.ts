import OpenAI from "openai";
import type { Context, Model } from "../../types.ts";
import { isCloudflareProvider, resolveCloudflareBaseUrl } from "../cloudflare.ts";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "../github-copilot-headers.ts";
import { getCompat } from "./error-handling.ts";
import type { ResolvedOpenAICompletionsCompat } from "./types.ts";

export function createClient(
  model: Model<"openai-completions">,
  context: Context,
  apiKey: string,
  optionsHeaders?: Record<string, string>,
  sessionId?: string,
  compat: ResolvedOpenAICompletionsCompat = getCompat(model),
) {
  const headers = { ...model.headers };
  if (model.provider === "github-copilot") {
    const hasImages = hasCopilotVisionInput(context.messages);
    const copilotHeaders = buildCopilotDynamicHeaders({
      messages: context.messages,
      hasImages,
    });
    Object.assign(headers, copilotHeaders);
  }

  if (sessionId && compat.sendSessionAffinityHeaders) {
    headers.session_id = sessionId;
    headers["x-client-request-id"] = sessionId;
    headers["x-session-affinity"] = sessionId;
  }

  // Merge options headers last so they can override defaults
  if (optionsHeaders) {
    Object.assign(headers, optionsHeaders);
  }

  const defaultHeaders =
    model.provider === "cloudflare-ai-gateway"
      ? {
          ...headers,
          Authorization: headers.Authorization ?? null,
          "cf-aig-authorization": `Bearer ${apiKey}`,
        }
      : headers;

  return new OpenAI({
    apiKey,
    baseURL: isCloudflareProvider(model.provider) ? resolveCloudflareBaseUrl(model) : model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders,
  });
}
