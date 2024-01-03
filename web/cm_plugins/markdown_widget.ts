import { WidgetType } from "../deps.ts";
import type { Client } from "../client.ts";
import type { CodeWidgetButton, CodeWidgetCallback } from "$sb/types.ts";
import { renderMarkdownToHtml } from "../../plugs/markdown/markdown_render.ts";
import { resolveAttachmentPath } from "$sb/lib/resolve.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import buildMarkdown from "../../common/markdown_parser/parser.ts";
import { renderToText } from "$sb/lib/tree.ts";

const activeWidgets = new Set<MarkdownWidget>();

export class MarkdownWidget extends WidgetType {
  renderedMarkdown?: string;
  public dom?: HTMLElement;

  constructor(
    readonly from: number | undefined,
    readonly client: Client,
    readonly cacheKey: string,
    readonly bodyText: string,
    readonly codeWidgetCallback: CodeWidgetCallback,
    readonly className: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = this.className;
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    if (cacheItem) {
      div.innerHTML = this.wrapHtml(
        cacheItem.html,
        cacheItem.buttons,
      );
      this.attachListeners(div, cacheItem.buttons);
    }

    // Async kick-off of content renderer
    this.renderContent(div, cacheItem?.html).catch(console.error);

    this.dom = div;

    return div;
  }

  async renderContent(
    div: HTMLElement,
    cachedHtml: string | undefined,
  ) {
    const widgetContent = await this.codeWidgetCallback(
      this.bodyText,
      this.client.currentPage!,
    );
    activeWidgets.add(this);
    if (!widgetContent) {
      div.innerHTML = "";
      this.client.setWidgetCache(
        this.cacheKey,
        { height: div.clientHeight, html: "" },
      );
      return;
    }
    const lang = buildMarkdown(this.client.system.mdExtensions);
    let mdTree = parse(
      lang,
      widgetContent.markdown!,
    );
    mdTree = await this.client.system.localSyscall(
      "system.invokeFunction",
      [
        "markdown.expandCodeWidgets",
        mdTree,
        this.client.currentPage,
      ],
    );
    // Used for the source button
    this.renderedMarkdown = renderToText(mdTree);

    const html = renderMarkdownToHtml(mdTree, {
      // Annotate every element with its position so we can use it to put
      // the cursor there when the user clicks on the table.
      annotationPositions: true,
      translateUrls: (url) => {
        if (!url.includes("://")) {
          url = resolveAttachmentPath(
            this.client.currentPage!,
            decodeURI(url),
          );
        }

        return url;
      },
      preserveAttributes: true,
    });

    if (cachedHtml === html) {
      // HTML still same as in cache, no need to re-render
      return;
    }
    div.innerHTML = this.wrapHtml(html, widgetContent.buttons);
    this.attachListeners(div, widgetContent.buttons);

    // Let's give it a tick, then measure and cache
    setTimeout(() => {
      this.client.setWidgetCache(
        this.cacheKey,
        { height: div.offsetHeight, html, buttons: widgetContent.buttons },
      );
    });
  }

  private wrapHtml(html: string, buttons?: CodeWidgetButton[]) {
    if (!buttons) {
      return html;
    }
    return `<div class="button-bar">${
      buttons.map((button, idx) =>
        `<button data-button="${idx}" title="${button.description}">${button.svg}</button> `
      ).join("")
    }</div>${html}`;
  }

  private attachListeners(div: HTMLElement, buttons?: CodeWidgetButton[]) {
    div.querySelectorAll("a[data-ref]").forEach((el_) => {
      const el = el_ as HTMLElement;
      // Override default click behavior with a local navigate (faster)
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const [pageName, pos] = el.dataset.ref!.split(/[$@]/);
        if (pos && pos.match(/^\d+$/)) {
          this.client.navigate(pageName, +pos);
        } else {
          this.client.navigate(pageName, pos);
        }
      });
    });

    // Implement task toggling
    div.querySelectorAll("span[data-external-task-ref]").forEach((el: any) => {
      const taskRef = el.dataset.externalTaskRef;
      el.querySelector("input[type=checkbox]").addEventListener(
        "change",
        (e: any) => {
          const oldState = e.target.dataset.state;
          const newState = oldState === " " ? "x" : " ";
          // Update state in DOM as well for future toggles
          e.target.dataset.state = newState;
          console.log("Toggling task", taskRef);
          this.client.system.localSyscall(
            "system.invokeFunction",
            ["tasks.updateTaskState", taskRef, oldState, newState],
          ).catch(
            console.error,
          );
        },
      );
    });

    if (!buttons) {
      buttons = [];
    }

    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      div.querySelector(`button[data-button="${i}"]`)!.addEventListener(
        "click",
        () => {
          console.log("Button clicked:", button.description);
          this.client.system.localSyscall("system.invokeFunction", [
            button.invokeFunction,
            this.from,
          ]).then((newContent: string | undefined) => {
            if (newContent) {
              div.innerText = newContent;
            }
            this.client.focus();
          }).catch(console.error);
        },
      );
    }
    // div.querySelectorAll("ul > li").forEach((el) => {
    //   el.classList.add("sb-line-li-1", "sb-line-ul");
    // });
  }

  get estimatedHeight(): number {
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    // console.log("Calling estimated height", this.bodyText, cacheItem);
    return cacheItem ? cacheItem.height : -1;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof MarkdownWidget &&
      other.bodyText === this.bodyText
    );
  }
}

export function reloadAllMarkdownWidgets() {
  for (const widget of activeWidgets) {
    // Garbage collect as we go
    if (!widget.dom || !widget.dom.parentNode) {
      activeWidgets.delete(widget);
      continue;
    }
    widget.renderContent(widget.dom!, undefined).catch(console.error);
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
