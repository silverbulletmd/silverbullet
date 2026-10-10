import { ConcurrencyLimiter } from "@silverbulletmd/silverbullet/lib/async";
import type { Transclusion } from "@silverbulletmd/silverbullet/lib/transclusion";
import {
  type ParseTree,
  replaceNodesMatching,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import {
  bindWidgetEvents,
  type WidgetObject,
} from "../codemirror/widgets/widget_body.ts";
import { renderLiteralMarkdown } from "../codemirror/widgets/widget_markdown.ts";
import { parseHtmlString } from "../lib/dom.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import type { ViewValue } from "../navigator/view_value.ts";
import type { Space } from "../space.ts";
import {
  LUA_TIMEOUT_MESSAGE,
  type LuaBudget,
  makeLuaBudget,
} from "../space_lua/budget.ts";
import { unescapeTableCellPipes } from "../space_lua/directive_scan.ts";
import { evalExpression } from "../space_lua/eval.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import {
  isBlockMarkdown,
  isLuaWidgetError,
  renderResultToCleanMarkdown,
} from "../space_lua/render_lua_markdown.ts";
import { evaluateForRender } from "../space_lua/render_widget.ts";
import type { SpaceLuaEnvironment } from "../space_lua.ts";
import {
  type CustomSyntaxHtmlRenderer,
  CustomSyntaxRenderedHtmlType,
  expandMarkdown,
  type MarkdownExpandOptions,
  type TaskRefs,
} from "./inline.ts";
import {
  type MarkdownRenderOptions,
  renderMarkdownToHtml,
} from "./markdown_render.ts";
import {
  LuaValueSlotType,
  SLOT_PLACEHOLDER_RE,
  SlotRefType,
  type SlotTable,
  slotIdOf,
  slotMarker,
  slotNode,
} from "./slots.ts";
import { planValue, type ValuePlan } from "./value_plan.ts";

export const MAX_RENDER_DEPTH = 8;
export const DIRECTIVE_CONCURRENCY = 8;
const STOPPED_MESSAGE = "*stopped*";
const VIEW_UNAVAILABLE = "<em>This view requires the live editor.</em>";

export type RenderHost = {
  space: Space;
  sle: SpaceLuaEnvironment;
  syntaxExtensions: Record<string, CustomSyntaxHtmlRenderer>;
  allPages: PageMeta[];
  renderOptions: MarkdownRenderOptions;
  resolveTransclusion?: (t: Transclusion, fromPage: string) => void;
  createSandbox?: (widget: WidgetObject) => HTMLElement;
  mountView?: (
    el: HTMLElement,
    view: ViewValue,
    pageName: string,
  ) => () => void;
  // A list, tree or table view's rows as Markdown: what such a view copies
  // and bakes as. The navigator owns rows, so the client binds it.
  viewMarkdown?: (view: ViewValue) => Promise<PortableMarkdownResult>;
};

export type RenderContext = {
  host: RenderHost;
  hostPage: { name: string };
  sourcePage: string;
  depth: number;
  visited: Set<string>;
  budget: LuaBudget;
  budgetReported: { value: boolean };
  limiter: ConcurrencyLimiter;
  usedNodes: WeakSet<Node>;
  // "page" when the rendered text is `sourcePage`'s own source; nested
  // (Lua-generated) values are "transcluded"
  taskRefs: TaskRefs;
  // Shared with child contexts
  liveTriggers: Set<string>;
};

// The task-reference rule comes from the context, not the caller
export type ExpandSwitches = Pick<MarkdownExpandOptions, "expandTransclusions">;

export type ComposeOptions = { slots?: SlotTable; annotationPositions?: true };

export type RenderedMarkdown = {
  node: HTMLElement;
  // Leaves out nested views' rows: Copy reads them on demand
  copyMarkdown: string;
  // Copy text of each slot, by slot id
  slotCopies: string[];
  // Some slot has something to copy (a nested list view's rows count)
  slotsCopyable: boolean;
  empty: boolean;
};

type RenderedText = Pick<
  RenderedMarkdown,
  "copyMarkdown" | "slotCopies" | "slotsCopyable"
>;

