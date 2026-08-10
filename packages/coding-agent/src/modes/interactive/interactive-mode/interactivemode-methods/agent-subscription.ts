import type { InteractiveMode } from "../interactivemode.ts";

export function do_subscribeToAgent(self: InteractiveMode): void {
  self.unsubscribe = self.session.subscribe(async (event) => {
    await self.handleEvent(event);
  });
}
