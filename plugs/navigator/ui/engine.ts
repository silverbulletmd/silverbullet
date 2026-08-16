import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { rank } from "../../../plug-api/lib/fuzzy.ts";
import {
  allNodes,
  buildTree,
  nodeObject,
} from "../../../plug-api/ui/tree_model.ts";
import type { RowState, RowStates } from "../../../plug-api/ui/tree_types.ts";
import { defaultSegmentIndex, type SegmentMasks } from "./segments.ts";
import type {
  FilterFields,
  NavigatorHook,
  Row,
  SourceCtx,
  ViewMeta,
} from "./types.ts";

// Re-exported so the rest of the plug can keep importing these from
// "./engine.ts" -- the shapes themselves live in the shared UI library
// because `TreeView` needs them too.
export type { RowState, RowStates };

export async function dispatch(name: string, data: any): Promise<any> {
  const responses = await syscall("event.dispatch", name, data);
  return responses?.[0];
}

/**
 * The one bridge call for every view, built-in or Lua-owned alike -- the
 * plug's own registry (`registry.ts`) decides which and routes accordingly,
 * so the panel never needs to know.
 */
function handle(view: string, hook: NavigatorHook, args?: any): Promise<any> {
  return syscall("system.invokeFunction", "navigator.handle", {
    view,
    hook,
    args,
  });
}

// Rows always carry `primary`, so it beats the fuzzy defaults (which key off
// `name`) for views that render a computed primary label.
const DEFAULT_FILTER_FIELDS: FilterFields = {
  primary: { weight: 1.0, segments: true },
  description: 0.5,
};

/**
 * An icon as Lua (or the built-in registry) hands it over: a bare Feather
 * name (`"lock"`), a namespaced one (`"feather:lock"`), or literal SVG markup
 * (a string starting with `<svg` after trimming leading whitespace). Which of
 * the three a given value is gets sniffed by `parseIcon`, not here.
 */
type IconRef = string;

/** One `"rowState"` hook entry, exactly as the registry returns it. */
type RawRowState = {
  icon?: string;
  actions?: boolean[];
  segments?: boolean[];
};

type ParsedIcon =
  | { kind: "svg"; markup: string }
  | { kind: "feather"; name: string }
  | { kind: "unknown"; prefix: string }
  /**
   * Not a string at all -- e.g. a table that should have been
   * caught at definition time (`validateRowIcon` in the library page)
   * but reached here anyway, from a `row.icon` function
   * whose *return value* can't be checked until it runs. Resolves nothing,
   * same as "unknown", but isn't a namespace typo worth warning about.
   */
  | { kind: "invalid" };

/**
 * Sniffs which of the three `icon` forms a value is. Pure -- callers decide
 * what an "unknown" namespace (or an "invalid", non-string value) means (see
 * `NavigatorEngine.iconNode`, which warns once per prefix and never for
 * "invalid"). A namespace is a second icon set (`icon.lucide`, say) slotting
 * in as another `kind`, not a rewrite of this function's shape.
 */
export function parseIcon(icon: unknown): ParsedIcon {
  if (typeof icon !== "string") return { kind: "invalid" };
  // Trimmed once, up front -- both the "<svg" sniff and the namespace colon
  // scan read the same trimmed string, so leading whitespace can't make one
  // see a form the other doesn't.
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
  /** Undefined when the view needs no per-row state (the common case). */
  rowState?: RowStates;
  /** Per-row `where` results; undefined when no segment defines one. */
  segmentMasks?: SegmentMasks;
  /** Resolved icon node per action, parallel to `meta.actions`. */
  actionIcons?: (Element | undefined)[];
  /** Resolved icon node per segment, parallel to `meta.segments`. */
  segmentIcons?: (Element | undefined)[];
  /** Resolved icon node for the create row, if the view names one. */
  createIcon?: Element;
  /** What the source was last invoked with -- reused by `refresh`. */
  ctx?: SourceCtx;
  /** Identifies the newest row load for this view; older ones are dropped. */
  loadToken?: number;
  builtin?: boolean;
};

export type RankedRow = { row: Row; score: number };

type IndexedRow = Record<string, any> & { __row: Row; __idx: number };

/**
 * Whether a Lua-owned view's meta actually changed -- key-order-sensitive
 * (two serializations of an identical Lua table could in principle differ),
 * which only costs one avoidable reload on a false positive, never a missed
 * redefinition.
 */