// Copy may read a list view's rows; Bake never does
type TextPurpose = "copy" | "bake";

export type RenderedValue = {
  kind: ValuePlan["kind"];
  node: HTMLElement;
  block: boolean;
  // Leaves out views' rows: Copy reads them on demand
  copyMarkdown: string;
  // Has Markdown to bake (an HTML widget without `markdown` has none, and a
  // view is never baked)
  bakeable: boolean;
  // Has something to copy: Markdown text, or a list view's rows
  copyable: boolean;
  interactive: boolean;
  empty: boolean;
  // Rendered markdown without classes or events of its own: its parse
  // wrapper can be dropped so nested output matches top-level markup
  bare?: boolean;
  // Classes and events of the value itself; the host applies them
  chrome: WidgetChrome;
  // A widget rather than raw data: hosts drop an empty widget but show empty data
  fromWidget: boolean;
  // Triggers of every widget.live rendered so far in this context
  live?: string[];
};

export type WidgetChrome = {
  cssClasses?: string[];
  events?: Record<string, (e: any) => void>;
};

/** Applies a widget's classes and events to `node`; returns the unbind. */
export function applyChrome(
  node: HTMLElement,
  chrome: WidgetChrome,
): () => void {
  if (chrome.cssClasses?.length) node.classList.add(...chrome.cssClasses);
  return bindWidgetEvents(node, chrome.events);
}

function chromeOf(plan: ValuePlan): WidgetChrome {
  switch (plan.kind) {
    case "literal":
      return { cssClasses: plan.cssClasses };
    case "markdown":
    case "html":
      return { cssClasses: plan.cssClasses, events: plan.events };
    case "sandbox":
      return { cssClasses: plan.widget.cssClasses, events: plan.widget.events };
    default:
      return {};
  }
}

function fromWidget(plan: ValuePlan): boolean {
  if (plan.kind === "markdown") return plan.raw === undefined;
  if (plan.kind === "empty") return plan.widget === true;
  return true;
}

export function createRenderContext(
  host: RenderHost,
  opts: {
    hostPage: { name: string };
    sourcePage?: string;
    taskRefs?: TaskRefs;
  },
): RenderContext {
  return {
    host,
    hostPage: opts.hostPage,
    sourcePage: opts.sourcePage ?? opts.hostPage.name,
    depth: 0,
    visited: new Set(),
    budget: makeLuaBudget({
      onLimit: (b) => {
        b.stopped = true;
      },
    }),
    budgetReported: { value: false },
    limiter: new ConcurrencyLimiter(DIRECTIVE_CONCURRENCY),
    usedNodes: new WeakSet(),
    taskRefs: opts.taskRefs ?? "transcluded",
    liveTriggers: new Set(),
  };
}

// One per slot: a slot's transclusions must not count as cycles for its siblings
function childContext(ctx: RenderContext): RenderContext {
  return {
    ...ctx,
    depth: ctx.depth + 1,
    taskRefs: ctx.taskRefs === "none" ? "none" : "transcluded",
    visited: new Set(ctx.visited),
  };
}

export function evalDirective(
  exprText: string,
  ctx: RenderContext,
): Promise<unknown> {
  return ctx.limiter.run(() => {
    // Only Lua time counts: not the I/O and rendering since the last directive
    ctx.budget.lastCheck = ctx.budget.now();
    return evaluateForRender(
      ctx.host.sle,
      (env, sf) => evalExpression(parseExpressionString(exprText), env, sf),
      {} as any,
      {
        currentPage: ctx.hostPage,
        sourcePage: ctx.sourcePage,
        budget: ctx.budget,
        renderDepth: ctx.depth,
        stoppedMessage: () => {
          if (ctx.budgetReported.value) return STOPPED_MESSAGE;
          ctx.budgetReported.value = true;
          return LUA_TIMEOUT_MESSAGE;
        },
      },
    );
  });
}

// Built once per host: with syntax extensions it is a fresh lezer language
const languages = new WeakMap<
  RenderHost,
  ReturnType<typeof buildExtendedMarkdownLanguage>
>();

