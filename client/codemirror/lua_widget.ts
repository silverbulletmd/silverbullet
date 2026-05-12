import { WidgetType } from "@codemirror/view";
import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { Client } from "../client.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { expandMarkdown } from "../markdown_renderer/inline.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";
import {
  classifyResult,
  isBlockMarkdown,
  renderResultToCleanMarkdown,
  renderResultToMarkdown,
} from "../space_lua/render_lua_markdown.ts";
import { activeWidgets } from "./code_widget.ts";
import {
  attachWidgetEventHandlers,
  buildTranslateUrls,
  moveCursorToWidgetStart,
} from "./widget_util.ts";

export type LuaWidgetCallback = (
  bodyText: string,
  pageName: string,
) => Promise<LuaWidgetContent | null>;

export type EventPayLoad = {
  name: string;
  data: any;
};

export type LuaWidgetContent =
  | {
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
    }
  | string;

export interface LuaWidgetOptions {
  client: Client;
  /** Key to use for caching */
  cacheKey: string;
  /** Body text to send to widget renderer */
  expressionText: string;
  callback: LuaWidgetCallback;
  inPage: boolean;
  /** Code as it appears in the page (used to find when hitting the "edit" button) */
  codeText?: string;
  renderEmpty?: boolean;
  openRef?: Ref | null;
}

export class LuaWidget extends WidgetType {
  public dom?: HTMLElement;

  constructor(readonly opts: LuaWidgetOptions) {
    super();
    this.opts = {
      codeText: "",
      renderEmpty: false,
      openRef: null,
      ...opts,
    };
    // Eagerly kick off the widget callback so the query result is ready
    // (or close to it) by the time CodeMirror mounts the widget. Idempotent
    // on cacheKey — the decorator state field rebuilds widgets on every
    // editor update, but only the first construction per cacheKey starts
    // the actual fetch.
    this.opts.client.widgetCache.prewarmResult(this.opts.cacheKey, () =>
      this.opts.callback(
        this.opts.expressionText,
        this.opts.client.currentName(),
      ),
    ).catch(() => {
      // Ignore: renderContent re-awaits the same promise and handles
      // errors via its own catch path.
    });
  }

  override get estimatedHeight(): number {
    return this.opts.client.widgetCache.getCachedWidgetHeight(
      this.opts.cacheKey,
    );
  }

  invalidatePrewarm() {
    this.opts.client.widgetCache.invalidatePrewarm(this.opts.cacheKey);
  }

  toDOM(): HTMLElement {
    const wrapperSpan = document.createElement("span");
    wrapperSpan.className = "sb-lua-wrapper";
    const innerDiv = document.createElement("div");
    wrapperSpan.appendChild(innerDiv);
    // On a cache hit, apply the correct block/inline class and reserve
    // vertical space via min-height. We deliberately do NOT insert any
    // cached HTML — re-parsing a cached HTML string produces a subtly
    // different measured height than the fresh render, causing a brief
    // border-position glitch on first paint.
    const cachedMeta = this.opts.client.widgetCache.getCachedWidgetMeta(
      this.opts.cacheKey,
    );
    if (cachedMeta) {
      innerDiv.className += cachedMeta.block
        ? " sb-lua-directive-block"
        : " sb-lua-directive-inline";
      if (cachedMeta.height > 0) {
        innerDiv.style.minHeight = `${cachedMeta.height}px`;
      }
    }

    // Async kick-off of content renderer
    this.renderContent(innerDiv).catch(console.error);
    this.dom = wrapperSpan;
    return wrapperSpan;
  }

  private get syntaxExtensions() {
    return this.opts.client.config.get("syntaxExtensions", {});
  }

  // Parse and expand custom syntax in a markdown string (no transclusions/directives)
  private async parseAndExpandCustomSyntax(
    text: string,
    pageName: string,
  ): Promise<ParseTree> {
    const syntaxExtensions = this.syntaxExtensions;
    const mdTree = parse(buildExtendedMarkdownLanguage(syntaxExtensions), text);
    return expandMarkdown(
      this.opts.client.space,
      pageName,
      mdTree,
      this.opts.client.clientSystem.spaceLuaEnv,
      {
        expandTransclusions: false,
        expandLuaDirectives: false,
        rewriteTasks: false,
        syntaxExtensions,
      },
    );
  }

