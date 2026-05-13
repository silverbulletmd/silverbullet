import { WidgetType } from "@codemirror/view";

/**
 * Placeholder widget rendered while the client is still gathering the
 * state required to render real widgets (system ready, scripts loaded,
 * full index, page list). Shown in place of the raw widget source so
 * the editor doesn't flash unrendered code during boot.
 */
export class LoadingWidget extends WidgetType {
  constructor(readonly block: boolean = false) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return other instanceof LoadingWidget && other.block === this.block;
  }

  override toDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "sb-loading-widget " +
      (this.block ? "sb-loading-widget-block" : "sb-loading-widget-inline");
    const spinner = document.createElement("span");
    spinner.className = "sb-loading-spinner";
    wrapper.appendChild(spinner);
    return wrapper;
  }

  override get estimatedHeight(): number {
    return this.block ? 24 : -1;
  }
}
