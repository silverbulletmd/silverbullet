import { WidgetType } from "@codemirror/view";
import { bindWidgetEvents, type WidgetObject } from "./widget_body.ts";

export type { EventPayLoad } from "./widget_body.ts";

import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import type { Client } from "../../client.ts";
import { openPopupMenu } from "../../components/popup_menu.ts";
import { Disposers } from "../../lib/util.ts";
import {
  disposeRendered,
  type RenderedValue,
  renderValue,
} from "../../markdown_renderer/compose.ts";
import { liveContextForClient } from "../../markdown_renderer/compose_client.ts";
import type { ViewValue } from "../../navigator/view_value.ts";
import { isLuaWidgetError } from "../../space_lua/render_lua_markdown.ts";
import { activeWidgets } from "./code_widget.ts";
import {
  bakeDirective,
  copyValue,
  type DirectiveTarget,
  directiveAtWidget,
  liveToggle,
  setDirectiveLive,
} from "./directive_actions.ts";
import { LiveBinding, snapshotEventCounts } from "./live_binding.ts";
import { trackRender } from "./render_settle.ts";
import {
  moreIcon,
  type WidgetActionId,
  type WidgetCaps,
  widgetMenuEntries,
} from "./widget_menu.ts";

import {
  attachWidgetEventHandlers,
  moveCursorToWidgetStart,
} from "./widget_util.ts";

export type LuaWidgetCallback = (
  bodyText: string,
  pageName: string,
) => Promise<LuaWidgetContent | null>;

export type LuaWidgetContent = ViewValue | WidgetObject | string;

export type InlineWrapper = { tag: string; attrs?: Record<string, string> };

export function wrapInline(
  html: HTMLElement,
  wrappers: InlineWrapper[],
): HTMLElement {
  return wrappers.reduceRight((inner, w) => {
    const el = document.createElement(w.tag);
    for (const [k, v] of Object.entries(w.attrs ?? {})) el.setAttribute(k, v);
    el.append(inner);
    return el;
  }, html);
}

/** Where a widget sits decides what its ⋯ menu can do. */
export type WidgetHost =
  | { kind: "directive"; wrappers: InlineWrapper[] }
  | { kind: "code"; codeText: string }
  | { kind: "transclusion"; codeText: string; openRef: Ref | null }
  | { kind: "frontmatter"; editPos: number; definitionRef: Ref | null }
  // Legacy hooks:renderTopWidgets/BottomWidgets: a captured result
  | { kind: "panel"; definitionRef: Ref | null };

export type LuaWidgetOptions = {
  client: Client;
  /** Key to use for caching */
  cacheKey: string;
  /** Body text to send to widget renderer */
  expressionText: string;
  callback: LuaWidgetCallback;
  host: WidgetHost;
};

/** What the last render showed, as far as the ⋯ menu cares. */
export type ShownValue = {
  kind: RenderedValue["kind"];
  bakeable: boolean;
  copyable: boolean;
  luaError: boolean;
  live?: string[];
};

export function widgetCaps(
  host: WidgetHost,
  shown: ShownValue,
  env: { readOnly: boolean; expr: string },
): WidgetCaps {
  const directive = host.kind === "directive" && !env.readOnly;
  return {
    definition:
      (host.kind === "frontmatter" || host.kind === "panel") &&
      !!host.definitionRef,
    open: host.kind === "transclusion" && !!host.openRef,
    edit: host.kind !== "panel" && !env.readOnly,
    live: shown.live,
    copy: host.kind !== "frontmatter" && shown.copyable,
    bake: directive && shown.bakeable && !shown.luaError,
    toggleLive: directive
      ? liveToggle(env.expr, { live: !!shown.live, kind: shown.kind })
      : undefined,
  };
}

// CodeMirror reuses an `eq` widget's DOM but destroys through its newest
// instance, which never mounted: teardown has to find the one that did.
const owners = new WeakMap<HTMLElement, LuaWidget>();