function language(ctx: RenderContext) {
  let lang = languages.get(ctx.host);
  if (!lang) {
    lang = buildExtendedMarkdownLanguage(ctx.host.syntaxExtensions);
    languages.set(ctx.host, lang);
  }
  return lang;
}

/** Expands transclusions and custom syntax; replaces directives with slots. */
export async function expandToSlots(
  tree: ParseTree,
  ctx: RenderContext,
  slots: SlotTable,
  expandOptions: ExpandSwitches = {},
): Promise<void> {
  const pending: Promise<void>[] = [];
  await expandMarkdown(
    ctx.host.space,
    ctx.sourcePage,
    tree,
    ctx.host.sle,
    {
      expandTransclusions: expandOptions.expandTransclusions,
      taskRefs: ctx.taskRefs,
      syntaxExtensions: ctx.host.syntaxExtensions,
      resolveTransclusion: ctx.host.resolveTransclusion,
      luaDirectiveHandler: (exprText, sourcePage, inTableCell) => {
        const id = slots.length;
        slots.push(undefined);
        const expr = inTableCell ? unescapeTableCellPipes(exprText) : exprText;
        pending.push(
          evalDirective(expr, { ...ctx, sourcePage }).then((value) => {
            slots[id] = value;
          }),
        );
        return slotNode(id);
      },
    },
    ctx.visited,
  );
  await Promise.all(pending);
}

function textWithSlots(tree: ParseTree, copies: string[]): string {
  if (tree.type === LuaValueSlotType || tree.type === SlotRefType) {
    return copies[slotIdOf(tree)] ?? "";
  }
  if (tree.text !== undefined) return tree.text;
  return (tree.children ?? []).map((c) => textWithSlots(c, copies)).join("");
}

const disposers = new WeakMap<Element, () => void>();

export function registerDispose(el: HTMLElement, fn: () => void): void {
  el.dataset.sbDisposable = "true";
  disposers.set(el, fn);
}

/** Unmounts nested views rendered at or under `root`. */
export function disposeRendered(root: Element): void {
  const nodes = Array.from(root.querySelectorAll("[data-sb-disposable]"));
  if ((root as HTMLElement).dataset?.sbDisposable) nodes.unshift(root);
  for (const el of nodes) {
    disposers.get(el)?.();
    disposers.delete(el);
  }
}

// Keeps clicks on a nested interactive widget from reaching host handlers
// (table click-to-edit, CodeMirror selection).
function isolateEvents(el: HTMLElement) {
  for (const type of ["mousedown", "click"]) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
}

async function hydrate(
  root: HTMLElement,
  slots: SlotTable,
  ctx: RenderContext,
): Promise<{ copies: string[]; copyable: boolean }> {
  const placeholders = Array.from(
    root.querySelectorAll<HTMLElement>("span.sb-slot[data-sb-slot]"),
  );
  const copies: string[] = [];
  let copyable = false;
  await Promise.all(
    placeholders.map(async (ph) => {
      const id = Number(ph.dataset.sbSlot);
      if (id >= slots.length) {
        ph.replaceWith(document.createTextNode(slotMarker(id)));
        return;
      }
      const rendered = await renderValue(slots[id], childContext(ctx));
      applyChrome(rendered.node, rendered.chrome);
      copies[id] = rendered.copyMarkdown;
      copyable ||= rendered.copyable;
      const wrapper = document.createElement(rendered.block ? "div" : "span");
      wrapper.className = "sb-slot";
      wrapper.style.display = "contents";
      if (rendered.bare) {
        wrapper.append(...Array.from(rendered.node.childNodes));
      } else {
        wrapper.append(rendered.node);
      }
      if (rendered.interactive) isolateEvents(wrapper);
      ph.replaceWith(wrapper);
    }),
  );
  return { copies, copyable };
}

function toTree(src: string | ParseTree, ctx: RenderContext): ParseTree {
  return typeof src === "string" ? parse(language(ctx), src) : src;
}

