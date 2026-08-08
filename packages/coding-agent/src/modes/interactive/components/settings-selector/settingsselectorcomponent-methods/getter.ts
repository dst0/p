import type { SettingsList } from "@dst0/p-tui";
import type { SettingsSelectorComponent } from "../settingsselectorcomponent.ts";

export function do_getSettingsList(self: SettingsSelectorComponent): SettingsList {
  return self.settingsList;
}