export class LuaWidget extends WidgetType {
  public dom?: HTMLElement;
  public contentDiv?: HTMLElement;
  private renderVersion = 0;
  private scope = new Disposers();
  private readonly live: LiveBinding;
  // Copy and Bake compute their text from it only when picked
  private shownValue: unknown = null;
  // What commit mounted, which may be a cached result's own element
  private shownNode?: HTMLElement;
  // Compared on every decoration rebuild; serialized once
  private readonly wrapperKey: string;

  constructor(readonly opts: LuaWidgetOptions) {
    super();
    const host = opts.host;
    this.wrapperKey = JSON.stringify(
      host.kind === "directive" ? host.wrappers : [],
    );
    this.live = new LiveBinding(opts.client.eventHook, () => {
      this.reload().catch((e) => console.error("Live widget reload failed", e));
    });
    if (this.inPage) {
      this.prewarm().catch(() => {
        // Ignore: rendering re-awaits the same promise and handles errors
      });
    }
  }

  get cacheKey(): string {
    return this.opts.cacheKey;
  }

  private get inPage(): boolean {
    return this.opts.host.kind !== "panel";
  }

  private get renderEmpty(): boolean {
    const kind = this.opts.host.kind;
    return (
      kind === "directive" || kind === "transclusion" || kind === "frontmatter"
    );
  }

  /** The widget's source in the page, for Alt-click and Edit source. */
  private get sourceText(): string | undefined {
    const host = this.opts.host;
    if (host.kind === "directive") return `\${${this.opts.expressionText}}`;
    return host.kind === "code" || host.kind === "transclusion"
      ? host.codeText
      : undefined;
  }

  override get estimatedHeight(): number {
    return this.opts.client.widgetCache.getCachedWidgetHeight(
      this.opts.cacheKey,
    );
  }

  invalidatePrewarm() {
    this.opts.client.widgetCache.invalidatePrewarm(this.opts.cacheKey);
  }

  private prewarm(): Promise<LuaWidgetContent | null> {
    const { client, cacheKey, expressionText, callback } = this.opts;
    const page = client.currentName();
    return client.widgetCache.prewarmResult(
      cacheKey,
      () => callback(expressionText, page),
      () => snapshotEventCounts(client.eventHook),
    );
  }

  override destroy(dom?: HTMLElement): void {
    const owner = (dom && owners.get(dom)) || this;
    owner.teardown();
    if (owner !== this) this.teardown();
  }

  private teardown(): void {
    this.renderVersion++;
    this.scope.dispose();
    this.live.dispose();
    if (this.dom) disposeRendered(this.dom);
    // The widget cache keeps results (and `dom.*` elements) for reuse: detach
    // ours so a cached element can't hold this widget's DOM, its CodeMirror
    // tiles and every widget in them alive. Only while it's ours: another copy
    // of the same directive may have mounted that element since
    if (this.shownNode && this.dom?.contains(this.shownNode)) {
      this.shownNode.remove();
    }
    this.shownNode = undefined;
    activeWidgets.delete(this);
  }

