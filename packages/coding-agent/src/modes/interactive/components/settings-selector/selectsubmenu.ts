import { Container, type SelectItem, SelectList, Spacer, Text } from "@dst0/p-tui";
import { getSelectListTheme, theme } from "../../theme/theme.ts";
import { SETTINGS_SUBMENU_SELECT_LIST_LAYOUT } from "./constants.ts";

export class SelectSubmenu extends Container {
  private selectList: SelectList;

  constructor(
    title: string,
    description: string,
    options: SelectItem[],
    currentValue: string,
    onSelect: (value: string) => void,
    onCancel: () => void,
    onSelectionChange?: (value: string) => void,
  ) {
    super();

    // Title
    this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));

    // Description
    if (description) {
      this.addChild(new Spacer(1));
      this.addChild(new Text(theme.fg("muted", description), 0, 0));
    }

    // Spacer
    this.addChild(new Spacer(1));

    // Select list
    this.selectList = new SelectList(
      options,
      Math.min(options.length, 10),
      getSelectListTheme(),
      SETTINGS_SUBMENU_SELECT_LIST_LAYOUT,
    );

    // Pre-select current value
    const currentIndex = options.findIndex((o) => o.value === currentValue);
    if (currentIndex !== -1) {
      this.selectList.setSelectedIndex(currentIndex);
    }

    this.selectList.onSelect = (item) => {
      onSelect(item.value);
    };

    this.selectList.onCancel = onCancel;

    if (onSelectionChange) {
      this.selectList.onSelectionChange = (item) => {
        onSelectionChange(item.value);
      };
    }

    this.addChild(this.selectList);

    // Hint
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("dim", "  Enter to select · Esc to go back"), 0, 0));
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }
}
