import type { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { Client } from "../client.ts";
import { decoratorStateField } from "./util.ts";
import { LuaWidget, type LuaWidgetContent } from "./lua_widget.ts";
import { activeWidgets } from "./code_widget.ts";
import { pageSlotViews } from "../navigator/page_slots.ts";
import {
  renderPageSlot,
  unmountPageSlot,
} from "../navigator/ui/components/page_widget.tsx";

class ArrayWidget extends WidgetType {
  public dom?: HTMLElement;

  constructor(
    readonly client: Client,
    readonly cacheKey: string,
    readonly callback: (pageName: string) => Promise<LuaWidgetContent[] | null>,
    readonly childClass: string,
  ) {
    super();
  }

  override get estimatedHeight(): number {
    return this.client.widgetCache.getCachedWidgetHeight(this.cacheKey);
  }

  invalidatePrewarm() {
    // ArrayWidget doesn't itself go through the prewarm cache (its callback
    // runs directly in renderContent), and the inner LuaWidgets it creates
    // get fresh prewarms via their constructors against a cleared cache, so
    // nothing to do here.
  }

  toDOM(): HTMLElement {
    activeWidgets.add(this);

    const div = document.createElement("div");
    div.className = "sb-widget-array";

    // Reserve vertical space from the cached height so layout doesn't
    // shift when async render fills in content (see lua_widget.ts for why
    // we don't reinsert cached HTML).
    const cachedHeight = this.client.widgetCache.getCachedWidgetHeight(
      this.cacheKey,
    );
    if (cachedHeight > 0) {
      div.style.minHeight = `${cachedHeight}px`;
    }

    // Async kick-off of content renderer
    this.renderContent(div).catch(console.error);
    this.dom = div;
    return div;
  }

  async renderContent(div: HTMLElement) {
    const content = await this.callback(this.client.currentName());
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
      )
        continue;

      const widget = new LuaWidget({
        client: this.client,
        cacheKey: `${this.cacheKey}:${i}`,
        expressionText: "",
        callback: () => Promise.resolve(widgetContent),
        inPage: false,
      });

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
      div.style.minHeight = "";
      return;
    }

    div.replaceChildren(...renderedWidgets);
    div.style.minHeight = "";

    // Wait for the clientHeight to settle
    setTimeout(() => {
      this.client.widgetCache.setCachedWidgetMeta(this.cacheKey, {
        height: div.clientHeight,
        block: true,
      });
    });
  }

  override eq(other: WidgetType): boolean {
    // This class isn't really used for stuff that's updated. If that's
    // needed in the future, one could e.g. add a `bodyText` property again
    return other instanceof ArrayWidget && other.cacheKey === this.cacheKey;
  }
}

/** A page slot: every navigator view whose resolved dock is this slot. */
class NavPageSlotWidget extends WidgetType {
  private destroyed = false;
  private measureTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly client: Client,
    readonly slot: "page-top" | "page-bottom",
    readonly cacheKey: string,
  ) {
    super();
  }

  override get estimatedHeight(): number {
    return this.client.widgetCache.getCachedWidgetHeight(this.cacheKey);
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = `sb-page-slot sb-page-slot-${this.slot}`;

    const cachedHeight = this.client.widgetCache.getCachedWidgetHeight(
      this.cacheKey,
    );
    if (cachedHeight > 0) {
      div.style.minHeight = `${cachedHeight}px`;
    }

    pageSlotViews(this.slot)
      .then((views) => {
        if (this.destroyed) return;
        renderPageSlot(div, views, this.slot, this.client, () =>
          this.measure(div),
        );
      })
      .catch(console.error);

    return div;
  }

  /**
   * Measures only once the slot's views have all resolved.
   */
  private measure(div: HTMLElement): void {
    clearTimeout(this.measureTimer);
    this.measureTimer = setTimeout(() => {
      if (this.destroyed) return;
      div.style.minHeight = "";
      div.dataset.settled = "1";
      if (!div.isConnected) return;
      this.client.widgetCache.setCachedWidgetMeta(this.cacheKey, {
        height: div.clientHeight,
        block: true,
      });
    }, 0);
  }

  override destroy(dom: HTMLElement): void {
    this.destroyed = true;
    clearTimeout(this.measureTimer);
    unmountPageSlot(dom);
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof NavPageSlotWidget && other.cacheKey === this.cacheKey
    );
  }
}

export function postScriptPrefacePlugin(editor: Client) {
  return decoratorStateField((state: EditorState) => {
    if (!editor.clientSystem.scriptsLoaded) {
      // console.info("System not yet ready, not rendering panel widgets.");
      return Decoration.none;
    }
    const widgets: any[] = [];

    // side -2/2 puts the navigator's page slots outside the legacy Lua top and bottom widgets
    widgets.push(
      Decoration.widget({
        widget: new NavPageSlotWidget(
          editor,
          "page-top",
          `pageslot:top:${editor.currentPath()}`,
        ),
        side: -2,
        block: true,
      }).range(0),
    );

    widgets.push(
      Decoration.widget({
        widget: new ArrayWidget(
          editor,
          `top:lua:${editor.currentPath()}`,
          async () => await client.dispatchAppEvent("hooks:renderTopWidgets"),
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
          `bottom:lua:${editor.currentPath()}`,
          async () =>
            await client.dispatchAppEvent("hooks:renderBottomWidgets"),
          "sb-lua-bottom-widget",
        ),
        side: 1,
        block: true,
      }).range(state.doc.length),
    );

    widgets.push(
      Decoration.widget({
        widget: new NavPageSlotWidget(
          editor,
          "page-bottom",
          `pageslot:bottom:${editor.currentPath()}`,
        ),
        side: 2,
        block: true,
      }).range(state.doc.length),
    );

    return Decoration.set(widgets);
  });
}
