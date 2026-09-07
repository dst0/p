import type { AgentMessage } from "@dst0/p-agent-core";
import type { ImageContent, TextContent } from "@dst0/p-ai";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "../../auth-guidance.ts";
import { selectProjectInstructionPromptForTools } from "../../project-instructions/index.ts";
import { expandPromptTemplate } from "../../prompt-templates.ts";
import type { AgentSession } from "../agentsession.ts";
import { preserveCompiledProjectInstructionPrompt } from "../project-instruction-integrity.ts";
import type { PromptOptions } from "../session-types.ts";

export async function do_prompt(self: AgentSession, text: string, options?: PromptOptions): Promise<void> {
  const expandPromptTemplates = options?.expandPromptTemplates ?? true;
  const preflightResult = options?.preflightResult;
  let messages: AgentMessage[] | undefined;

  try {
    // Handle extension commands first (execute immediately, even during streaming)
    // Extension commands manage their own LLM interaction via p.sendMessage()
    if (expandPromptTemplates && text.startsWith("/")) {
      const handled = await self._tryExecuteExtensionCommand(text);
      if (handled) {
        // Extension command executed, no prompt to send
        preflightResult?.(true);
        return;
      }
    }

    // Emit input event for extension interception (before skill/template expansion)
    let currentText = text;
    let currentImages = options?.images;
    if (self._extensionRunner.hasHandlers("input")) {
      const inputResult = await self._extensionRunner.emitInput(
        currentText,
        currentImages,
        options?.source ?? "interactive",
        self.isStreaming ? options?.streamingBehavior : undefined,
      );
      if (inputResult.action === "handled") {
        preflightResult?.(true);
        return;
      }
      if (inputResult.action === "transform") {
        currentText = inputResult.text;
        currentImages = inputResult.images ?? currentImages;
      }
    }

    // Expand skill commands (/skill:name args) and prompt templates (/template args)
    let expandedText = currentText;
    if (expandPromptTemplates) {
      expandedText = self._expandSkillCommand(expandedText);
      expandedText = expandPromptTemplate(expandedText, [...self.promptTemplates]);
    }

    // If streaming, queue via steer() or followUp() based on option
    if (self.isStreaming) {
      if (!options?.streamingBehavior) {
        throw new Error(
          "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
        );
      }
      if (options.streamingBehavior === "followUp") {
        await self._queueFollowUp(expandedText, currentImages);
      } else {
        await self._queueSteer(expandedText, currentImages);
      }
      preflightResult?.(true);
      return;
    }

    // Flush any pending bash messages before the new prompt
    self._flushPendingBashMessages();

    // Validate model
    if (!self.model) {
      throw new Error(formatNoModelSelectedMessage());
    }

    if (!self._modelRegistry.hasConfiguredAuth(self.model)) {
      const isOAuth = self._modelRegistry.isUsingOAuth(self.model);
      if (isOAuth) {
        throw new Error(
          `Authentication failed for "${self.model.provider}". ` +
            `Credentials may have expired or network is unavailable. ` +
            `Run '/login ${self.model.provider}' to re-authenticate.`,
        );
      }
      throw new Error(formatNoApiKeyFoundMessage(self.model.provider));
    }

    // Build messages array (custom message if any, then user message)
    messages = [];

    // Add user message
    const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: expandedText }];
    if (currentImages) {
      userContent.push(...currentImages);
    }
    messages.push({
      role: "user",
      content: userContent,
      timestamp: Date.now(),
    });

    // Inject any pending "nextTurn" messages as context alongside the user message
    for (const msg of self._pendingNextTurnMessages) {
      messages.push(msg);
    }
    self._pendingNextTurnMessages = [];

    // Emit before_agent_start extension event
    const result = await self._extensionRunner.emitBeforeAgentStart(
      expandedText,
      currentImages,
      self._baseSystemPrompt,
      self._baseSystemPromptOptions,
    );
    // Add all custom messages from extensions
    if (result?.messages) {
      for (const msg of result.messages) {
        messages.push({
          role: "custom",
          customType: msg.customType,
          content: msg.content,
          display: msg.display,
          details: msg.details,
          timestamp: Date.now(),
        });
      }
    }
    const extensionSystemPrompt = result?.systemPrompt ?? self._baseSystemPrompt;
    const preparedProjectInstructions = self._projectInstructions.state.current;
    const immutableProjectInstructionPrompt =
      preparedProjectInstructions &&
      (preparedProjectInstructions.manifest.sources.length > 0 ||
        preparedProjectInstructions.manifest.skills.length > 0)
        ? selectProjectInstructionPromptForTools(preparedProjectInstructions, self.getActiveToolNames())
        : undefined;
    const effectiveSystemPrompt =
      self._projectInstructionMode === "compiled"
        ? preserveCompiledProjectInstructionPrompt(extensionSystemPrompt, immutableProjectInstructionPrompt)
        : extensionSystemPrompt;
    const runtimePrompts = self._createRuntimeContextPrompts(expandedText, effectiveSystemPrompt, messages);
    self._lastRuntimePromptComponents = runtimePrompts;
    self.agent.state.systemPrompt = runtimePrompts.combinedPrompt
      ? `${effectiveSystemPrompt}\n\n${runtimePrompts.combinedPrompt}`
      : effectiveSystemPrompt;
    if (runtimePrompts.turnContextPrompt) {
      messages.push(
        self._createRuntimeContextPromptMessage(
          runtimePrompts.turnContextPrompt,
          Date.now(),
          runtimePrompts.projectRuleGate,
        ),
      );
    }
    if (runtimePrompts.workingStatePrompt) {
      messages.push(self._createWorkingStatePromptMessage(runtimePrompts.workingStatePrompt, Date.now()));
    }
    self._lastTokenBreakdown = self._createTokenBreakdownForPrompt(messages);

    // Check if we need to compact before sending (catches aborted responses and preempts overflow with new messages)
    const lastAssistant = self._findLastAssistantMessage();
    if (await self.checkCompaction(lastAssistant, false, messages)) {
      try {
        await self.agent.continue();
        while (await self._handlePostAgentRun()) {
          await self.agent.continue();
        }
      } finally {
        self._flushPendingBashMessages();
      }
    }

    const fastResponderMessage = await self._createFastResponderMessage(expandedText, messages);
    if (fastResponderMessage) {
      const firstUserIndex = messages.findIndex((message) => message.role === "user");
      messages.splice(firstUserIndex === -1 ? 0 : firstUserIndex + 1, 0, fastResponderMessage);
    }
  } catch (error) {
    preflightResult?.(false);
    throw error;
  }

  if (!messages) {
    return;
  }

  preflightResult?.(true);
  await self._runAgentPrompt(messages);
}
