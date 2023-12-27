import { WidgetType } from "../deps.ts";
import type { Client } from "../client.ts";
import type { CodeWidgetCallback } from "$sb/types.ts";
import { renderMarkdownToHtml } from "../../plugs/markdown/markdown_render.ts";
import { resolveAttachmentPath } from "$sb/lib/resolve.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import buildMarkdown from "../../common/markdown_parser/parser.ts";
import { renderToText } from "$sb/lib/tree.ts";

export class MarkdownWidget extends WidgetType {
  renderedMarkdown?: string;

  constructor(
    readonly from: number | undefined,
    readonly client: Client,
    readonly bodyText: string,
    readonly codeWidgetCallback: CodeWidgetCallback,
    readonly className: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = this.className;
    const cacheItem = this.client.getWidgetCache(this.bodyText);
    if (cacheItem) {
      div.innerHTML = this.wrapHtml(
        cacheItem.html,
        this.from !== undefined,
        this.from !== undefined,
      );
      this.attachListeners(div);
    }

    // Async kick-off of content renderer
    this.renderContent(div, cacheItem?.html).catch(console.error);

    return div;
  }

  private async renderContent(
    div: HTMLElement,
    cachedHtml: string | undefined,
  ) {
    const widgetContent = await this.codeWidgetCallback(
      this.bodyText,
      this.client.currentPage!,
    );
    if (!widgetContent) {
      div.innerHTML = "";
      // div.style.display = "none";
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
    div.innerHTML = this.wrapHtml(
      html,
      this.from !== undefined,
      this.from !== undefined,
    );
    this.attachListeners(div);

    // Let's give it a tick, then measure and cache
    setTimeout(() => {
      this.client.setWidgetCache(
        this.bodyText,
        div.clientHeight,
        html,
      );
    });
  }

  private wrapHtml(html: string, editButton = true, sourceButton = true) {
    return `
    <div class="button-bar">
    ${
      sourceButton
        ? `<button class="source-button" title="Show Markdown source"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-code"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg></button>`
        : ""
    }
       <button class="reload-button" title="Reload"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button>
       ${
      editButton
        ? `<button class="edit-button" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>`
        : ""
    }
       </div>
    ${html}`;
  }

  private attachListeners(div: HTMLElement) {
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

    if (this.from !== undefined) {
      div.querySelector(".edit-button")!.addEventListener("click", () => {
        this.client.editorView.dispatch({
          selection: { anchor: this.from! },
        });
        this.client.focus();
      });
      div.querySelector(".source-button")!.addEventListener("click", () => {
        div.innerText = this.renderedMarkdown!;
      });
    }
    div.querySelector(".reload-button")!.addEventListener("click", () => {
      this.renderContent(div, undefined).catch(console.error);
    });
  }

  get estimatedHeight(): number {
    const cacheItem = this.client.getWidgetCache(this.bodyText);
    // console.log("Calling estimated height", cacheItem);
    return cacheItem ? cacheItem.height : -1;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof MarkdownWidget &&
      other.bodyText === this.bodyText
    );
  }
}
