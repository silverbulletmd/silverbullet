import { icon } from "@silverbulletmd/silverbullet/syscalls";
import { handle as runHook } from "../registry.ts";
import { rank } from "../../../plug-api/lib/fuzzy.ts";
import {
  allNodes,
  buildTree,
  nodeObject,
} from "../../../plug-api/ui/tree_model.ts";
import type { RowState, RowStates } from "../../../plug-api/ui/tree_types.ts";
import { defaultSegmentIndex, type SegmentMasks } from "./segments.ts";
import type { DropdownMasks } from "./dropdown.ts";
import type {
  DropdownOption,
  FilterFields,
  NavigatorHook,
  Row,
  SourceCtx,
  ViewMeta,
} from "../types.ts";

export type { RowState, RowStates };

export type HookRunner = (data: {
  view: string;
  hook: NavigatorHook;
  args?: any;
}) => Promise<any>;

const DEFAULT_FILTER_FIELDS: FilterFields = {
  primary: { weight: 1.0, segments: true },
  description: 0.5,
};

type IconRef = string;

type RawRowState = {
  icon?: string;
  actions?: boolean[];
  segments?: boolean[];
};

type ParsedIcon =
  | { kind: "svg"; markup: string }
  | { kind: "feather"; name: string }
  | { kind: "unknown"; prefix: string }
  | { kind: "invalid" };

export function parseIcon(icon: unknown): ParsedIcon {
  if (typeof icon !== "string") return { kind: "invalid" };
  const trimmed = icon.replace(/^\s+/, "");
  if (trimmed.startsWith("<svg")) return { kind: "svg", markup: trimmed };
  const colon = trimmed.indexOf(":");
  if (colon === -1) return { kind: "feather", name: trimmed };
  const prefix = trimmed.slice(0, colon);
  if (prefix === "feather") {
    return { kind: "feather", name: trimmed.slice(colon + 1) };
  }
  return { kind: "unknown", prefix };
}

export type ViewState = {
  meta: ViewMeta;
  rows: Row[];
  error?: string;
  rowState?: RowStates;
  segmentMasks?: SegmentMasks;
  dropdownOptions?: DropdownOption[];
  dropdownDefault?: string;
  dropdownMasks?: DropdownMasks;
  actionIcons?: (Element | undefined)[];
  segmentIcons?: (Element | undefined)[];
  createIcon?: Element;
  ctx?: SourceCtx;
  loadToken?: number;
  builtin?: boolean;
};

export type RankedRow = { row: Row; score: number };

type IndexedRow = Record<string, any> & { __row: Row; __idx: number };