  async renderContent(div: HTMLElement) {
    const currentName = this.opts.client.currentName();
    let widgetContent = await this.opts.client.widgetCache.prewarmResult(
      this.opts.cacheKey,
      () => this.opts.callback(this.opts.expressionText, currentName),
    );
    activeWidgets.add(this);
    if (widgetContent === null || widgetContent === undefined) {
      if (!this.opts.renderEmpty) {
        div.innerHTML = "";
        div.style.minHeight = "";
        this.opts.client.widgetCache.removeCachedWidgetMeta(this.opts.cacheKey);
        return;
      }
      widgetContent = { markdown: "nil", _isWidget: true };
    }

    let html: HTMLElement | undefined;
    let block = false;
    let copyContent: string | undefined;

    // Normalization (non-widget results go through markdown rendering)
    if (typeof widgetContent === "string" || !widgetContent._isWidget) {
      const rawResult = widgetContent;
      // Classify once, share the result between the display and copy paths.
      const classified = classifyResult(rawResult);
      const { markdown, dataType } = renderResultToMarkdown(
        rawResult,
        classified,
      );

      const isBlock =
        dataType === "table" ||
        dataType === "list" ||
        (typeof rawResult === "string" && isBlockMarkdown(rawResult));

      widgetContent = {
        _isWidget: true,
        markdown: markdown,
        display: isBlock ? "block" : "inline",
      };
      // Copy button gets a clean GFM-style rendering, not the display markdown.
      copyContent = await renderResultToCleanMarkdown(rawResult, classified);
    }

    // After normalization `widgetContent` is always the object form
    const wc = widgetContent as Exclude<LuaWidgetContent, string>;

    if (wc.cssClasses) {
      div.className = wc.cssClasses.join(" ");
    }
    if (wc.html) {
      if (typeof wc.html === "string") {
        html = parseHtmlString(wc.html);
        if (!copyContent) copyContent = wc.html;
      } else {
        html = wc.html;
        if (!copyContent) copyContent = wc.html.outerHTML;
      }

      block = wc.display === "block";
      if (block) {
        div.className += " sb-lua-directive-block";
      } else {
        div.className += " sb-lua-directive-inline";
      }
    }
    if (wc.markdown) {
      const syntaxExtensions = this.syntaxExtensions;
      let mdTree = parse(
        buildExtendedMarkdownLanguage(syntaxExtensions),
        wc.markdown || "",
      );

      mdTree = await expandMarkdown(
        this.opts.client.space,
        currentName,
        mdTree,
        this.opts.client.clientSystem.spaceLuaEnv,
        {
          rewriteTasks: false,
          syntaxExtensions,
        },
      );
      const trimmedMarkdown = renderToText(mdTree).trim();

      // Fall back to the rendered markdown only if the raw-result path
      // didn't already produce a clean copy string.
      if (!copyContent) {
        copyContent = trimmedMarkdown;
      }

      if (!trimmedMarkdown) {
        // Net empty result after expansion
        div.innerHTML = "";
        div.style.minHeight = "";
        this.opts.client.widgetCache.removeCachedWidgetMeta(this.opts.cacheKey);
        return;
      }

      block =
        (wc._isWidget && wc.display === "block") ||
        isBlockMarkdown(trimmedMarkdown);
      if (block) {
        div.className += " sb-lua-directive-block";
      } else {
        div.className += " sb-lua-directive-inline";
      }

      mdTree = await this.parseAndExpandCustomSyntax(
        trimmedMarkdown,
        currentName,
      );

      html = parseHtmlString(
        renderMarkdownToHtml(
          mdTree,
          {
            shortWikiLinks: this.opts.client.config.get(
              "shortWikiLinks",
              true,
            ),
            translateUrls: buildTranslateUrls(this.opts.client),
          },
          this.opts.client.ui.viewState.allPages,
        ),
      );
    }
    if (html) {
      div.replaceChildren(this.wrapHtml(block, html, copyContent));
      div.style.minHeight = "";
      attachWidgetEventHandlers(
        div,
        this.opts.client,
        this.opts.inPage ? this.opts.codeText : undefined,
        wc._isWidget && wc.events,
      );
    }

    // Let's give it a tick, then measure and cache
    setTimeout(() => {
      this.opts.client.widgetCache.setCachedWidgetMeta(this.opts.cacheKey, {
        height: div.offsetHeight,
        block,
      });
      // Skip during IME composition to avoid caret jumps
      if (!this.opts.client.editorView.composing) {
        // Because of the rejiggering of the DOM, we need to do a no-op
        // cursor move to make sure it's positioned correctly
        this.opts.client.editorView.dispatch({
          selection: this.opts.client.editorView.state.selection,
        });
      }
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

    const createButton = ({
      title,
      icon,
      listener,
    }: {
      title: string;
      icon: string;
      listener: (event: MouseEvent) => void;
    }) => {
      const button = document.createElement("button");
      button.setAttribute("data-button", title.toLowerCase());
      button.setAttribute("title", title);
      button.innerHTML = icon;
      button.addEventListener("click", listener);

      return button;
    };

    buttonBar.appendChild(
      createButton({
        title: "Reload",
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
        listener: (e) => {
          e.stopPropagation();
          this.opts.client.clientSystem
            .localSyscall("system.invokeFunction", ["index.refreshWidgets"])
            .catch(console.error);
        },
      }),
    );

    if (copyContent) {
      buttonBar.appendChild(
        createButton({
          title: "Copy",
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-copy"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
          listener: (e) => {
            e.stopPropagation();

            this.opts.client.clientSystem
              .localSyscall("editor.copyToClipboard", [copyContent])
              .catch(console.error);
          },
        }),
      );
    }

    if (this.opts.inPage) {
      buttonBar.appendChild(
        createButton({
          title: "Edit",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
          listener: (e) => {
            e.stopPropagation();
            moveCursorToWidgetStart(
              this.opts.client,
              this.dom!,
              this.opts.codeText,
            );
          },
        }),
      );
    }

    if (this.opts.openRef) {
      buttonBar.appendChild(
        createButton({
          title: "Open",
          icon: '<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="css-i6dzq1"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
          listener: (e) => {
            e.stopPropagation();
            void this.opts.client.navigate(this.opts.openRef!);
          },
        }),
      );
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
      other.opts.expressionText === this.opts.expressionText &&
      other.opts.cacheKey === this.opts.cacheKey
    );
  }

  override ignoreEvent() {
    return true;
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
