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
import { EDIT_QUERY_COMMAND } from "../../navigator/views/workbench.ts";
import type { Tracker } from "../../space_lua/dependencies.ts";
import { isLuaWidgetError } from "../../space_lua/render_lua_markdown.ts";
import { activeWidgets } from "./code_widget.ts";
import {
  bakeDirective,
  copyValue,
  type DirectiveTarget,
  directiveAtWidget,
} from "./directive_actions.ts";
import { LiveBinding } from "./live_binding.ts";
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
import { recordMeasure } from "../../lib/perf.ts";

export type LuaWidgetCallback = (
  bodyText: string,
  pageName: string,
  // Told what the evaluation read, so the widget refreshes when it changes
  track?: Tracker,
) => Promise<LuaWidgetContent | null>;

/**
 * Cache keys per occurrence: identical expressions on one page would share a
 * cached result, and a DOM element in it can only be shown once. The first
 * copy keeps the plain key; a decoration build numbers the rest in order.
 */
/**
 * Keep a widget at least `height` tall, as measured by offsetHeight. That
 * includes the frame's border, so it is held as a border-box size: a
 * content-box min-height would add the border again and grow the widget.
 */
function holdHeight(div: HTMLElement, height: number): void {
  div.style.boxSizing = "border-box";
  div.style.minHeight = `${height}px`;
}

function releaseHeight(div: HTMLElement): void {
  div.style.minHeight = "";
  div.style.boxSizing = "";
}

export class OccurrenceKeys {
  private seen = new Map<string, number>();

  key(base: string): string {
    const n = this.seen.get(base) ?? 0;
    this.seen.set(base, n + 1);
    return n === 0 ? base : `${base}:dup${n}`;
  }
}

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

/** Puts an assignment's name tag in front of its value, outside the value's own element. */
export function labelPageVar(
  node: HTMLElement,
  label: string,
  block: boolean,
): HTMLElement {
  const el = document.createElement(block ? "div" : "span");
  el.className = block ? "sb-page-var sb-page-var-block" : "sb-page-var";
  const tag = document.createElement("span");
  tag.className = "sb-page-var-tag";
  tag.textContent = label;
  el.append(tag, node);
  return el;
}

/** Where a widget sits decides what its ⋯ menu can do. */
export type WidgetHost =
  // `label`: an assignment directive's name, shown as a tag before the value
  | { kind: "directive"; wrappers: InlineWrapper[]; label?: string }
  | { kind: "code"; codeText: string }
  | { kind: "transclusion"; codeText: string; openRef: Ref | null }
  // A tag-rendered object (frontmatter, data block): Edit source goes to its
  // YAML, wherever that is by then
  | {
      kind: "object";
      editPos: () => number | undefined;
      definitionRef: Ref | null;
      /** Deletes the whole object from the page; only frontmatter has it */
      remove?: () => Promise<void>;
    }
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
};

