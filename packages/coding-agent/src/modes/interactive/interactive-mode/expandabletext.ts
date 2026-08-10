import { Text } from "@dst0/p-tui";
import type { Expandable } from "./types.ts";

export class ExpandableText extends Text implements Expandable {
  private readonly getCollapsedText: () => string;
  private readonly getExpandedText: () => string;

  constructor(
    getCollapsedText: () => string,
    getExpandedText: () => string,
    expanded = false,
    paddingX = 0,
    paddingY = 0,
  ) {
    super(expanded ? getExpandedText() : getCollapsedText(), paddingX, paddingY);
    this.getCollapsedText = getCollapsedText;
    this.getExpandedText = getExpandedText;
  }

  setExpanded(expanded: boolean): void {
    this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
  }
}
