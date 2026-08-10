import { Container, type SettingItem, SettingsList } from "@dst0/p-tui";
import type { WarningSettings } from "../../../../core/settings-manager.ts";
import { getSettingsListTheme } from "../../theme/theme.ts";

export class WarningSettingsSubmenu extends Container {
  private settingsList: SettingsList;
  private state: WarningSettings;

  constructor(warnings: WarningSettings, onChange: (warnings: WarningSettings) => void, onCancel: () => void) {
    super();

    this.state = { ...warnings };

    const items: SettingItem[] = [
      {
        id: "anthropic-extra-usage",
        label: "Anthropic extra usage",
        description: "Warn when Anthropic subscription auth may use paid extra usage",
        currentValue: (this.state.anthropicExtraUsage ?? true) ? "true" : "false",
        values: ["true", "false"],
      },
    ];

    this.settingsList = new SettingsList(
      items,
      Math.min(items.length, 10),
      getSettingsListTheme(),
      (id, newValue) => {
        switch (id) {
          case "anthropic-extra-usage":
            this.state = { ...this.state, anthropicExtraUsage: newValue === "true" };
            onChange({ ...this.state });
            break;
        }
      },
      onCancel,
    );

    this.addChild(this.settingsList);
  }

  handleInput(data: string): void {
    this.settingsList.handleInput(data);
  }
}