export function widgetCaps(
  host: WidgetHost,
  shown: ShownValue,
  env: { readOnly: boolean; expression?: string },
): WidgetCaps {
  const directive = host.kind === "directive" && !env.readOnly;
  // Baking or rewriting an assignment would drop its definition
  const assignment = host.kind === "directive" && !!host.label;
  return {
    definition:
      (host.kind === "object" || host.kind === "panel") && !!host.definitionRef,
    open: host.kind === "transclusion" && !!host.openRef,
    edit: host.kind !== "panel" && !env.readOnly,
    query:
      directive && !assignment && /^\s*query\s*\[/.test(env.expression ?? ""),
    copy: host.kind !== "object" && shown.copyable,
    bake: directive && !assignment && shown.bakeable && !shown.luaError,
    remove: host.kind === "object" && !!host.remove && !env.readOnly,
  };
}

// CodeMirror reuses an `eq` widget's DOM but destroys through its newest
// instance, which never mounted: teardown has to find the one that did.
const owners = new WeakMap<HTMLElement, LuaWidget>();

/**
 * What an unchanged re-run must reproduce to keep the shown DOM; undefined
 * when equality can't be judged from markup (views mount after the commit).
 * Sandbox hosts compare by their content key: their size and iframe are
 * filled in after rendering.
 */
function renderSignature(
  rendered: RenderedValue,
  luaError: boolean,
): string | undefined {
  const node = rendered.node;
  if (rendered.kind === "view" || node.querySelector(".sb-inline-view")) {
    return undefined;
  }
  const sandbox = "[data-sandbox-content]";
  let markup = node.outerHTML;
  if (node.matches(sandbox) || node.querySelector(sandbox)) {
    const copy = node.cloneNode(true) as HTMLElement;
    for (const host of [copy, ...copy.querySelectorAll<HTMLElement>(sandbox)]) {
      if (!host.matches(sandbox)) continue;
      host.removeAttribute("style");
      host.replaceChildren();
    }
    markup = copy.outerHTML;
  }
  return `${luaError}\n${rendered.chrome.cssClasses?.join(" ") ?? ""}\n${markup}`;
}

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
  // What the shown DOM was rendered from (see renderSignature)
  private shownSignature?: string;
  // Compared on every decoration rebuild; serialized once
  private readonly wrapperKey: string;

  constructor(readonly opts: LuaWidgetOptions) {
    super();
    const host = opts.host;
    this.wrapperKey = JSON.stringify(
      host.kind === "directive" ? host.wrappers : [],
    );
    this.live = new LiveBinding(opts.client.eventInterest, () => {
      this.reload({ keepIfUnchanged: true }).catch((e) =>
        console.error("Live widget reload failed", e),
      );
    });
    if (this.cachesResult) {
      this.prewarm().catch(() => {
        // Ignore: rendering re-awaits the same promise and handles errors
      });
    }
  }

  get cacheKey(): string {
    return this.opts.cacheKey;
  }

  private get cachesResult(): boolean {
    const kind = this.opts.host.kind;
    // Editable DOM and its callbacks belong to a mount, never a source cache.
    return kind !== "panel" && kind !== "object";
  }

  private get renderEmpty(): boolean {
    const kind = this.opts.host.kind;
    return kind === "directive" || kind === "transclusion" || kind === "object";
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
    if (this.cachesResult) {
      this.opts.client.widgetCache.invalidatePrewarm(this.opts.cacheKey);
    }
  }

  private prewarm(): Promise<LuaWidgetContent | null> {
    const { client, cacheKey, expressionText, callback } = this.opts;
    const page = client.currentName();
    return client.widgetCache.prewarmResult(cacheKey, (track) =>
      callback(expressionText, page, track),
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
    this.shownSignature = undefined;
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
        holdHeight(innerDiv, cachedMeta.height);
      }
    }

    const renderStart = performance.now();
    trackRender(this.render(innerDiv).done)
      .then(() => {
        recordMeasure(
          `sb:widget:${this.opts.cacheKey.slice(0, 80)}`,
          renderStart,
          performance.now(),
        );
      })
      .catch(console.error);
    this.dom = wrapperSpan;
    return wrapperSpan;
  }

  async renderContent(div: HTMLElement): Promise<void> {
    await this.render(div).done;
  }

  /**
   * Re-runs only this widget; safe at any time (no-op when disconnected).
   * `keepIfUnchanged` keeps the shown DOM when the result renders the same.
   */
  async reload(opts: { keepIfUnchanged?: boolean } = {}): Promise<void> {
    const div = this.contentDiv;
    if (!div?.isConnected) return;
    // Hold the current height so a re-render doesn't collapse and re-grow the page
    holdHeight(div, div.offsetHeight);
    this.invalidatePrewarm();
    const { version, done } = this.render(div, opts.keepIfUnchanged);
    try {
      await done;
    } finally {
      // A newer render owns the height once it supersedes this one
      if (this.renderVersion === version) releaseHeight(div);
    }
  }

  private render(
    div: HTMLElement,
    keepIfUnchanged = false,
  ): { version: number; done: Promise<void> } {
    const version = ++this.renderVersion;
    // Whoever renders (toDOM, refresh-all) sets the div later reloads use
    this.contentDiv = div;
    return {
      version,
      done: this.renderInto(div, version, keepIfUnchanged),
    };
  }

  private async renderInto(
    div: HTMLElement,
    version: number,
    keepIfUnchanged: boolean,
  ): Promise<void> {
    const { client, cacheKey } = this.opts;
    // Events after this point aren't reflected in what this render reads
    const startedAt = client.eventInterest.seq();
    // What this render reads: a change to any of it refreshes it
    const triggers = new Set<string>();
    const track = (event: string) => triggers.add(event);
    let value = this.cachesResult
      ? await this.prewarm()
      : await this.opts.callback(
          this.opts.expressionText,
          client.currentName(),
          track,
        );
    if (this.cachesResult) {
      for (const t of client.widgetCache.triggers(cacheKey)) triggers.add(t);
    }
    if (version !== this.renderVersion) return;
    // A cached result was computed when its entry was created, maybe earlier
    const computedAt = this.cachesResult
      ? (client.widgetCache.computedAt(cacheKey) ?? startedAt)
      : startedAt;
    activeWidgets.add(this);
    const luaError = isLuaWidgetError(value);
    // Stable marker for failed renders (the visible text stays as is).
    div.classList.toggle("sb-lua-error", luaError);
    if (value === null || value === undefined) {
      if (!this.renderEmpty) {
        // A page it read may still define the value it's missing
        const missed = this.live.bind([...triggers], computedAt);
        this.clear(div);
        if (missed) this.live.trigger();
        return;
      }
      value = { markdown: "nil", _isWidget: true };
    }
    const rendered = await renderValue(
      value,
      liveContextForClient(client, {
        sandboxKey: cacheKey,
        track,
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
    // Stale-while-revalidate: shows the result, then re-runs once if what it
    // read changed since it was computed (while unmounted, for a cached
    // result, or while this render evaluated: binding drops a pending run)
    const revalidate = this.live.bind([...triggers], computedAt);
    const signature = renderSignature(rendered, luaError);
    if (
      keepIfUnchanged &&
      signature !== undefined &&
      signature === this.shownSignature
    ) {
      // Same output: keep the shown DOM, its handlers and state
      disposeRendered(rendered.node);
    } else {
      if (rendered.chrome.cssClasses) {
        div.className = rendered.chrome.cssClasses.join(" ");
      }
      if (rendered.empty && rendered.fromWidget) {
        this.clear(div);
      } else {
        this.commit(div, version, value, luaError, rendered);
        this.shownSignature = signature;
      }
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
    };
    const host = this.opts.host;
    const valueNode =
      host.kind === "directive" && host.label
        ? labelPageVar(rendered.node, host.label, block)
        : rendered.node;
    disposeRendered(div);
    div.replaceChildren(this.wrap(block, valueNode, shown));
    releaseHeight(div);
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
      this.cachesResult ? this.sourceText : undefined,
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
    this.shownSignature = undefined;
    this.scope.dispose();
    disposeRendered(div);
    div.replaceChildren();
    releaseHeight(div);
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
        expression: this.opts.expressionText,
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
          (host.kind === "object" || host.kind === "panel") &&
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
        if (host.kind === "object") {
          const anchor = host.editPos();
          if (anchor === undefined) return;
          client.editorView.dispatch({ selection: { anchor } });
          client.focus();
        } else if (this.dom) {
          moveCursorToWidgetStart(client, this.dom, this.sourceText);
        }
        return;
      case "query": {
        const target = this.directiveTarget();
        if (target) {
          await client.runCommandByName(EDIT_QUERY_COMMAND, [target]);
        }
        return;
      }
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
      case "remove":
        if (host.kind === "object") await host.remove?.();
        return;
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
