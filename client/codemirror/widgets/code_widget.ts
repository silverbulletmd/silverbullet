import { disposeRendered } from "../../markdown_renderer/compose.ts";

export const activeWidgets = new Set<DomWidget>();

export type DomWidget = {
  dom?: HTMLElement;
  cacheKey?: string;
  destroy?(): void;

  // Drop any prewarmed callback result so the next renderContent runs the
  // callback fresh. Used by reloadAllWidgets so refresh forces fresh data.
  invalidatePrewarm(): void;

  renderContent(
    div: HTMLElement,
    cachedHtml: string | undefined,
  ): Promise<void>;

  // Re-renders in place, keeping the widget's own element (and its height)
  reload?(): Promise<void>;
};

export async function reloadAllWidgets() {
  for (const widget of [...activeWidgets]) {
    if (!widget.dom?.isConnected) {
      widget.destroy?.();
      activeWidgets.delete(widget);
      continue;
    }
    if (widget.reload) {
      await widget.reload();
      continue;
    }
    widget.invalidatePrewarm();
    const newEl = document.createElement("div");
    await widget.renderContent(newEl, undefined);
    disposeRendered(widget.dom);
    widget.dom.innerHTML = "";
    widget.dom.appendChild(newEl);
  }
}

function garbageCollectWidgets() {
  for (const widget of activeWidgets) {
    if (!widget.dom?.isConnected) {
      widget.destroy?.();
      activeWidgets.delete(widget);
    }
  }
}

setInterval(garbageCollectWidgets, 5000);