  toDOM(): HTMLElement {
    const wrapperSpan = document.createElement("span");
    wrapperSpan.className = "sb-lua-wrapper";
    const innerDiv = document.createElement("div");
    this.contentDiv = innerDiv;
    owners.set(wrapperSpan, this);
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
    trackRender(this.render(innerDiv, true).done)
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

  async renderContent(div: HTMLElement): Promise<void> {
    await this.render(div, false).done;
  }

  /** Re-runs only this widget; safe at any time (no-op when disconnected). */
  async reload(): Promise<void> {
    const div = this.contentDiv;
    if (!div?.isConnected) return;
    // Hold the current height so a re-render doesn't collapse and re-grow the page
    div.style.minHeight = `${div.offsetHeight}px`;
    this.invalidatePrewarm();
    const { version, done } = this.render(div, false);
    try {
      await done;
    } finally {
      // A newer render owns the height once it supersedes this one
      if (this.renderVersion === version) div.style.minHeight = "";
    }
  }

  private render(
    div: HTMLElement,
    remount: boolean,
  ): { version: number; done: Promise<void> } {
    const version = ++this.renderVersion;
    // Whoever renders (toDOM, refresh-all) sets the div later reloads use
    this.contentDiv = div;
    return { version, done: this.renderInto(div, version, remount) };
  }

  private async renderInto(
    div: HTMLElement,
    version: number,
    remount: boolean,
  ): Promise<void> {
    const { client, cacheKey } = this.opts;
    let value = this.inPage
      ? await this.prewarm()
      : await this.opts.callback(
          this.opts.expressionText,
          client.currentName(),
        );
    if (version !== this.renderVersion) return;
    activeWidgets.add(this);
    const luaError = isLuaWidgetError(value);
    // Stable marker for failed renders (the visible text stays as is).
    div.classList.toggle("sb-lua-error", luaError);
    if (value === null || value === undefined) {
      if (!this.renderEmpty) {
        this.live.bind(undefined);
        this.clear(div);
        return;
      }
      value = { markdown: "nil", _isWidget: true };
    }
    const rendered = await renderValue(
      value,
      liveContextForClient(client, {
        sandboxKey: cacheKey,
        onSandboxMessage: (message, iframe) => {
          if (message.type !== "blur") return;
          const pos = client.editorView.posAtDOM(iframe, 0);
          client.editorView.dispatch({ selection: { anchor: pos } });
          client.focus();
        },
      }),
    );
    if (version !== this.renderVersion) {
      disposeRendered(rendered.node);
      return;
    }
    // Stale-while-revalidate: a remounted widget shows its cached result, then
    // re-runs if that result missed one of its events while unmounted
    const revalidate = this.live.bind(
      rendered.live,
      remount && this.inPage
        ? client.widgetCache.computedAt(cacheKey)
        : undefined,
    );
    if (rendered.chrome.cssClasses) {
      div.className = rendered.chrome.cssClasses.join(" ");
    }
    if (rendered.empty && rendered.fromWidget) {
      this.clear(div);
    } else {
      this.commit(div, version, value, luaError, rendered);
    }
    if (revalidate) this.live.trigger();
  }

  private commit(
    div: HTMLElement,
    version: number,
    value: unknown,
    luaError: boolean,
    rendered: RenderedValue,
  ): void {
    const client = this.opts.client;
    this.scope.dispose();
    const block = rendered.block;
    // Reloads render into the same div, so replace the kind class rather than append
    div.classList.remove("sb-lua-directive-block", "sb-lua-directive-inline");
    div.classList.add(
      block ? "sb-lua-directive-block" : "sb-lua-directive-inline",
    );
    div.classList.toggle("sb-lua-view", rendered.kind === "view");
    this.shownValue = value;
    this.shownNode = rendered.node;
    const shown: ShownValue = {
      kind: rendered.kind,
      bakeable: rendered.bakeable,
      copyable: rendered.copyable,
      luaError,
      live: rendered.live,
    };
    disposeRendered(div);
    div.replaceChildren(this.wrap(block, rendered.node, shown));
    div.style.minHeight = "";
    if (rendered.kind === "view" || rendered.kind === "sandbox") {
      // Views and sandboxes size themselves after mounting
      const observer = new ResizeObserver(() => {
        if (version !== this.renderVersion || !div.isConnected) return;
        client.widgetCache.setCachedWidgetMeta(this.opts.cacheKey, {
          height: div.offsetHeight,
          block: true,
        });
        client.editorView.requestMeasure();
      });
      observer.observe(div);
      this.scope.add(() => observer.disconnect());
    }
    attachWidgetEventHandlers(
      div,
      client,
      this.inPage ? this.sourceText : undefined,
    );
    this.scope.add(bindWidgetEvents(div, rendered.chrome.events));

    setTimeout(() => {
      if (version !== this.renderVersion || !div.isConnected) return;
      client.widgetCache.setCachedWidgetMeta(this.opts.cacheKey, {
        height: div.offsetHeight,
        block,
      });
      // Skip during IME composition to avoid caret jumps
      if (!client.editorView.composing) {
        // Reposition the caret after the widget changes the DOM.
        client.editorView.dispatch({
          selection: client.editorView.state.selection,
        });
      }
    });
  }

  private clear(div: HTMLElement): void {
    this.shownNode = undefined;
    this.scope.dispose();
    disposeRendered(div);
    div.replaceChildren();
    div.style.minHeight = "";
    this.opts.client.widgetCache.removeCachedWidgetMeta(this.opts.cacheKey);
  }

  private wrap(
    block: boolean,
    node: HTMLElement,
    shown: ShownValue,
  ): HTMLElement {
    const host = this.opts.host;
    if (!block && !(host.kind === "panel" && host.definitionRef)) {
      return host.kind === "directive" && host.wrappers.length
        ? wrapInline(node, host.wrappers)
        : node;
    }
    const container = document.createElement("div");
    const buttonBar = document.createElement("div");
    buttonBar.className = "sb-widget-menu-bar";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sb-widget-menu-button";
    button.setAttribute("data-button", "menu");
    button.setAttribute("title", "Widget actions");
    button.setAttribute("aria-label", "Widget actions");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = moreIcon;
    if (shown.live) {
      const dot = document.createElement("span");
      dot.className = "sb-widget-live-dot";
      button.appendChild(dot);
    }
    let closeMenu: (() => void) | undefined;
    this.scope.add(() => closeMenu?.());
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (button.getAttribute("aria-expanded") === "true") {
        closeMenu?.();
        return;
      }
      const caps = widgetCaps(this.opts.host, shown, {
        readOnly: this.opts.client.isReadOnlyMode(),
        expr: this.opts.expressionText,
      });
      closeMenu = openPopupMenu(
        button,
        widgetMenuEntries(caps),
        (id) => {
          this.runAction(id).catch(console.error);
        },
        "sb-widget-menu",
      );
    });
    buttonBar.appendChild(button);

