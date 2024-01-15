import { WidgetType } from "../deps.ts";
import type { Client } from "../client.ts";
import type { CodeWidgetButton, CodeWidgetCallback } from "$sb/types.ts";
import { renderMarkdownToHtml } from "../../plugs/markdown/markdown_render.ts";
import { resolveAttachmentPath } from "$sb/lib/resolve.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import buildMarkdown from "../../common/markdown_parser/parser.ts";

const activeWidgets = new Set<MarkdownWidget>();

export class MarkdownWidget extends WidgetType {
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
      div.innerHTML = this.wrapHtml(cacheItem.html, cacheItem.buttons);
      if (cacheItem.html) {
        this.attachListeners(div, cacheItem.buttons);
      }
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
    // console.log("Got html", html);

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
    return `<div class="button-bar">${
      buttons.filter((button) => !button.widgetTarget).map((button, idx) =>
        `<button data-button="${idx}" title="${button.description}">${button.svg}</button> `
      ).join("")
    }</div><div class="content">${html}</div>`;
  }

  private attachListeners(div: HTMLElement, buttons?: CodeWidgetButton[]) {
    // Override wiki links with local navigate (faster)
    div.querySelectorAll("a[data-ref]").forEach((el_) => {
      const el = el_ as HTMLElement;
      // Override default click behavior with a local navigate (faster)
      el.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey) {
          // Don't do anything special for ctrl/meta clicks
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const [pageName, pos] = el.dataset.ref!.split(/[$@]/);
        if (pos && pos.match(/^\d+$/)) {
          this.client.navigate(pageName, +pos);
        } else {
          this.client.navigate(pageName, pos);
        }
      });
    });

    div.querySelectorAll("button[data-onclick]").forEach((el_) => {
      const el = el_ as HTMLElement;
      const onclick = el.dataset.onclick!;
      const parsedOnclick = JSON.parse(onclick);
      if (parsedOnclick[0] === "command") {
        const command = parsedOnclick[1];
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.info("Command link clicked in widget, running", command);
          this.client.runCommandByName(command).catch(console.error);
        });
      }
    });

    // Implement task toggling
    div.querySelectorAll("span[data-external-task-ref]").forEach((el: any) => {
      const taskRef = el.dataset.externalTaskRef;
      const input = el.querySelector("input[type=checkbox]")!;
      input.addEventListener(
        "click",
        (e: any) => {
          // Avoid triggering the click on the parent
          e.stopPropagation();
        },
      );
      input.addEventListener(
        "change",
        (e: any) => {
          e.stopPropagation();
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
      if (button.widgetTarget) {
        div.addEventListener("click", () => {
          console.log("Widget clicked");
          this.client.system.localSyscall("system.invokeFunction", [
            button.invokeFunction,
            this.from,
          ]).catch(console.error);
        });
      } else {
        div.querySelector(`button[data-button="${i}"]`)!.addEventListener(
          "click",
          (e) => {
            e.stopPropagation();
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
    }
  }

  get estimatedHeight(): number {
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    return cacheItem ? cacheItem.height : -1;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof MarkdownWidget &&
      other.bodyText === this.bodyText && other.cacheKey === this.cacheKey
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
