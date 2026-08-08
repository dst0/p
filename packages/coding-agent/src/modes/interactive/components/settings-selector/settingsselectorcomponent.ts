import { Container, SettingsList } from "@dst0/p-tui";
import { getSettingsListTheme } from "../../theme/theme.ts";
import { DynamicBorder } from "../dynamic-border.ts";
import { createSettingChangeHandler } from "./setting-change-handler.ts";
import { createSettingsItems } from "./settings-items.ts";
import { do_getSettingsList } from "./settingsselectorcomponent-methods/getter.ts";
import type { SettingsCallbacks, SettingsConfig } from "./types.ts";

export class SettingsSelectorComponent extends Container {
  public settingsList: SettingsList;

  public readonly callbacks: SettingsCallbacks;

  constructor(config: SettingsConfig, callbacks: SettingsCallbacks) {
    super();
    this.callbacks = callbacks;
    this.addChild(new DynamicBorder());
    this.settingsList = new SettingsList(
      createSettingsItems(config, callbacks),
      10,
      getSettingsListTheme(),
      createSettingChangeHandler(callbacks),
      callbacks.onCancel,
      { enableSearch: true },
    );
    this.addChild(this.settingsList);
    this.addChild(new DynamicBorder());
  }

  getSettingsList(): SettingsList {
    return do_getSettingsList(this);
  }
}