    const content = document.createElement("div");
    content.className = "content";
    content.appendChild(node);

    container.appendChild(buttonBar);
    container.appendChild(content);
    return container;
  }

  async runAction(id: WidgetActionId): Promise<void> {
    const { client, host } = this.opts;
    switch (id) {
      case "definition":
        if (
          (host.kind === "frontmatter" || host.kind === "panel") &&
          host.definitionRef
        ) {
          await client.navigate(host.definitionRef);
        }
        return;
      case "open":
        if (host.kind === "transclusion" && host.openRef) {
          await client.navigate(host.openRef);
        }
        return;
      case "edit":
        if (host.kind === "frontmatter") {
          client.editorView.dispatch({ selection: { anchor: host.editPos } });
          client.focus();
        } else if (this.dom) {
          moveCursorToWidgetStart(client, this.dom, this.sourceText);
        }
        return;
      case "reload":
        if (host.kind === "panel") {
          // Panel widgets render a captured result; only re-running the hooks refreshes them
          await client.clientSystem.localSyscall("system.invokeFunction", [
            "index.refreshWidgets",
          ]);
        } else {
          await this.reload();
        }
        return;
      case "copy":
        await copyValue(client, this.shownValue);
        return;
      case "bake": {
        const target = this.directiveTarget();
        if (target) await bakeDirective(client, target, this.shownValue);
        return;
      }
      case "makeLive":
      case "makeStatic": {
        const target = this.directiveTarget();
        if (target) setDirectiveLive(client, target, id);
        return;
      }
    }
  }

  private directiveTarget(): DirectiveTarget | undefined {
    const target =
      this.dom &&
      directiveAtWidget(this.opts.client, this.dom, this.opts.expressionText);
    if (!target) {
      this.opts.client.ui.flashNotification(
        "Could not locate the directive",
        "error",
      );
    }
    return target;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof LuaWidget &&
      other.opts.expressionText === this.opts.expressionText &&
      other.opts.cacheKey === this.opts.cacheKey &&
      other.wrapperKey === this.wrapperKey
    );
  }

  override ignoreEvent() {
    return true;
  }
}
