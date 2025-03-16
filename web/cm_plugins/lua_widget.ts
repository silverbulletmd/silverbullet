import { WidgetType } from "@codemirror/view";
import type { Client } from "../client.ts";
import { renderMarkdownToHtml } from "../../plugs/markdown/markdown_render.ts";
import {
  isLocalPath,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { parse } from "$common/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "$common/markdown_parser/parser.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import { activeWidgets } from "./markdown_widget.ts";
import {
  attachWidgetEventHandlers,
  moveCursorIntoText,
} from "./widget_util.ts";
import { renderExpressionResult } from "../../plugs/template/util.ts";
import { expandCodeWidgets } from "$common/markdown.ts";
import { LuaStackFrame } from "$common/space_lua/runtime.ts";

export type LuaWidgetCallback = (
  bodyText: string,
  pageName: string,
) => Promise<LuaWidgetContent | null>;

export type EventPayLoad = {
  name: string;
  data: any;
};

export type LuaWidgetContent = {
  // Magic marker
  _isWidget?: true;
  // Render as HTML
  html?: string;
  // Render as markdown
  markdown?: string;
  // CSS classes for wrapper
  cssClasses?: string[];
  display?: "block" | "inline";
  // Event handlers
  events?: Record<string, (event: EventPayLoad) => void>;
} | string;

export class LuaWidget extends WidgetType {
  public dom?: HTMLElement;

  constructor(
    readonly client: Client,
    readonly cacheKey: string,
    readonly bodyText: string,
    readonly callback: LuaWidgetCallback,
    private renderEmpty: boolean,
    readonly inPage: boolean,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapperSpan = document.createElement("span");
    wrapperSpan.className = "sb-lua-wrapper";
    const innerDiv = document.createElement("div");
    wrapperSpan.appendChild(innerDiv);
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    if (cacheItem) {
      innerDiv.innerHTML = this.wrapHtml(!!cacheItem.block, cacheItem.html);
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
    let widgetContent = await this.callback(
      this.bodyText,
      this.client.currentPage,
    );
    activeWidgets.add(this);
    if (widgetContent === null || widgetContent === undefined) {
      if (!this.renderEmpty) {
        div.innerHTML = "";
        this.client.setWidgetCache(
          this.cacheKey,
          { height: div.clientHeight, html: "", block: false },
        );
        return;
      }
      widgetContent = { markdown: "nil", _isWidget: true };
    }

    let html = "";
    let block = false;

    // Normalization
    if (typeof widgetContent === "string" || !widgetContent._isWidget) {
      // Apply heuristic to render the object as a markdown table
      widgetContent = {
        _isWidget: true,
        markdown: await renderExpressionResult(widgetContent),
      };
    }

    if (widgetContent.cssClasses) {
      div.className = widgetContent.cssClasses.join(" ");
    }
    if (widgetContent.html) {
      html = widgetContent.html;

      block = widgetContent.display === "block";
      if (block) {
        div.className += " sb-lua-directive-block";
      } else {
        div.className += " sb-lua-directive-inline";
      }
    }
    if (widgetContent.markdown) {
      let mdTree = parse(
        extendedMarkdownLanguage,
        widgetContent.markdown || "",
      );

      const sf = LuaStackFrame.createWithGlobalEnv(
        client.clientSystem.spaceLuaEnv.env,
      );
      mdTree = await expandCodeWidgets(
        client.clientSystem.codeWidgetHook,
        mdTree,
        this.client.currentPage,
        client.clientSystem.spaceLuaEnv.env,
        sf,
      );
      const trimmedMarkdown = renderToText(mdTree).trim();

      if (!trimmedMarkdown) {
        // Net empty result after expansion
        div.innerHTML = "";
        this.client.setWidgetCache(
          this.cacheKey,
          { height: div.clientHeight, html: "", block: false },
        );
        return;
      }

      block = widgetContent._isWidget && widgetContent.display === "block" ||
        trimmedMarkdown.includes("\n");
      if (block) {
        div.className += " sb-lua-directive-block";
      } else {
        div.className += " sb-lua-directive-inline";
      }

      // Parse the markdown again after trimming
      mdTree = parse(
        extendedMarkdownLanguage,
        trimmedMarkdown,
      );

      html += renderMarkdownToHtml(mdTree, {
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
    }
    if (cachedHtml !== html) {
      // If the content has changed, update the DOM
      div.innerHTML = this.wrapHtml(block, html);
    }
    if (html) {
      attachWidgetEventHandlers(
        div,
        this.client,
        this.inPage ? "${" + this.bodyText + "}" : undefined,
        widgetContent._isWidget && widgetContent.events,
      );
      this.attachHandlers(div);
    }

    // Let's give it a tick, then measure and cache
    setTimeout(() => {
      this.client.setWidgetCache(
        this.cacheKey,
        {
          height: div.offsetHeight,
          html,
          block,
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

  wrapHtml(isBlock: boolean, html: string): string {
    if (!isBlock) {
      return html;
    }
    return `<div class="button-bar">
      <button data-button="reload" title="Reload"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button>

      ${
      this.inPage
        ? `
        <!--button data-button="bake" title="Bake"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-align-left"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg></button-->
        <button data-button="edit" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>`
        : ""
    }
    </div><div class="content">${html}</div>`;
  }

  attachHandlers(div: HTMLElement) {
    div.querySelector(`button[data-button="reload"]`)?.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        this.client.clientSystem.localSyscall(
          "system.invokeFunction",
          ["index.refreshWidgets"],
        ).catch(console.error);
      },
    );

    // div.querySelector(`button[data-button="bake"]`)?.addEventListener(
    //   "click",
    //   (e) => {
    //     e.stopPropagation();
    //     console.log("Baking...");
    //     this.client.clientSystem.localSyscall(
    //       "system.invokeFunction",
    //       ["query.bakeButton", this.bodyText],
    //     ).catch(console.error);
    //   },
    // );

    div.querySelector(`button[data-button="edit"]`)?.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        moveCursorIntoText(this.client, "${" + this.bodyText + "}");
      },
    );
  }

  override get estimatedHeight(): number {
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    return cacheItem ? cacheItem.height : -1;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof LuaWidget &&
      other.bodyText === this.bodyText && other.cacheKey === this.cacheKey
      // &&  this.from === other.from
    );
  }
}
