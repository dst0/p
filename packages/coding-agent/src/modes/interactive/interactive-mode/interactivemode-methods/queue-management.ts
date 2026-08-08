import { Spacer, Text, TruncatedText } from "@dst0/p-tui";
import { APP_NAME } from "../../../../config.ts";
import { DynamicBorder } from "../../components/dynamic-border.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_showPackageUpdateNotification(self: InteractiveMode, packages: string[]): void {
  const action = theme.fg("accent", `${APP_NAME} update`);
  const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
  const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
  self.chatContainer.addChild(
    new Text(
      `${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
      1,
      0,
    ),
  );
  self.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
  self.ui.requestRender();
}

export function do_getAllQueuedMessages(self: InteractiveMode): { steering: string[]; followUp: string[] } {
  return {
    steering: [
      ...self.session.getSteeringMessages(),
      ...self.compactionQueuedMessages.filter((msg) => msg.mode === "steer").map((msg) => msg.text),
    ],
    followUp: [
      ...self.session.getFollowUpMessages(),
      ...self.compactionQueuedMessages.filter((msg) => msg.mode === "followUp").map((msg) => msg.text),
    ],
  };
}

export function do_clearAllQueues(self: InteractiveMode): { steering: string[]; followUp: string[] } {
  const { steering, followUp } = self.session.clearQueue();
  const compactionSteering = self.compactionQueuedMessages.filter((msg) => msg.mode === "steer").map((msg) => msg.text);
  const compactionFollowUp = self.compactionQueuedMessages
    .filter((msg) => msg.mode === "followUp")
    .map((msg) => msg.text);
  self.compactionQueuedMessages = [];
  return {
    steering: [...steering, ...compactionSteering],
    followUp: [...followUp, ...compactionFollowUp],
  };
}

export function do_updatePendingMessagesDisplay(self: InteractiveMode): void {
  self.pendingMessagesContainer.clear();
  const { steering: steeringMessages, followUp: followUpMessages } = self.getAllQueuedMessages();
  const queuedMessageCount = steeringMessages.length + followUpMessages.length;
  if (queuedMessageCount > 0) {
    self.pendingMessagesContainer.addChild(new Spacer(1));
    for (const message of steeringMessages) {
      const text = theme.fg("dim", `Steering: ${message}`);
      self.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
    }
    for (const message of followUpMessages) {
      const text = theme.fg("dim", `Follow-up: ${message}`);
      self.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
    }
    const dequeueHint = self.getAppKeyDisplay("app.message.dequeue");
    const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
    self.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
  }
}

export function do_restoreQueuedMessagesToEditor(
  self: InteractiveMode,
  options?: { abort?: boolean; currentText?: string },
): number {
  const { steering, followUp } = self.clearAllQueues();
  const allQueued = [...steering, ...followUp];
  if (allQueued.length === 0) {
    self.updatePendingMessagesDisplay();
    if (options?.abort) {
      self.agent.abort();
    }
    return 0;
  }
  const queuedText = allQueued.join("\n\n");
  const currentText = options?.currentText ?? self.editor.getText();
  const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
  self.editor.setText(combinedText);
  self.updatePendingMessagesDisplay();
  if (options?.abort) {
    self.agent.abort();
  }
  return allQueued.length;
}

export function do_queueCompactionMessage(self: InteractiveMode, text: string, mode: "steer" | "followUp"): void {
  self.compactionQueuedMessages.push({ text, mode });
  self.editor.addToHistory?.(text);
  self.editor.setText("");
  self.updatePendingMessagesDisplay();
  self.showStatus("Queued message for after compaction");
}

export function do_isExtensionCommand(self: InteractiveMode, text: string): boolean {
  if (!text.startsWith("/")) return false;

  const extensionRunner = self.session.extensionRunner;

  const spaceIndex = text.indexOf(" ");
  const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
  return !!extensionRunner.getCommand(commandName);
}
