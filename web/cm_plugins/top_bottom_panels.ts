import type { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { Client } from "../client.ts";
import { decoratorStateField } from "./util.ts";
import { LuaWidget, type LuaWidgetContent } from "./lua_widget.ts";
import { activeWidgets } from "./code_widget.ts";

class ArrayWidget extends WidgetType {
  public dom?: HTMLElement;

  constructor(
    readonly client: Client,
    readonly cacheKey: string,
    readonly callback: (
      pageName: string,
    ) => Promise<LuaWidgetContent[] | null>,
    readonly childClass: string,
  ) {
    super();
  }

  override get estimatedHeight(): number {
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    return cacheItem ? cacheItem.height : -1;
  }

  toDOM(): HTMLElement {
    activeWidgets.add(this);

    const div = document.createElement("div");
    div.className = "sb-widget-array";

    // This doesn't do that much, but it also doesn't really hurt
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    if (cacheItem) {
      div.innerHTML = cacheItem.html;
    }

    // Async kick-off of content renderer
    this.renderContent(div).catch(console.error);
    this.dom = div;
    return div;
  }

  async renderContent(
    div: HTMLElement,
  ) {
    const content = await this.callback(this.client.currentPage);
    if (!content) return;

    const renderedWidgets: HTMLElement[] = [];

    for (const [i, widgetContent] of content.entries()) {
      // Filter out any "empty" widgets. Leaving the content empty, but
      // returning a valid widgets, seems to be a common pattern
      if (
        !widgetContent ||
        widgetContent === "" ||
        (widgetContent instanceof Object &&
          !widgetContent.markdown &&
          !widgetContent.html)
      ) continue;

      const widget = new LuaWidget(
        this.client,
        `${this.cacheKey}:${i}`,
        "",
        () => Promise.resolve(widgetContent),
        false,
        false,
      );

      // Throw away the wrapper, as it only causes trouble and we are rewrapping
      // anyways
      const html = widget.toDOM().querySelector<HTMLDivElement>(":scope > div");
      if (!html) {
        // This should never really happen, just in case
        console.log("There was an error rendering one of the panel widgets");
        continue;
      }

      html.classList.add(this.childClass);

      renderedWidgets.push(html);
    }

    if (renderedWidgets.length === 0) {
      div.style.display = "none";
      return;
    }

    div.replaceChildren(...renderedWidgets);

    // Wait for the clientHeight to settle
    setTimeout(() => {
      this.client.setWidgetCache(this.cacheKey, {
        height: div.clientHeight,
        block: true,
        html: div.innerHTML,
      });
    });
  }

  override eq(other: WidgetType): boolean {
    // This class isn't really used for stuff that's updated. If that's
    // needed in the future, one could e.g. add a `bodyText` property again
    return other instanceof ArrayWidget && other.cacheKey === this.cacheKey;
  }
}

export function postScriptPrefacePlugin(
  editor: Client,
) {
  return decoratorStateField((state: EditorState) => {
    if (!editor.clientSystem.scriptsLoaded) {
      console.info("System not yet ready, not rendering panel widgets.");
      return Decoration.none;
    }
    const widgets: any[] = [];

    widgets.push(
      Decoration.widget({
        widget: new ArrayWidget(
          editor,
          `top:lua:${editor.currentPage}`,
          async () =>
            await client.dispatchAppEvent(
              "hooks:renderTopWidgets",
            ),
          "sb-lua-top-widget",
        ),
        side: -1,
        block: true,
      }).range(0),
    );

    widgets.push(
      Decoration.widget({
        widget: new ArrayWidget(
          editor,
          `bottom:lua:${editor.currentPage}`,
          async () =>
            await client.dispatchAppEvent(
              "hooks:renderBottomWidgets",
            ),
          "sb-lua-bottom-widget",
        ),
        side: 1,
        block: true,
      }).range(state.doc.length),
    );

    return Decoration.set(widgets);
  });
}
