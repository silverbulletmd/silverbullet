import { WidgetType } from "@codemirror/view";
import type { Client } from "../../client.ts";
import { liveContextForClient } from "../../markdown_renderer/compose_client.ts";
import {
  destroyRenderTarget,
  renderMarkdownInto,
} from "../../markdown_renderer/render_into.ts";

/** Inline markdown with `${}` (attribute values), rendered in place of its source. */
export class InlineMarkdownWidget extends WidgetType {
  constructor(
    readonly client: Client,
    readonly markdown: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "sb-inline-markdown";
    span.textContent = this.markdown;
    void renderMarkdownInto(
      span,
      this.markdown,
      liveContextForClient(this.client),
      { inline: true },
    );
    return span;
  }

  override destroy(dom: HTMLElement): void {
    destroyRenderTarget(dom);
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof InlineMarkdownWidget && other.markdown === this.markdown
    );
  }
}
