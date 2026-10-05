import type { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { Client } from "../client.ts";
import { decoratorStateField } from "./util.ts";
import { LuaWidget, type LuaWidgetContent } from "./lua_widget.ts";
import { isViewValue } from "../navigator/view_value.ts";
import { activeWidgets, type DomWidget } from "./code_widget.ts";
import { pageSlotViews } from "../navigator/page_slots.ts";
import {
  renderPageSlot,
  unmountPageSlot,
} from "../navigator/ui/components/page_widget.tsx";
import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";

class ArrayWidget extends WidgetType {
  public dom?: HTMLElement;
  private children: LuaWidget[] = [];
  private renderVersion = 0;

  override destroy(): void {
    this.renderVersion++;
    for (const child of this.children) child.destroy();
    this.children = [];
    activeWidgets.delete(this);
  }

  constructor(
    readonly client: Client,
    readonly cacheKey: string,
    readonly callback: (
      pageName: string,
    ) => Promise<{ value: LuaWidgetContent; definition: Ref | null }[] | null>,
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

    this.renderContent(div).catch(console.error);
    this.dom = div;
    return div;
  }

  async renderContent(div: HTMLElement) {
    const version = ++this.renderVersion;
    const content = await this.callback(this.client.currentName());
    if (version !== this.renderVersion) return;
    for (const child of this.children) child.destroy();
    this.children = [];
    if (!content) return;

    const renderedWidgets: HTMLElement[] = [];

    for (const [i, { value: widgetContent, definition }] of content.entries()) {
      // Filter out any "empty" widgets. Leaving the content empty, but
      // returning a valid widgets, seems to be a common pattern
      if (
        !widgetContent ||
        widgetContent === "" ||
        (widgetContent instanceof Object &&
          !isViewValue(widgetContent) &&
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
        definitionRef: definition,
      });

      const wrapper = widget.toDOM();
      const html = wrapper.querySelector<HTMLDivElement>(":scope > div");
      if (!html) {
        console.log("There was an error rendering one of the panel widgets");
        continue;
      }

      html.classList.add(this.childClass);

      this.children.push(widget);
      renderedWidgets.push(wrapper);
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
      if (version !== this.renderVersion || !div.isConnected) return;
      this.client.widgetCache.setCachedWidgetMeta(this.cacheKey, {
        height: div.clientHeight,
        block: true,
      });
    });
  }

  override eq(other: WidgetType): boolean {
    return other instanceof ArrayWidget && other.cacheKey === this.cacheKey;
  }
}

// CodeMirror reuses an `eq` widget's DOM but destroys through its newest
// instance, which never mounted: teardown has to find the one that did.
const slotOwners = new WeakMap<HTMLElement, NavPageSlotWidget>();

/** A page slot: every navigator view whose resolved dock is this slot. */
export class NavPageSlotWidget extends WidgetType implements DomWidget {
  public dom?: HTMLElement;
  private host?: HTMLElement;
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

    this.dom = div;
    slotOwners.set(div, this);
    activeWidgets.add(this);
    this.mount(div);
    return div;
  }

  invalidatePrewarm(): void {}

  // `reloadAllWidgets` empties `dom` and appends `div` after this resolves, so
  // the old Preact root must be unmounted here, before its DOM disappears.
  async renderContent(div: HTMLElement): Promise<void> {
    if (this.host) unmountPageSlot(this.host);
    this.mount(div);
  }

  private mount(host: HTMLElement): void {
    this.host = host;
    pageSlotViews(this.slot)
      .then((views) => {
        if (this.destroyed || this.host !== host) return;
        renderPageSlot(host, views, this.slot, this.client, () =>
          this.measure(),
        );
      })
      .catch(console.error);
  }

  /**
   * Measures only once the slot's views have all resolved.
   */
  private measure(): void {
    clearTimeout(this.measureTimer);
    this.measureTimer = setTimeout(() => {
      const div = this.dom;
      if (this.destroyed || !div) return;
      div.style.minHeight = "";
      div.dataset.settled = "1";
      if (!div.isConnected) return;
      this.client.widgetCache.setCachedWidgetMeta(this.cacheKey, {
        height: div.clientHeight,
        block: true,
      });
    }, 0);
  }

  override destroy(dom?: HTMLElement): void {
    const owner = (dom && slotOwners.get(dom)) || this;
    owner.teardown();
    if (owner !== this) this.teardown();
  }

  private teardown(): void {
    this.destroyed = true;
    clearTimeout(this.measureTimer);
    activeWidgets.delete(this);
    if (this.host) unmountPageSlot(this.host);
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
          async () =>
            await client.dispatchAppEventWithSources("hooks:renderTopWidgets"),
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
            await client.dispatchAppEventWithSources(
              "hooks:renderBottomWidgets",
            ),
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