// Shared by the live and static renderers: expand, then render with slots
async function renderWithSlots(
  src: string | ParseTree,
  ctx: RenderContext,
  opts: ComposeOptions,
): Promise<{ tree: ParseTree; slots: SlotTable; html: string }> {
  const slots: SlotTable = [...(opts.slots ?? [])];
  const tree = toTree(src, ctx);
  await expandToSlots(tree, ctx, slots);
  const html = renderMarkdownToHtml(
    tree,
    {
      ...ctx.host.renderOptions,
      ...(opts.annotationPositions && { annotationPositions: true }),
      slotRefLimit: opts.slots?.length ?? 0,
    },
    ctx.host.allPages,
  );
  return { tree, slots, html };
}

/** Renders markdown to live DOM; nested values are mounted with listeners. */
export async function renderMarkdown(
  src: string | ParseTree,
  ctx: RenderContext,
  opts: ComposeOptions = {},
): Promise<RenderedMarkdown> {
  const { tree, slots, html } = await renderWithSlots(src, ctx, opts);
  const node = parseHtmlString(html);
  const { copies, copyable } = await hydrate(node, slots, ctx);
  return {
    node,
    copyMarkdown: textWithSlots(tree, copies).trim(),
    slotCopies: copies,
    slotsCopyable: copyable,
    empty: !html.trim(),
  };
}

/** Renders markdown to an HTML string; nested widgets lose their listeners. */
export async function renderMarkdownStatic(
  src: string | ParseTree,
  ctx: RenderContext,
  opts: ComposeOptions = {},
): Promise<string> {
  const { slots, html } = await renderWithSlots(src, ctx, opts);
  const lowered = await Promise.all(
    slots.map((value) => lowerValueStatic(value, childContext(ctx))),
  );
  return html.replace(
    SLOT_PLACEHOLDER_RE,
    (_m, id) => lowered[+id] ?? slotMarker(+id),
  );
}

// Copy or Bake text of markdown with directives: expanded, never rendered,
// so a nested value's text is computed only when asked for
async function markdownText(
  src: string,
  slots: SlotTable,
  ctx: RenderContext,
  purpose: TextPurpose,
): Promise<string> {
  const all: SlotTable = [...slots];
  const tree = toTree(src, ctx);
  await expandToSlots(tree, ctx, all);
  const copies = await Promise.all(all.map((v) => nestedText(v, ctx, purpose)));
  return textWithSlots(tree, copies).trim();
}

async function nestedText(
  value: unknown,
  ctx: RenderContext,
  purpose: TextPurpose,
): Promise<string> {
  const child = childContext(ctx);
  return textOf(await planMarkdown(planAt(value, child), child, purpose));
}

/** Expands a tree with every slot lowered back to markdown or raw HTML nodes. */
export async function expandMarkdownStatic(
  tree: ParseTree,
  ctx: RenderContext,
  expandOptions: ExpandSwitches = {},
): Promise<ParseTree> {
  const slots: SlotTable = [];
  await expandToSlots(tree, ctx, slots, expandOptions);
  const replacements = await Promise.all(
    slots.map(async (value): Promise<ParseTree> => {
      const child = childContext(ctx);
      const plan = planAt(value, child);
      if (plan.kind === "markdown" && plan.slots.length === 0) {
        return expandMarkdownStatic(
          parse(language(ctx), plan.markdown),
          child,
          expandOptions,
        );
      }
      if (
        plan.kind === "literal" ||
        plan.kind === "html" ||
        plan.kind === "sandbox"
      ) {
        const markdown = textOf(await planMarkdown(plan, child, "copy"));
        if (markdown) return parse(language(ctx), markdown);
      }
      const html = await lowerPlanStatic(plan, child);
      return { type: CustomSyntaxRenderedHtmlType, children: [{ text: html }] };
    }),
  );
  replaceNodesMatching(tree, (c) =>
    c.type === LuaValueSlotType ? replacements[slotIdOf(c)] : undefined,
  );
  return tree;
}

function nestingError(): string {
  return `**Error:** Widget nesting too deep (${MAX_RENDER_DEPTH})`;
}

function planAt(value: unknown, ctx: RenderContext): ValuePlan {
  return planValue(
    ctx.depth > MAX_RENDER_DEPTH ? nestingError() : value,
    (refreshOn) => {
      for (const t of refreshOn) ctx.liveTriggers.add(t);
    },
    ctx.host.sle.env,
  );
}

