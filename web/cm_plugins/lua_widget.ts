import { WidgetType } from "@codemirror/view";
import type { Client } from "../client.ts";
import { renderMarkdownToHtml } from "../markdown/markdown_render.ts";
import {
  isLocalPath,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import {
  attachWidgetEventHandlers,
  moveCursorIntoText,
} from "./widget_util.ts";
import { expandMarkdown } from "../markdown.ts";
import { LuaStackFrame, LuaTable } from "../../lib/space_lua/runtime.ts";
import { isBlockMarkdown, jsonToMDTable } from "../markdown_util.ts";
import { activeWidgets } from "./code_widget.ts";

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
  html?: string | HTMLElement;
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

  override get estimatedHeight(): number {
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    return cacheItem ? cacheItem.height : -1;
  }

  toDOM(): HTMLElement {
    const wrapperSpan = document.createElement("span");
    wrapperSpan.className = "sb-lua-wrapper";
    const innerDiv = document.createElement("div");
    wrapperSpan.appendChild(innerDiv);
    const cacheItem = this.client.getWidgetCache(this.cacheKey);
    if (cacheItem) {
      // This is to make the initial render faster, will later be replaced by the actual content
      innerDiv.replaceChildren(
        this.wrapHtml(!!cacheItem.block, cacheItem.html, cacheItem.copyContent),
      );
    }

    // Async kick-off of content renderer
    this.renderContent(innerDiv).catch(console.error);
    this.dom = wrapperSpan;
    return wrapperSpan;
  }

  async renderContent(
    div: HTMLElement,
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

    let html: HTMLElement | undefined;
    let block = false;
    let copyContent: string | undefined = undefined;

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
      if (typeof widgetContent.html === "string") {
        html = parseHtmlString(widgetContent.html);
        copyContent = widgetContent.html;
      } else {
        html = widgetContent.html;
        copyContent = widgetContent.html.outerHTML;
      }

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
      mdTree = await expandMarkdown(
        client,
        mdTree,
        client.clientSystem.spaceLuaEnv.env,
        sf,
      );
      const trimmedMarkdown = renderToText(mdTree).trim();

      copyContent = trimmedMarkdown;

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
        isBlockMarkdown(trimmedMarkdown);
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

      html = parseHtmlString(renderMarkdownToHtml(mdTree, {
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
      }, this.client.ui.viewState.allPages));
    }
    if (html) {
      div.replaceChildren(this.wrapHtml(block, html, copyContent));
      attachWidgetEventHandlers(
        div,
        this.client,
        this.inPage ? "${" + this.bodyText + "}" : undefined,
        widgetContent._isWidget && widgetContent.events,
      );
    }

    // Let's give it a tick, then measure and cache
    setTimeout(() => {
      this.client.setWidgetCache(
        this.cacheKey,
        {
          height: div.offsetHeight,
          html: html?.outerHTML || "",
          block,
          copyContent: copyContent,
        },
      );
      // Because of the rejiggering of the DOM, we need to do a no-op cursor move to make sure it's positioned correctly
      this.client.editorView.dispatch({
        selection: this.client.editorView.state.selection,
      });
    });
  }

  wrapHtml(
    isBlock: boolean,
    html: string | HTMLElement,
    copyContent: string | undefined,
  ): HTMLElement {
    if (typeof html === "string") {
      html = parseHtmlString(html);
    }
    if (!isBlock) {
      return html;
    }
    const container = document.createElement("div");
    const buttonBar = document.createElement("div");
    buttonBar.className = "button-bar";

    const createButton = (
      { title, icon, listener }: {
        title: string;
        icon: string;
        listener: (event: MouseEvent) => void;
      },
    ) => {
      const button = document.createElement("button");
      button.setAttribute("data-button", title.toLowerCase());
      button.setAttribute("title", title);
      button.innerHTML = icon;
      button.addEventListener("click", listener);

      return button;
    };

    buttonBar.appendChild(createButton(
      {
        title: "Reload",
        icon:
          '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
        listener: (e) => {
          e.stopPropagation();
          this.client.clientSystem.localSyscall(
            "system.invokeFunction",
            ["index.refreshWidgets"],
          ).catch(console.error);
        },
      },
    ));

    if (copyContent) {
      buttonBar.appendChild(createButton(
        {
          title: "Copy",
          icon:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-copy"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
          listener: (e) => {
            e.stopPropagation();
            this.client.clientSystem.localSyscall(
              "editor.copyToClipboard",
              [copyContent],
            ).catch(console.error);
          },
        },
      ));
    }

    if (this.inPage) {
      buttonBar.appendChild(createButton(
        {
          title: "Edit",
          icon:
            '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
          listener: (e) => {
            e.stopPropagation();
            moveCursorIntoText(this.client, "${" + this.bodyText + "}");
          },
        },
      ));
    }

    const content = document.createElement("div");
    content.className = "content";
    content.appendChild(html);

    container.appendChild(buttonBar);
    container.appendChild(content);

    return container;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof LuaWidget &&
      other.bodyText === this.bodyText && other.cacheKey === this.cacheKey
    );
  }
}

export function renderExpressionResult(result: any): Promise<string> {
  if (result instanceof LuaTable) {
    result = result.toJS();
  }
  if (
    Array.isArray(result) && result.length > 0 && typeof result[0] === "object"
  ) {
    // If result is an array of objects, render as a markdown table
    try {
      return jsonToMDTable(result);
    } catch (e: any) {
      console.error(
        `Error rendering expression directive: ${e.message} for value ${
          JSON.stringify(result)
        }`,
      );
      return Promise.resolve(JSON.stringify(result));
    }
  } else if (typeof result === "object" && result.constructor === Object) {
    // if result is a plain object, render as a markdown table
    return jsonToMDTable([result]);
  } else if (Array.isArray(result)) {
    // Not-object array, let's render it as a markdown list
    return Promise.resolve(result.map((item) => `- ${item}`).join("\n"));
  } else {
    return Promise.resolve("" + result);
  }
}

export function parseHtmlString(html: string): HTMLElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  // Create a wrapper div to hold all elements
  const wrapper = document.createElement("span");
  wrapper.className = "wrapper";
  // Move all body children into the wrapper
  while (doc.body.firstChild) {
    wrapper.appendChild(doc.body.firstChild);
  }
  return wrapper;
}
