import { UserMessageSelectorComponent } from "../../components/user-message-selector.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_showUserMessageSelector(self: InteractiveMode): void {
  const userMessages = self.session.getUserMessagesForForking();

  if (userMessages.length === 0) {
    self.showStatus("No messages to fork from");
    return;
  }

  const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;

  self.showSelector((done) => {
    const selector = new UserMessageSelectorComponent(
      userMessages.map((m) => ({ id: m.entryId, text: m.text })),
      async (entryId) => {
        try {
          const result = await self.runtimeHost.fork(entryId);
          if (result.cancelled) {
            done();
            self.ui.requestRender();
            return;
          }

          self.renderCurrentSessionState();
          self.editor.setText(result.selectedText ?? "");
          done();
          self.showStatus("Forked to new session");
        } catch (error: unknown) {
          done();
          self.showError(error instanceof Error ? error.message : String(error));
        }
      },
      () => {
        done();
        self.ui.requestRender();
      },
      initialSelectedId,
    );
    return { component: selector, focus: selector.getMessageList() };
  });
}

export async function do_handleCloneCommand(self: InteractiveMode): Promise<void> {
  const leafId = self.sessionManager.getLeafId();
  if (!leafId) {
    self.showStatus("Nothing to clone yet");
    return;
  }

  try {
    const result = await self.runtimeHost.fork(leafId, { position: "at" });
    if (result.cancelled) {
      self.ui.requestRender();
      return;
    }

    self.renderCurrentSessionState();
    self.editor.setText("");
    self.showStatus("Cloned to new session");
  } catch (error: unknown) {
    self.showError(error instanceof Error ? error.message : String(error));
  }
}