export type PortableMarkdownResult =
  | { ok: true; markdown: string }
  | { ok: false; reason: string };

const VIEW_REASON = "A view has no portable Markdown rendering";
const HTML_ONLY_REASON = "html-only widget (no markdown rendering)";

const markdownOk = (markdown: string): PortableMarkdownResult => ({
  ok: true,
  markdown,
});

function orHtmlOnly(markdown: string): PortableMarkdownResult {
  const text = markdown.trim();
  return text ? markdownOk(text) : { ok: false, reason: HTML_ONLY_REASON };
}

const textOf = (r: PortableMarkdownResult) => (r.ok ? r.markdown : "");

// Content views have no portable Markdown; list, tree and table views copy
// their rows when the host can read them
function rowsOf(view: ViewValue, host: RenderHost) {
  return view.meta.hasContent ? undefined : host.viewMarkdown;
}

/**
 * The Markdown a plan copies or bakes as. `rendered` is this plan's markdown
 * when the caller already rendered it, so nothing nested is evaluated twice.
 */
async function planMarkdown(
  plan: ValuePlan,
  ctx: RenderContext,
  purpose: TextPurpose,
  rendered?: RenderedText,
): Promise<PortableMarkdownResult> {
  switch (plan.kind) {
    case "empty":
      return markdownOk("");
    case "view": {
      const rows = purpose === "copy" && rowsOf(plan.view, ctx.host);
      return rows ? rows(plan.view) : { ok: false, reason: VIEW_REASON };
    }
    case "literal":
      return markdownOk(plan.markdown.trim());
    case "html":
      return orHtmlOnly(plan.copyMarkdown);
    case "sandbox":
      return orHtmlOnly(
        typeof plan.widget.markdown === "string" ? plan.widget.markdown : "",
      );
    case "markdown": {
      if (plan.raw === undefined) {
        return markdownOk(
          rendered
            ? rendered.copyMarkdown
            : await markdownText(plan.markdown, plan.slots, ctx, purpose),
        );
      }
      const known =
        rendered &&
        ((v: unknown) => {
          const id = plan.slots.indexOf(v);
          return id < 0 ? undefined : rendered.slotCopies[id];
        });
      return markdownOk(await cleanMarkdown(plan.raw, ctx, purpose, known));
    }
  }
}

// Raw data copies as clean GFM; a widget inside it by the same rule as above
async function cleanMarkdown(
  raw: unknown,
  ctx: RenderContext,
  purpose: TextPurpose,
  known?: (v: unknown) => string | undefined,
): Promise<string> {
  const text = await renderResultToCleanMarkdown(
    raw,
    async (v) => known?.(v) ?? (await nestedText(v, ctx, purpose)),
  );
  return text.trim();
}

/** The Markdown a value copies as. */
export function portableMarkdown(
  value: unknown,
  ctx: RenderContext,
): Promise<PortableMarkdownResult> {
  return planMarkdown(planAt(value, ctx), ctx, "copy");
}

// What a rendered value copies as. A view's rows are read only when copied,
// not on every render.
async function renderedCopy(
  plan: ValuePlan,
  ctx: RenderContext,
  rendered: RenderedText | undefined,
): Promise<Pick<RenderedValue, "copyMarkdown" | "bakeable" | "copyable">> {
  if (plan.kind === "view") {
    return {
      copyMarkdown: "",
      bakeable: false,
      copyable: !!rowsOf(plan.view, ctx.host),
    };
  }
  const r = await planMarkdown(plan, ctx, "copy", rendered);
  const copyMarkdown = textOf(r);
  return {
    copyMarkdown,
    bakeable: r.ok,
    copyable: r.ok && (copyMarkdown.trim() !== "" || !!rendered?.slotsCopyable),
  };
}

/**
 * Bake text: Copy's text, except that a rendered Lua error is refused and a
 * view, which would freeze, gives nothing at any depth.
 */
export function bakeMarkdown(
  value: unknown,
  ctx: RenderContext,
): Promise<PortableMarkdownResult> {
  if (isLuaWidgetError(value)) {
    return Promise.resolve({ ok: false, reason: value as string });
  }
  return planMarkdown(planAt(value, ctx), ctx, "bake");
}

