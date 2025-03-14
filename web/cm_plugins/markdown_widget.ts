import { WidgetType } from "@codemirror/view";
import type { Client } from "../client.ts";
import type {
  CodeWidgetButton,
  CodeWidgetCallback,
} from "../../plug-api/types.ts";
import { renderMarkdownToHtml } from "../../plugs/markdown/markdown_render.ts";
import {
  isLocalPath,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { parse } from "$common/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "$common/markdown_parser/parser.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import { attachWidgetEventHandlers } from "./widget_util.ts";

export const activeWidgets = new Set<DomWidget>();

export interface DomWidget {
  dom?: HTMLElement;
  renderContent(
    div: HTMLElement,
    cachedHtml: string | undefined,
  ): Promise<void>;
}

export class MarkdownWidget extends WidgetType {
  public dom?: HTMLElement;

  constructor(
    readonly from: number | undefined,
    readonly client: Client,
    readonly cacheKey: string,
    readonly bodyText: string,
    readonly codeWidgetCallback: CodeWidgetCallback,
    readonly className: string,
    private tryInline = false,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapperSpan = document.createElement("span");
    wrapperSpan.className = "sb-markdown-wrapper";
    const innerDiv = document.createElement("div");
    wrapperSpan.appendChild(innerDiv);
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    if (cacheItem) {
      innerDiv.innerHTML = this.wrapHtml(cacheItem.html, cacheItem.buttons);
    }

    // Async kick-off of content renderer
    this.renderContent(innerDiv, cacheItem?.html).catch(console.error);
    this.dom = wrapperSpan;
    return wrapperSpan;
  }

  async renderContent(
    div: HTMLElement,
    cachedHtml: string | undefined,
  ) {
    div.className = this.className;
    const widgetContent = await this.codeWidgetCallback(
      this.bodyText,
      this.client.currentPage,
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
    let mdTree = parse(
      extendedMarkdownLanguage,
      widgetContent.markdown!,
    );
    mdTree = await this.client.clientSystem.localSyscall(
      "system.invokeFunction",
      [
        "markdown.expandCodeWidgets",
        mdTree,
        this.client.currentPage,
      ],
    );
    const trimmedMarkdown = renderToText(mdTree).trim();

    if (!trimmedMarkdown) {
      // Net empty result after expansion
      div.innerHTML = "";
      this.client.setWidgetCache(
        this.cacheKey,
        { height: div.clientHeight, html: "" },
      );
      return;
    }

    if (this.tryInline) {
      if (trimmedMarkdown.includes("\n")) {
        // Heuristic that this is going to be a multi-line output and we should render this as a HTML block
        div.style.display = "block";
      } else {
        div.style.display = "inline";
      }
    }

    // Parse the markdown again after trimming
    mdTree = parse(
      extendedMarkdownLanguage,
      trimmedMarkdown,
    );

    const html = renderMarkdownToHtml(mdTree, {
      // Annotate every element with its position so we can use it to put
      // the cursor there when the user clicks on the table.
      annotationPositions: true,
      translateUrls: (url) => {
        if (isLocalPath(url)) {
          url = resolvePath(
            this.client.currentPage,
            decodeURI(url),
          );
        }

        return url;
      },
      preserveAttributes: true,
    }, this.client.ui.viewState.allPages);

    if (cachedHtml === html) {
      // HTML still same as in cache, no need to re-render
      return;
    }
    div.innerHTML = this.wrapHtml(
      html,
      widgetContent.buttons,
    );
    if (html) {
      this.attachListeners(div, widgetContent.buttons);
    }

    // Let's give it a tick, then measure and cache
    setTimeout(() => {
      this.client.setWidgetCache(
        this.cacheKey,
        {
          height: div.offsetHeight,
          html,
          buttons: widgetContent.buttons,
        },
      );
      // Because of the rejiggering of the DOM, we need to do a no-op cursor move to make sure it's positioned correctly
      this.client.editorView.dispatch({
        selection: {
          anchor: this.client.editorView.state.selection.main.anchor,
        },
      });
    });
  }

  private wrapHtml(
    html: string,
    buttons: CodeWidgetButton[] = [],
  ) {
    if (!html) {
      return "";
    }
    if (buttons.length === 0) {
      return html;
    } else {
      return `<div class="button-bar">${
        buttons.filter((button) => !button.widgetTarget).map((button, idx) =>
          `<button data-button="${idx}" title="${button.description}">${button.svg}</button> `
        ).join("")
      }</div><div class="content">${html}</div>`;
    }
  }

  private attachListeners(div: HTMLElement, buttons?: CodeWidgetButton[]) {
    attachWidgetEventHandlers(div, this.client, undefined, this.from);

    if (!buttons) {
      buttons = [];
    }

    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      if (button.widgetTarget) {
        div.addEventListener("click", () => {
          console.log("Widget clicked");
          this.client.clientSystem.localSyscall("system.invokeFunction", [
            button.invokeFunction[0],
            this.from,
          ]).catch(console.error);
        });
      } else {
        div.querySelector(`button[data-button="${i}"]`)!.addEventListener(
          "click",
          (e) => {
            e.stopPropagation();
            this.client.clientSystem.localSyscall(
              "system.invokeFunction",
              button.invokeFunction,
            ).then((newContent: string | undefined) => {
              if (newContent) {
                div.innerText = newContent;
              }
              this.client.focus();
            }).catch(console.error);
          },
        );
      }
    }
  }

  override get estimatedHeight(): number {
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    return cacheItem ? cacheItem.height : -1;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof MarkdownWidget &&
      other.bodyText === this.bodyText && other.cacheKey === this.cacheKey &&
      this.from === other.from
    );
  }
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