function metaChanged(a: ViewMeta, b: ViewMeta): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export class NavigatorEngine {
  /** How a view's hooks are run. A property so a test can wrap it. */
  runHook: HookRunner = runHook;

  private handle(view: string, hook: NavigatorHook, args?: any): Promise<any> {
    return this.runHook({ view, hook, args });
  }

  private cache = new Map<string, ViewState>();
  private indexCache = new WeakMap<Row[], IndexedRow[]>();
  private iconCache = new Map<string, string | undefined>();
  private nodeCache = new Map<string, Element | undefined>();
  private warnedPrefixes = new Set<string>();
  private warnedIconResolveFailure = false;
  private tokens = 0;
  activeName?: string;

  private async resolveMeta(viewName: string): Promise<ViewMeta | undefined> {
    const meta: ViewMeta | undefined = await this.handle(viewName, "meta");
    if (!meta) return undefined;
    if (!Array.isArray(meta.actions)) meta.actions = undefined;
    if (!Array.isArray(meta.keys)) meta.keys = undefined;
    if (!Array.isArray(meta.segments)) meta.segments = undefined;
    if (meta.dropdown !== undefined && typeof meta.dropdown !== "object") {
      meta.dropdown = undefined;
    }
    return meta;
  }

  async activate(viewName: string): Promise<ViewState> {
    this.activeName = viewName;
    let cached = this.cache.get(viewName);
    if (cached?.builtin) {
      if (cached.error) {
        await this.loadRows(cached, cached.ctx ?? this.initialCtx(cached.meta));
      }
      return cached;
    }
    const meta = await this.resolveMeta(viewName);
    if (!meta) {
      this.cache.delete(viewName);
      if (this.activeName === viewName) this.activeName = undefined;
      throw new Error(`No navigator view named "${viewName}"`);
    }
    if (cached && metaChanged(cached.meta, meta)) {
      this.cache.delete(viewName);
      cached = undefined;
    }
    let entry = cached;
    if (entry) {
      entry.meta = meta;
      if (entry.error) {
        await this.loadRows(entry, entry.ctx ?? this.initialCtx(meta));
      }
    } else {
      entry = { meta, rows: [], builtin: meta.builtin === true };
      this.cache.set(viewName, entry);
      await this.loadRows(entry, this.initialCtx(meta));
    }
    return entry;
  }

  // Only activation.ts's reopen-already-displayed path needs this: it's the one path that skips activate's own metaChanged check.
  async dropIfRedefined(viewName: string): Promise<boolean> {
    const entry = this.cache.get(viewName);
    if (!entry || entry.builtin) return false;
    const fresh = await this.resolveMeta(viewName);
    if (!fresh || !metaChanged(entry.meta, fresh)) return false;
    this.cache.delete(viewName);
    if (this.activeName === viewName) this.activeName = undefined;
    return true;
  }

  // An entry in an error state doesn't count: activate reloads it itself, so counting it would trigger a second load on top of one already in flight.
  isLoaded(viewName: string): boolean {
    const entry = this.cache.get(viewName);
    return !!entry && !entry.error;
  }

  dropIfEphemeral(viewName: string): void {
    const entry = this.cache.get(viewName);
    if (!entry?.meta.ephemeral) return;
    this.cache.delete(viewName);
    if (this.activeName === viewName) this.activeName = undefined;
  }

  async refresh(): Promise<void> {
    const entry = this.activeName && this.cache.get(this.activeName);
    if (!entry) return;
    await this.loadRows(entry, entry.ctx ?? this.initialCtx(entry.meta));
  }

  async query(ctx: SourceCtx): Promise<boolean> {
    const entry = this.activeName && this.cache.get(this.activeName);
    if (!entry) return false;
    return await this.loadRows(entry, ctx);
  }

  private initialCtx(meta: ViewMeta): SourceCtx {
    return {
      phrase: "",
      segment: meta.segments?.[defaultSegmentIndex(meta.segments)]?.label,
    };
  }

  activeState(): ViewState | undefined {
    return this.activeName ? this.cache.get(this.activeName) : undefined;
  }

  rankRows(rows: Row[], phrase: string, meta: ViewMeta): RankedRow[] {
    const ranked = rank(this.index(rows), phrase, {
      fields: meta.filterFields ?? DEFAULT_FILTER_FIELDS,
      orderId: (o) => o.__idx,
    });
    return ranked.map((o) => ({ row: o.__row, score: o.score }));
  }

  select(
    viewName: string,
    obj: Record<string, any>,
    from?: string,
  ): Promise<any> {
    return this.handle(viewName, "select", { obj, from });
  }

  create(viewName: string, phrase: string): Promise<any> {
    return this.handle(viewName, "create", { phrase });
  }

  key(viewName: string, key: string, obj: Record<string, any>): Promise<any> {
    return this.handle(viewName, "key", { key, obj });
  }

  move(
    viewName: string,
    obj: Record<string, any>,
    newName: string,
  ): Promise<any> {
    return this.handle(viewName, "move", { obj, newName });
  }

  action(
    viewName: string,
    index: number,
    obj: Record<string, any>,
  ): Promise<any> {
    return this.handle(viewName, "action", {
      index: index + 1,
      obj,
    });
  }

  // Applied only if it's still the newest load for this view, so a slow response can't overwrite what a newer one already put under the user's typing.
  private async loadRows(entry: ViewState, ctx: SourceCtx): Promise<boolean> {
    const token = ++this.tokens;
    entry.ctx = ctx;
    entry.loadToken = token;
    let rows: Row[] = [];
    let error: string | undefined;
    try {
      const result = await this.handle(entry.meta.name, "rows", { ctx });
      rows = Array.isArray(result) ? result : [];
      error = result?.error;
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    if (entry.loadToken !== token) return false;
    entry.error = error;
    // A failed load keeps its previous rows rather than clearing them — a phrase that breaks the source must not replace what's already on screen.
    if (error !== undefined) return true;
    for (const row of rows) {
      if (row.decorations !== undefined && !Array.isArray(row.decorations)) {
        row.decorations = undefined;
      }
    }
    await this.loadRowState(entry, rows, token);
    return entry.loadToken === token;
  }

  private async loadRowState(
    entry: ViewState,
    rows: Row[],
    token: number,
  ): Promise<void> {
    let rowState: ViewState["rowState"];
    let segmentMasks: ViewState["segmentMasks"];
    let dropdownOptions: ViewState["dropdownOptions"];
    let dropdownDefault: ViewState["dropdownDefault"];
    let dropdownMasks: ViewState["dropdownMasks"];
    const commit = () => {
      if (entry.loadToken !== token) return;
      entry.rows = rows;
      entry.rowState = rowState;
      entry.segmentMasks = segmentMasks;
      entry.dropdownOptions = dropdownOptions;
      entry.dropdownDefault = dropdownDefault;
      entry.dropdownMasks = dropdownMasks;
    };
    const meta = entry.meta;
    const needsSegments =
      meta.search !== "source" && !!meta.segments?.some((s) => s.hasWhere);
    const needsState =
      needsSegments ||
      meta.hasRowIcon ||
      !!meta.actions?.some((a) => a.hasWhen);
    const needsDropdown = !!meta.dropdown;
    const nodes =
      (needsState || needsDropdown) && meta.mode === "tree"
        ? allNodes(buildTree(rows, meta.hierarchy.separator, meta.foldersFirst))
        : undefined;
    const objs = nodes ? nodes.map(nodeObject) : rows.map((row) => row.obj);
    // Ahead of the rowState batch, so a failure there doesn't take the
    // dropdown down with it. A failure *here* leaves the options absent (the
    // select shows only "All") and a selected value with no masks fails
    // closed, like a segment whose masks never arrived.
    if (needsDropdown) {
      try {
        const result = await this.handle(meta.name, "dropdown", { objs });
        if (entry.loadToken !== token) return;
        if (result && Array.isArray(result.options)) {
          dropdownOptions = result.options;
          dropdownDefault = result.default;
          const masks: DropdownMasks = new WeakMap();
          const put = (row: Row | undefined, mask: unknown) => {
            if (row) masks.set(row, Array.isArray(mask) ? mask : []);
          };
          if (nodes) nodes.forEach((n, i) => put(n.row, result.masks?.[i]));
          else rows.forEach((row, i) => put(row, result.masks?.[i]));
          dropdownMasks = masks;
        }
      } catch (e) {
        console.error("navigator: dropdown state failed", e);
      }
    }
    let raw: RawRowState[] = [];
    if (needsState) {
      try {
        const result = await this.handle(meta.name, "rowState", { objs });
        raw = Array.isArray(result) ? result : [];
      } catch (e) {
        console.error("navigator: row state failed", e);
        commit();
        return;
      }
    }
    if (entry.loadToken !== token) return;
    await this.resolveIcons([
      ...(meta.actions ?? []).map((a) => a.icon),
      ...(meta.segments ?? []).map((s) => s.icon),
      meta.createIcon,
      ...raw.map((r) => r?.icon),
    ]);
    if (entry.loadToken !== token) return;
    entry.actionIcons = meta.actions?.map((a) => this.iconNode(a.icon));
    entry.segmentIcons = meta.segments?.map((s) => this.iconNode(s.icon));
    entry.createIcon = this.iconNode(meta.createIcon);
    if (!needsState) {
      commit();
      return;
    }
    const states: RowState[] = raw.map((r) => ({
      actions: Array.isArray(r?.actions) ? r.actions : [],
      icon: this.iconNode(r?.icon),
    }));
    rowState = nodes
      ? { byPath: new Map(nodes.map((n, i) => [n.path, states[i] ?? {}])) }
      : {
          byRow: new WeakMap(
            rows.map((row, i) => [row, states[i] ?? {}] as const),
          ),
        };
    if (needsSegments) {
      const masks: SegmentMasks = new WeakMap();
      const put = (row: Row | undefined, r: RawRowState | undefined) => {
        if (row) masks.set(row, Array.isArray(r?.segments) ? r.segments : []);
      };
      if (nodes) nodes.forEach((n, i) => put(n.row, raw[i]));
      else rows.forEach((row, i) => put(row, raw[i]));
      segmentMasks = masks;
    }
    commit();
  }

  private warnUnknownPrefix(prefix: string): void {
    if (this.warnedPrefixes.has(prefix)) return;
    this.warnedPrefixes.add(prefix);
    console.error(`navigator: unknown icon namespace "${prefix}:"`);
  }

  private iconNode(icon: IconRef | undefined): Element | undefined {
    if (!icon) return undefined;
    const parsed = parseIcon(icon);
    let svg: string | undefined;
    if (parsed.kind === "svg") {
      svg = parsed.markup;
    } else if (parsed.kind === "feather") {
      svg = this.iconCache.get(parsed.name);
    } else if (parsed.kind === "unknown") {
      this.warnUnknownPrefix(parsed.prefix);
    }
    if (!svg) return undefined;
    if (this.nodeCache.has(svg)) return this.nodeCache.get(svg);
    // <template> parses its content inert (no resource loads, nothing scheduled) — the same lenient HTML path innerHTML took, without the side effects.
    const template = document.createElement("template");
    template.innerHTML = svg;
    const node = template.content.firstElementChild ?? undefined;
    this.nodeCache.set(svg, node);
    return node;
  }

  private async resolveIcons(icons: (IconRef | undefined)[]): Promise<void> {
    const missing = [
      ...new Set(
        icons
          .filter((icon): icon is string => !!icon)
          .map((icon) => parseIcon(icon))
          .filter(
            (p): p is { kind: "feather"; name: string } => p.kind === "feather",
          )
          .map((p) => p.name)
          .filter((name) => !this.iconCache.has(name)),
      ),
    ];
    if (missing.length === 0) return;
    if (this.warnedIconResolveFailure) {
      for (const name of missing) this.iconCache.set(name, undefined);
      return;
    }
    try {
      const resolved = await icon.resolveFeather(missing);
      for (const name of missing) this.iconCache.set(name, resolved?.[name]);
    } catch (e) {
      for (const name of missing) this.iconCache.set(name, undefined);
      if (!this.warnedIconResolveFailure) {
        this.warnedIconResolveFailure = true;
        console.warn(
          "navigator: icon resolution failed, rendering without icons",
          e,
        );
      }
    }
  }

  private index(rows: Row[]): IndexedRow[] {
    let indexed = this.indexCache.get(rows);
    if (!indexed) {
      indexed = rows.map((row, i) => ({
        ...row.obj,
        primary: row.primary,
        description: row.description,
        __row: row,
        __idx: i,
      }));
      this.indexCache.set(rows, indexed);
    }
    return indexed;
  }
}

// One engine per slot, outliving the panel it belongs to: a dock the user
// closes and reopens comes back on its cached rows, and two slots showing the
// same view keep their own row state (which is what a modal picker over an
// already-docked view expects).
const engines = new Map<string, NavigatorEngine>();

// Reachable from the page for the e2e suite, which instruments a slot's
// engine to count how often its source actually runs.
(globalThis as any).__navigatorEngines = engines;

export function engineFor(slot: string): NavigatorEngine {
  let engine = engines.get(slot);
  if (!engine) {
    engine = new NavigatorEngine();
    engines.set(slot, engine);
  }
  return engine;
}