/** Renders any Lua value as live DOM. */
export async function renderValue(
  value: unknown,
  ctx: RenderContext,
): Promise<RenderedValue> {
  const plan = planAt(value, ctx);
  let out: Omit<
    RenderedValue,
    "copyMarkdown" | "bakeable" | "copyable" | "chrome" | "fromWidget" | "live"
  >;
  let rendered: RenderedText | undefined;
  switch (plan.kind) {
    case "empty":
      out = {
        kind: plan.kind,
        node: document.createElement("span"),
        block: false,
        interactive: false,
        empty: true,
      };
      break;
    case "literal": {
      const markdown = plan.markdown.trim();
      const node = parseHtmlString(
        renderLiteralMarkdown(
          markdown,
          ctx.host.allPages,
          ctx.host.renderOptions,
        ),
      );
      out = {
        kind: plan.kind,
        node,
        block: plan.block ?? isBlockMarkdown(markdown),
        interactive: false,
        empty: !markdown,
        bare: !plan.cssClasses?.length,
      };
      break;
    }
    case "markdown": {
      const r = await renderMarkdown(plan.markdown, ctx, { slots: plan.slots });
      rendered = r;
      out = {
        kind: plan.kind,
        node: r.node,
        block: plan.block ?? isBlockMarkdown(r.copyMarkdown),
        interactive: !!plan.events || plan.slots.length > 0,
        empty: r.empty,
        bare: !plan.cssClasses?.length && !plan.events,
      };
      break;
    }
    case "html": {
      let node: HTMLElement;
      if (typeof plan.html === "string") {
        node = parseHtmlString(plan.html);
      } else {
        node = ctx.usedNodes.has(plan.html)
          ? (plan.html.cloneNode(true) as HTMLElement)
          : plan.html;
        ctx.usedNodes.add(node);
      }
      out = {
        kind: plan.kind,
        node,
        block: plan.block,
        interactive: typeof plan.html !== "string" || !!plan.events,
        empty: false,
      };
      break;
    }
    case "sandbox": {
      const node = ctx.host.createSandbox
        ? ctx.host.createSandbox(plan.widget)
        : (await renderMarkdown(plan.widget.markdown ?? "", ctx)).node;
      out = {
        kind: plan.kind,
        node,
        block: true,
        interactive: true,
        empty: false,
      };
      break;
    }
    case "view": {
      const node = document.createElement("div");
      node.className = "sb-inline-view";
      if (ctx.host.mountView) {
        registerDispose(
          node,
          ctx.host.mountView(node, plan.view, ctx.hostPage.name),
        );
      } else {
        node.append(parseHtmlString(VIEW_UNAVAILABLE));
      }
      out = {
        kind: plan.kind,
        node,
        block: true,
        interactive: true,
        empty: false,
      };
      break;
    }
  }
  return {
    ...out,
    ...(await renderedCopy(plan, ctx, rendered)),
    chrome: chromeOf(plan),
    fromWidget: fromWidget(plan),
    live: ctx.liveTriggers.size ? [...ctx.liveTriggers] : undefined,
  };
}

/** Lowers any Lua value to an HTML string (listeners are dropped). */
function lowerValueStatic(value: unknown, ctx: RenderContext): Promise<string> {
  return lowerPlanStatic(planAt(value, ctx), ctx);
}

async function lowerPlanStatic(
  plan: ValuePlan,
  ctx: RenderContext,
): Promise<string> {
  switch (plan.kind) {
    case "empty":
      return "";
    case "literal":
      return renderLiteralMarkdown(
        plan.markdown.trim(),
        ctx.host.allPages,
        ctx.host.renderOptions,
      );
    case "markdown":
      return renderMarkdownStatic(plan.markdown, ctx, { slots: plan.slots });
    case "html":
      return typeof plan.html === "string" ? plan.html : plan.html.outerHTML;
    case "sandbox": {
      const markdown = plan.widget.markdown ?? "";
      return markdown ? renderMarkdownStatic(markdown, ctx) : "";
    }
    case "view":
      return VIEW_UNAVAILABLE;
  }
}
