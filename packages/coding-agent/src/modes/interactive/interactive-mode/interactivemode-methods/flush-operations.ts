import type { Component } from "@dst0/p-tui";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_flushCompactionQueue(self: InteractiveMode, options?: { willRetry?: boolean }): Promise<void> {
  if (self.compactionQueuedMessages.length === 0) {
    return;
  }

  const queuedMessages = [...self.compactionQueuedMessages];
  self.compactionQueuedMessages = [];
  self.updatePendingMessagesDisplay();

  const restoreQueue = (error: unknown) => {
    self.session.clearQueue();
    self.compactionQueuedMessages = queuedMessages;
    self.updatePendingMessagesDisplay();
    self.showError(
      `Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  };

  try {
    if (options?.willRetry || self.session.isStreaming) {
      // When retry is pending or agent is still streaming, queue messages for the current/retry turn
      for (const message of queuedMessages) {
        if (self.isExtensionCommand(message.text)) {
          await self.session.prompt(message.text);
        } else if (message.mode === "followUp") {
          await self.session.followUp(message.text);
        } else {
          await self.session.steer(message.text);
        }
      }
      self.updatePendingMessagesDisplay();
      return;
    }

    // Find first non-extension-command message to use as prompt
    const firstPromptIndex = queuedMessages.findIndex((message) => !self.isExtensionCommand(message.text));
    if (firstPromptIndex === -1) {
      // All extension commands - execute them all
      for (const message of queuedMessages) {
        await self.session.prompt(message.text);
      }
      return;
    }

    // Execute any extension commands before the first prompt
    const preCommands = queuedMessages.slice(0, firstPromptIndex);
    const firstPrompt = queuedMessages[firstPromptIndex];
    const rest = queuedMessages.slice(firstPromptIndex + 1);

    for (const message of preCommands) {
      await self.session.prompt(message.text);
    }

    // Send first prompt (starts streaming)
    const promptPromise = self.session.prompt(firstPrompt.text).catch((error) => {
      restoreQueue(error);
    });

    // Queue remaining messages
    for (const message of rest) {
      if (self.isExtensionCommand(message.text)) {
        await self.session.prompt(message.text);
      } else if (message.mode === "followUp") {
        await self.session.followUp(message.text);
      } else {
        await self.session.steer(message.text);
      }
    }
    self.updatePendingMessagesDisplay();
    void promptPromise;
  } catch (error) {
    restoreQueue(error);
  }
}

export function do_flushPendingBashComponents(self: InteractiveMode): void {
  for (const component of self.pendingBashComponents) {
    self.pendingMessagesContainer.removeChild(component);
    self.chatContainer.addChild(component);
  }
  self.pendingBashComponents = [];
}

export function do_showSelector(
  self: InteractiveMode,
  create: (done: () => void) => { component: Component; focus: Component },
): void {
  const done = () => {
    self.editorContainer.clear();
    self.editorContainer.addChild(self.editor);
    self.ui.setFocus(self.editor);
  };
  const { component, focus } = create(done);
  self.editorContainer.clear();
  self.editorContainer.addChild(component);
  self.ui.setFocus(focus);
  self.ui.requestRender();
}
