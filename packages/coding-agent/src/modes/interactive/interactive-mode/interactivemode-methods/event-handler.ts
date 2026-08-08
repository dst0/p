import type { AgentSessionEvent } from "../../../../core/agent-session.ts";
import type { InteractiveMode } from "../interactivemode.ts";
import { handleLifecycleEvent } from "./lifecycle-event-handler.ts";
import { handleMessageEvent } from "./message-event-handler.ts";
import { handleToolEvent } from "./tool-event-handler.ts";

export async function do_handleEvent(self: InteractiveMode, event: AgentSessionEvent): Promise<void> {
  if (!self.isInitialized) {
    await self.init();
  }

  self.footer.invalidate();

  if (handleMessageEvent(self, event)) return;
  if (handleToolEvent(self, event)) return;
  await handleLifecycleEvent(self, event);
}
