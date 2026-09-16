import { WidgetType } from "@codemirror/view";
import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { escapeBakedBody } from "../baked_sections/regions.ts";
import type { Client } from "../client.ts";
import { createWidgetSandboxIFrame } from "../components/widget_sandbox_iframe.ts";
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
import { isViewValue, type ViewValue } from "../navigator/view_value.ts";
import { mountInlineView } from "../navigator/ui/components/inline_view.tsx";
import {
  attachWidgetEventHandlers,
  buildResolveTransclusion,
  buildTranslateUrls,
  findWidgetSourceRange,
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
  | ViewValue
  | {
      _isWidget?: true;
      html?: string | HTMLElement;
      markdown?: string;
      cssClasses?: string[];
      display?: "block" | "inline";
      events?: Record<string, (event: EventPayLoad) => void>;
      // When true, html+script render inside a sandbox iframe (see renderContent).
      sandbox?: boolean;
      // Script to run inside the sandbox iframe (only used when `sandbox` is true).
      script?: string;
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
  /**
   * Whether this widget can be baked into a `<!--#lua EXPR -->` region.
   * Only `${…}` directives qualify: fenced code bodies are not Lua expressions.
   */
  bakeable?: boolean;
  renderEmpty?: boolean;
  openRef?: Ref | null;
}

export class LuaWidget extends WidgetType {
  public dom?: HTMLElement;
  private renderVersion = 0;
  private unmount?: () => void;

  override destroy(): void {
    this.renderVersion++;
    this.unmount?.();
    this.unmount = undefined;
    activeWidgets.delete(this);
  }

  constructor(readonly opts: LuaWidgetOptions) {
    super();
    this.opts = {
      codeText: "",
      renderEmpty: false,
      openRef: null,
      ...opts,
    };
    if (this.opts.inPage) {
      this.opts.client.widgetCache
        .prewarmResult(this.opts.cacheKey, () =>
          this.opts.callback(
            this.opts.expressionText,
            this.opts.client.currentName(),
          ),
        )
        .catch(() => {
          // Ignore: renderContent re-awaits the same promise and handles
          // errors via its own catch path.
        });
    }
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
    // Reserve cached height without restoring HTML: reparsing it changes the
    // measured height and briefly shifts the border on first paint.
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

    const renderStart = performance.now();
    this.renderContent(innerDiv)
      .then(() => {
        performance.measure(`sb:widget:${this.opts.cacheKey.slice(0, 80)}`, {
          start: renderStart,
          end: performance.now(),
        });
      })
      .catch(console.error);
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
    const version = ++this.renderVersion;
    this.unmount?.();
    this.unmount = undefined;
    const currentName = this.opts.client.currentName();
    let widgetContent = this.opts.inPage
      ? await this.opts.client.widgetCache.prewarmResult(
          this.opts.cacheKey,
          () => this.opts.callback(this.opts.expressionText, currentName),
        )
      : await this.opts.callback(this.opts.expressionText, currentName);
    if (version !== this.renderVersion) return;
    activeWidgets.add(this);
    if (isViewValue(widgetContent)) {
      div.className = "sb-lua-directive-block sb-lua-view";
      const host = document.createElement("div");
      host.className = "sb-inline-view";
      div.replaceChildren(
        this.wrapHtml(true, host, undefined, undefined, true),
      );
      div.style.minHeight = "";
      attachWidgetEventHandlers(div, this.opts.client, this.opts.codeText);
      const unmount = mountInlineView(
        host,
        this.opts.client,
        widgetContent,
        currentName,
      );
      const observer = new ResizeObserver(() => {
        if (version !== this.renderVersion || !div.isConnected) return;
        this.opts.client.widgetCache.setCachedWidgetMeta(this.opts.cacheKey, {
          height: div.offsetHeight,
          block: true,
        });
        this.opts.client.editorView.requestMeasure();
      });
      observer.observe(div);
      this.unmount = () => {
        observer.disconnect();
        unmount();
      };
      return;
    }
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

    if (typeof widgetContent === "string" || !widgetContent._isWidget) {
      const rawResult = widgetContent;
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
    const wc = widgetContent as Exclude<LuaWidgetContent, string | ViewValue>;

    if (wc.cssClasses) {
      div.className = wc.cssClasses.join(" ");
    }

    if (wc.sandbox) {
      div.className += " sb-lua-directive-block";
      const iframeContent = {
        html: typeof wc.html === "string" ? wc.html : "",
        script: typeof wc.script === "string" ? wc.script : "",
      };
      const iframe = createWidgetSandboxIFrame(
        this.opts.client,
        this.opts.cacheKey,
        iframeContent,
        (message) => {
          switch (message.type) {
            case "blur": {
              const pos = this.opts.client.editorView.posAtDOM(iframe, 0);
              this.opts.client.editorView.dispatch({
                selection: { anchor: pos },
              });
              this.opts.client.focus();
              break;
            }
          }
        },
      );
      const cachedHeight = this.opts.client.widgetCache.getCachedWidgetHeight(
        this.opts.cacheKey,
      );
      iframe.style.height = `${cachedHeight > 0 ? cachedHeight : 150}px`;
      iframe.style.display = "block";
      const wrapped = this.wrapHtml(
        true,
        iframe,
        wc.markdown,
        typeof wc.markdown === "string" ? wc.markdown.trim() : undefined,
      );
      div.replaceChildren(wrapped);
      div.style.minHeight = "";
      this.opts.client.widgetCache.setCachedWidgetMeta(this.opts.cacheKey, {
        height: cachedHeight > 0 ? cachedHeight : 150,
        block: true,
      });
      return;
    }

    if (wc.html) {
      if (typeof wc.html === "string") {
        html = parseHtmlString(wc.html);
      } else {
        html = wc.html;
      }

      // Widgets may display HTML while exposing Markdown source for copying.
      if (!copyContent) {
        copyContent =
          typeof wc.html === "string"
            ? (wc.markdown ?? wc.html)
            : (wc.markdown ?? wc.html.outerHTML);
      }

      block = wc.display === "block";
      if (block) {
        div.className += " sb-lua-directive-block";
      } else {
        div.className += " sb-lua-directive-inline";
      }
    }
    if (!html && wc.markdown) {
      const syntaxExtensions = this.syntaxExtensions;
      let mdTree = parse(
        buildExtendedMarkdownLanguage(syntaxExtensions),
        wc.markdown || "",
      );

      const resolveTransclusion = buildResolveTransclusion(this.opts.client);
      mdTree = await expandMarkdown(
        this.opts.client.space,
        currentName,
        mdTree,
        this.opts.client.clientSystem.spaceLuaEnv,
        {
          rewriteTasks: false,
          syntaxExtensions,
          resolveTransclusion,
        },
      );
      const trimmedMarkdown = renderToText(mdTree).trim();

      if (!copyContent) {
        copyContent = trimmedMarkdown;
      }

      if (!trimmedMarkdown) {
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
            shortWikiLinks: this.opts.client.config.get("shortWikiLinks", true),
            translateUrls: buildTranslateUrls(this.opts.client),
            resolveTransclusion,
          },
          this.opts.client.ui.viewState.allPages,
        ),
      );
    }
    if (html) {
      if (version !== this.renderVersion) return;
      const bakeBody = wc.html
        ? typeof wc.markdown === "string"
          ? wc.markdown.trim()
          : undefined
        : copyContent;
      div.replaceChildren(this.wrapHtml(block, html, copyContent, bakeBody));
      div.style.minHeight = "";
      attachWidgetEventHandlers(
        div,
        this.opts.client,
        this.opts.inPage ? this.opts.codeText : undefined,
        wc._isWidget && wc.events,
      );
    }

    setTimeout(() => {
      if (version !== this.renderVersion || !div.isConnected) return;
      this.opts.client.widgetCache.setCachedWidgetMeta(this.opts.cacheKey, {
        height: div.offsetHeight,
        block,
      });
      // Skip during IME composition to avoid caret jumps
      if (!this.opts.client.editorView.composing) {
        // Reposition the caret after the widget changes the DOM.
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
    bakeBody?: string | undefined,
    editOnly = false,
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
      button.type = "button";
      button.setAttribute("data-button", title.toLowerCase());
      button.setAttribute("title", title);
      button.setAttribute("aria-label", title);
      button.innerHTML = icon;
      button.addEventListener("click", listener);

      return button;
    };

    if (!editOnly)
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

    if (!editOnly && copyContent) {
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

    if (
      !editOnly &&
      this.opts.bakeable &&
      bakeBody !== undefined &&
      this.opts.codeText &&
      !this.opts.client.isReadOnlyMode()
    ) {
      buttonBar.appendChild(
        createButton({
          title: "Bake",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-package"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
          listener: (e) => {
            e.stopPropagation();
            const range = findWidgetSourceRange(
              this.opts.client,
              this.dom!,
              this.opts.codeText!,
            );
            if (!range) {
              this.opts.client.ui.flashNotification(
                "Could not locate the directive to bake",
                "error",
              );
              return;
            }
            const replacement = `<!--#lua ${this.opts.expressionText} -->\n${escapeBakedBody(
              bakeBody,
            ).trim()}\n<!--/lua-->`;
            this.opts.client.editorView.dispatch({
              changes: { from: range.from, to: range.to, insert: replacement },
            });
            this.opts.client.focus();
          },
        }),
      );
    }

    if (this.opts.inPage && (!editOnly || !this.opts.client.isReadOnlyMode())) {
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

    if (!editOnly && this.opts.openRef) {
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
  const wrapper = document.createElement("span");
  wrapper.className = "wrapper";
  while (doc.body.firstChild) {
    wrapper.appendChild(doc.body.firstChild);
  }
  return wrapper;
}
