import { getImageModels, getImageProviders, type ImagesApi, type ImagesModel } from "@dst0/p-ai";
import { Container, type Focusable, fuzzyFilter, getKeybindings, Input, Spacer, Text, type TUI } from "@dst0/p-tui";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

interface ImageModelItem {
  provider: string;
  id: string;
  model: ImagesModel<ImagesApi>;
}

export class ImageModelSelectorComponent extends Container implements Focusable {
  private searchInput: Input;
  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  private listContainer: Container;
  private allModels: ImageModelItem[] = [];
  private filteredModels: ImageModelItem[] = [];
  private selectedIndex = 0;
  private currentModel?: ImagesModel<ImagesApi>;
  private onSelectCallback: (model: ImagesModel<ImagesApi>) => void;
  private onCancelCallback: () => void;
  private tui: TUI;

  constructor(
    tui: TUI,
    currentModel: ImagesModel<ImagesApi> | undefined,
    onSelect: (model: ImagesModel<ImagesApi>) => void,
    onCancel: () => void,
    initialSearch?: string,
  ) {
    super();
    this.tui = tui;
    this.currentModel = currentModel;
    this.onSelectCallback = onSelect;
    this.onCancelCallback = onCancel;

    this.addChild(new DynamicBorder());

    const titleContainer = new Container();
    titleContainer.addChild(new Text(theme.bold(theme.fg("accent", " Select Image Generation Model")), 0, 0));
    titleContainer.addChild(new Spacer(1));
    this.addChild(titleContainer);

    this.searchInput = new Input();
    if (initialSearch) {
      this.searchInput.setValue(initialSearch);
    }
    this.searchInput.onSubmit = () => {
      const selected = this.filteredModels[this.selectedIndex];
      if (selected) {
        this.onSelectCallback(selected.model);
      }
    };
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());

    this.loadModels();
  }

  private loadModels(): void {
    const items: ImageModelItem[] = [];
    const providers = getImageProviders();
    for (const provider of providers) {
      const models = getImageModels(provider);
      for (const model of models) {
        items.push({
          provider: model.provider,
          id: model.id,
          model,
        });
      }
    }
    if (
      this.currentModel &&
      !items.some((item) => item.provider === this.currentModel?.provider && item.id === this.currentModel.id)
    ) {
      items.push({
        provider: this.currentModel.provider,
        id: this.currentModel.id,
        model: this.currentModel,
      });
    }

    this.allModels = items;
    this.filterModels(this.searchInput.getValue());

    if (this.currentModel) {
      const idx = this.filteredModels.findIndex(
        (m) => m.provider === this.currentModel?.provider && m.id === this.currentModel?.id,
      );
      if (idx >= 0) {
        this.selectedIndex = idx;
      }
    }

    this.renderList();
  }

  private filterModels(query: string): void {
    if (!query.trim()) {
      this.filteredModels = [...this.allModels];
      return;
    }

    this.filteredModels = fuzzyFilter(
      this.allModels,
      query,
      (item) => `${item.provider}/${item.id} ${item.model.name}`,
    );
  }

  private renderList(): void {
    this.listContainer.clear();

    if (this.filteredModels.length === 0) {
      this.listContainer.addChild(new Text(theme.fg("dim", "  No image models found"), 0, 0));
      return;
    }

    const maxVisible = 10;
    const startIdx = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredModels.length - maxVisible),
    );
    const endIdx = Math.min(startIdx + maxVisible, this.filteredModels.length);

    for (let i = startIdx; i < endIdx; i++) {
      const item = this.filteredModels[i];
      const isSelected = i === this.selectedIndex;
      const isCurrent =
        this.currentModel && item.provider === this.currentModel.provider && item.id === this.currentModel.id;

      const prefix = isSelected ? theme.fg("accent", "▶ ") : "  ";
      const providerLabel = theme.fg("dim", `[${item.provider}]`);
      const nameLabel = isSelected ? theme.bold(item.model.name || item.id) : item.model.name || item.id;
      const currentMarker = isCurrent ? theme.fg("success", " (current)") : "";

      this.listContainer.addChild(new Text(`${prefix}${providerLabel} ${nameLabel}${currentMarker}`, 0, 0));
    }
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up")) {
      if (this.filteredModels.length === 0) return;
      this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
      this.renderList();
      this.tui.requestRender();
    } else if (kb.matches(keyData, "tui.select.down")) {
      if (this.filteredModels.length === 0) return;
      this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
      this.renderList();
      this.tui.requestRender();
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      const selectedModel = this.filteredModels[this.selectedIndex];
      if (selectedModel) {
        this.onSelectCallback(selectedModel.model);
      }
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancelCallback();
    } else {
      this.searchInput.handleInput(keyData);
      this.filterModels(this.searchInput.getValue());
      this.selectedIndex = 0;
      this.renderList();
      this.tui.requestRender();
    }
  }
}
