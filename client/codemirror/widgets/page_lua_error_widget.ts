import { WidgetType } from "@codemirror/view";

/** A failing page-lua block's error, shown under the block. */
export class PageLuaErrorWidget extends WidgetType {
  constructor(readonly message: string) {
    super();
  }

  override eq(other: PageLuaErrorWidget): boolean {
    return other.message === this.message;
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "sb-lua-error sb-page-lua-error";
    div.textContent = `Lua error: ${this.message}`;
    return div;
  }
}
