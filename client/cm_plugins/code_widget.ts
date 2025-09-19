export const activeWidgets = new Set<DomWidget>();

export interface DomWidget {
  dom?: HTMLElement;

  renderContent(
    div: HTMLElement,
    cachedHtml: string | undefined,
  ): Promise<void>;
}

export async function reloadAllWidgets() {
  for (const widget of [...activeWidgets]) {
    if (!widget.dom || !widget.dom.parentNode) {
      activeWidgets.delete(widget);
      continue;
    }
    // Create an empty widget DIV node
    const newEl = document.createElement("div");
    await widget.renderContent(newEl, undefined);
    // Replace the old widget with the new one
    widget.dom.innerHTML = "";
    widget.dom.appendChild(newEl);
  }
}

function garbageCollectWidgets() {
  for (const widget of activeWidgets) {
    if (!widget.dom || !widget.dom.parentNode) {
      // console.log("Garbage collecting widget", widget.bodyText);
      activeWidgets.delete(widget);
    }
  }
}

setInterval(garbageCollectWidgets, 5000);