function metaChanged(a: ViewMeta, b: ViewMeta): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export class NavigatorEngine {
  private cache = new Map<string, ViewState>();
  private indexCache = new WeakMap<Row[], IndexedRow[]>();
  // Feather name -> SVG markup, for the lifetime of this iframe. The icon set
  // lives in the client (see `icon.resolveFeather`) so the panel bundle
  // doesn't have to carry ~290 icons to draw two.
  private iconCache = new Map<string, string | undefined>();
  // Markup -> the parsed node rows clone. Parsing is the expensive half of
  // drawing an icon, and a list of 200 rows draws the same handful of icons
  // over and over.
  private nodeCache = new Map<string, Element | undefined>();
  // Unknown icon namespaces already warned about, so a bad prefix logs once
  // for this engine's whole lifetime (one panel iframe) rather than once per
  // row that carries it.
  private warnedPrefixes = new Set<string>();
  // Set once `icon.resolveFeather` has failed, so a client whose host is one
  // version behind (the syscall doesn't exist yet there -- see the catch
  // below) warns once for this engine's whole lifetime rather than once per
  // refresh for as long as the session lasts.
  private warnedIconResolveFailure = false;
  private tokens = 0;
  activeName?: string;

  /**
   * A view's meta, freshly resolved and normalized. `undefined` for an
   * unknown name -- a Lua view a space has stopped defining (or hasn't
   * defined yet), or a plain typo.
   */
  private async resolveMeta(viewName: string): Promise<ViewMeta | undefined> {
    const meta: ViewMeta | undefined = await handle(viewName, "meta");
    if (!meta) return undefined;
    // An empty Lua table (`actions = {}`, `keymap = {}`, `segments = {}`)
    // crosses as `{}`, not `[]`; normalizing here keeps every `.some`/
    // `.includes` below (and in the components) from throwing on it.
    if (!Array.isArray(meta.actions)) meta.actions = undefined;
    if (!Array.isArray(meta.keys)) meta.keys = undefined;
    if (!Array.isArray(meta.segments)) meta.segments = undefined;
    return meta;
  }

  /**
   * Built-in meta is a static map lookup -- resolved once and cached for the
   * rest of the session. A Lua-owned view's meta can change on the space's
   * own terms (a redefinition, upserted at `navigator.define` time), so it is
   * re-resolved on every activation instead -- one cheap round trip, same as
   * every other bridge call this makes. A redefinition that actually changed
   * anything drops the cached entry and falls through to a full fresh load
   * (new rows and ctx, not just new chrome over old ones) -- the same check
   * `dropIfRedefined` makes for the one path that bypasses this method
   * entirely (see there).
   */
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

  /**
   * Drops a cached, Lua-owned view's entry if its meta no longer matches
   * what the registry currently answers -- a space-lua redefinition since it
   * was last resolved -- so the next `activate` reloads it fresh. Only
   * `activation.ts`'s "reopening the view already displayed" path needs
   * this: that one short-circuits `activate` entirely for a cache hit, so
   * it's the one case `activate`'s own `metaChanged` check (above) never
   * runs for. A no-op for a built-in (whose meta never changes) or an
   * unresolved name.
   *
   * @returns whether the entry was dropped.
   */
  async dropIfRedefined(viewName: string): Promise<boolean> {
    const entry = this.cache.get(viewName);
    if (!entry || entry.builtin) return false;
    const fresh = await this.resolveMeta(viewName);
    if (!fresh || !metaChanged(entry.meta, fresh)) return false;
    this.cache.delete(viewName);
    if (this.activeName === viewName) this.activeName = undefined;
    return true;
  }

  /**
   * Whether this view's rows are already held, i.e. whether `activate` will
   * hand them back rather than load any. What `refreshOnOpen` turns on.
   *
   * An entry in an error state does not count: `activate` re-loads that one
   * itself, and treating it as held would have the caller ask for a second
   * load on top of the one already in flight.
   */
  isLoaded(viewName: string): boolean {
    const entry = this.cache.get(viewName);
    return !!entry && !entry.error;
  }

  /**
   * Drops a cached ephemeral (`navigator.pick`) view's entry once it stops
   * being the active one for its slot -- called both when a genuine close
   * leaves nothing displayed (`use_panel_events.ts`'s `onHidden`) and when a
   * newer activation takes the slot without one (`activation.ts`). A no-op
   * for every ordinary view, whose `ViewState` is meant to outlive the
   * session.
   */
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

  /**
   * Re-invokes the active view's source for a new phrase/segment -- source
   * search mode only. Resolves to whether this request is still the newest
   * one, i.e. whether its rows were applied.
   */
  async query(ctx: SourceCtx): Promise<boolean> {
    const entry = this.activeName && this.cache.get(this.activeName);
    if (!entry) return false;
    return await this.loadRows(entry, ctx);
  }

  /** What the source is handed on the very first load, before any input. */
  private initialCtx(meta: ViewMeta): SourceCtx {
    return {
      phrase: "",
      segment: meta.segments?.[defaultSegmentIndex(meta.segments)]?.label,
    };
  }

  activeRows(): Row[] {
    const entry = this.activeName && this.cache.get(this.activeName);
    return entry ? entry.rows : [];
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

  /**
   * @param from the view a `prefixViews` hop came from, if any -- an
   * `onSelect` that wants to hand the slot back needs to know where to.
   * @returns whatever `onSelect` returned; `false` keeps the panel open.
   */
  select(
    viewName: string,
    obj: Record<string, any>,
    from?: string,
  ): Promise<any> {
    return handle(viewName, "select", { obj, from });
  }

  create(viewName: string, phrase: string): Promise<any> {
    return handle(viewName, "create", { phrase });
  }

  key(viewName: string, key: string, obj: Record<string, any>): Promise<any> {
    return handle(viewName, "key", { key, obj });
  }

  move(
    viewName: string,
    obj: Record<string, any>,
    newName: string,
  ): Promise<any> {
    return handle(viewName, "move", { obj, newName });
  }

  action(
    viewName: string,
    index: number,
    obj: Record<string, any>,
  ): Promise<any> {
    return handle(viewName, "action", {
      // Lua's `actions` table is 1-based; `index` is the JS array index.
      index: index + 1,
      obj,
    });
  }

  /**
   * One source invocation, applied only if it is still the newest one for this
   * view. Same monotonic-freshness rule activation tokens follow: in source
   * search mode a slow response can be overtaken by a newer phrase, and
   * applying it afterwards would put the wrong rows under the user's typing.
   */
  private async loadRows(entry: ViewState, ctx: SourceCtx): Promise<boolean> {
    const token = ++this.tokens;
    entry.ctx = ctx;
    entry.loadToken = token;
    let rows: Row[] = [];
    let error: string | undefined;
    try {
      const result = await handle(entry.meta.name, "rows", { ctx });
      rows = Array.isArray(result) ? result : [];
      error = result?.error;
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    if (entry.loadToken !== token) return false;
    entry.error = error;
    // A failed load keeps the rows (and the state batched for them) it had:
    // in source mode the source runs per keystroke, and a phrase that happens
    // to break it must not take the results the user is reading off the
    // screen. The panel shows the error alongside them (and on its own only
    // when there is nothing left to show).
    if (error !== undefined) return true;
    // The same empty-table rule the meta fields get (see `activate`), per row:
    // a `decorations` function returning `{}` for an undecorated row -- which
    // the documented pattern does -- crosses as an object, and both row
    // renderers draw chips off an array. Normalized here rather than at each
    // render site, so every consumer of a row sees one shape.
    for (const row of rows) {
      if (row.decorations !== undefined && !Array.isArray(row.decorations)) {
        row.decorations = undefined;
      }
    }
    entry.rows = rows;
    await this.loadRowState(entry, token);
    return entry.loadToken === token;
  }

  /**
   * Everything Lua has to say per rendered thing -- `when` results and row
   * icons -- in one round trip pinned to the rows load above, plus one icon
   * resolution syscall. Doing it here rather than on hover or on selection
   * change is what keeps hovering a row free of syscalls, and it covers tree
   * folders, which have no row of their own to carry either.
   */
  private async loadRowState(entry: ViewState, token: number): Promise<void> {
    entry.rowState = undefined;
    entry.segmentMasks = undefined;
    const meta = entry.meta;
    // A source-mode view subsets in its own source, off the segment label it is
    // handed -- its `where` predicates, if it has any, are never consulted.
    const needsSegments =
      meta.search !== "source" && !!meta.segments?.some((s) => s.hasWhere);
    const needsState =
      needsSegments ||
      meta.hasRowIcon ||
      !!meta.actions?.some((a) => a.hasWhen);
    // Tree nodes rather than rows: a folder's object is synthesized here (see
    // `nodeObject`), and a page that is also a folder must be evaluated as the
    // folder it heads.
    const nodes =
      needsState && meta.mode === "tree"
        ? allNodes(
            buildTree(entry.rows, meta.hierarchy.separator, meta.foldersFirst),
          )
        : undefined;
    let raw: RawRowState[] = [];
    if (needsState) {
      const objs = nodes
        ? nodes.map(nodeObject)
        : entry.rows.map((row) => row.obj);
      try {
        const result = await handle(meta.name, "rowState", { objs });
        raw = Array.isArray(result) ? result : [];
      } catch (e) {
        // Leaves every `when` action hidden (and every `where` segment empty),
        // which is the safe way to be wrong: better a missing button than one
        // that turns out not to apply.
        console.error("navigator: row state failed", e);
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
    if (!needsState) return;
    const states: RowState[] = raw.map((r) => ({
      actions: Array.isArray(r?.actions) ? r.actions : [],
      icon: this.iconNode(r?.icon),
    }));
    entry.rowState = nodes
      ? { byPath: new Map(nodes.map((n, i) => [n.path, states[i] ?? {}])) }
      : {
          byRow: new WeakMap(
            entry.rows.map((row, i) => [row, states[i] ?? {}] as const),
          ),
        };
    if (!needsSegments) return;
    // Masks are per row even in tree mode: segmenting subsets the rows and
    // rebuilds the tree from them, so ancestors come back on their own.
    const masks: SegmentMasks = new WeakMap();
    const put = (row: Row | undefined, r: RawRowState | undefined) => {
      if (row) masks.set(row, Array.isArray(r?.segments) ? r.segments : []);
    };
    if (nodes) nodes.forEach((n, i) => put(n.row, raw[i]));
    else entry.rows.forEach((row, i) => put(row, raw[i]));
    entry.segmentMasks = masks;
  }

  /** Warns once per unrecognized namespace prefix, not once per row. */
  private warnUnknownPrefix(prefix: string): void {
    if (this.warnedPrefixes.has(prefix)) return;
    this.warnedPrefixes.add(prefix);
    console.error(`navigator: unknown icon namespace "${prefix}:"`);
  }

  /**
   * The node an icon draws as, cloned per row from a single parse. Literal
   * markup wins on its own (nothing to resolve); an unresolvable or
   * unrecognized name draws nothing.
   */
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
    // "invalid" falls through with `svg` unset -- a definition-time check
    // (`validateRowIcon` et al.) should already have caught this on the Lua
    // side, so it isn't a namespace typo worth a console warning too.
    if (!svg) return undefined;
    if (this.nodeCache.has(svg)) return this.nodeCache.get(svg);
    // A template parses its content inert -- no resource loads, nothing
    // scheduled -- and takes the same lenient HTML path `innerHTML` did.
    const template = document.createElement("template");
    template.innerHTML = svg;
    const node = template.content.firstElementChild ?? undefined;
    this.nodeCache.set(svg, node);
    return node;
  }

  /** One syscall for every Feather name this batch needs and hasn't cached. */
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
    // Already failed once this session (the syscall itself is missing on a
    // stale host, not going to appear mid-session) -- cache these as
    // unresolved directly rather than round-tripping again for a batch
    // that's just going to reject the same way.
    if (this.warnedIconResolveFailure) {
      for (const name of missing) this.iconCache.set(name, undefined);
      return;
    }
    try {
      const resolved: Record<string, string> = await syscall(
        "icon.resolveFeather",
        missing,
      );
      // Unknown names cache as undefined too -- they'd never resolve, and
      // asking again every refresh would be a syscall per load forever.
      for (const name of missing) this.iconCache.set(name, resolved?.[name]);
    } catch (e) {
      // Never fatal: every caller already treats "no icon cached" as "draw
      // nothing" (see `iconNode`), so segments and rows still render fully,
      // just without icons -- the real case this guards is a client one
      // version behind a host that hasn't registered this syscall yet (an
      // `Unregistered syscall` rejection). Cache the whole batch unresolved
      // too, so a *future* batch of different names doesn't retry a syscall
      // this session already knows is gone.
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
