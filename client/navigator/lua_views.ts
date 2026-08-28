import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import { isTaggedFloat } from "../space_lua/numeric.ts";
import {
  type ILuaFunction,
  type LuaEnv,
  LuaStackFrame,
  LuaTable,
  luaTypeOf,
  luaValueToJS,
} from "../space_lua/runtime.ts";
import {
  type ActionMeta,
  ALL_DOCKS,
  type DropdownMeta,
  type DropdownOption,
  type NavigatorHook,
  type SegmentMeta,
  type ViewMeta,
} from "./types.ts";

export const RESERVED_PICK_PREFIX = "__pick:";

export const RESERVED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Escape",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Tab",
]);

/** A `view.define`/`view.pick` spec: the raw Lua table the user
 * wrote, or the plain object `view.pick` assembles from one. */
export type ViewSpec = LuaTable | Record<string, any>;

function luaType(value: unknown): string {
  return luaTypeOf(value) as string;
}

function field(spec: unknown, key: string): any {
  if (spec instanceof LuaTable) return spec.rawGet(key);
  if (spec && typeof spec === "object") return (spec as any)[key];
  return undefined;
}

/** `spec.x or {}`: only nil and false fall through. */
function or<T>(value: T, fallback: T): T {
  return value === undefined || value === null || (value as unknown) === false
    ? fallback
    : value;
}

function truthy(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

/** Lua's `~= nil`: present-but-false still counts as present. */
function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function toJS(value: unknown): any {
  return luaValueToJS(value, LuaStackFrame.lostFrame);
}

function numberOf(value: unknown): number {
  return isTaggedFloat(value) ? value.value : (value as number);
}

/** `ipairs`: the array part up to its first hole. */
function sequence(value: unknown): any[] {
  const out: any[] = [];
  if (value instanceof LuaTable) {
    for (let i = 1; ; i++) {
      const entry = value.rawGet(i);
      if (entry === undefined || entry === null) break;
      out.push(entry);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry === undefined || entry === null) break;
      out.push(entry);
    }
  }
  return out;
}

function keysOf(value: unknown): any[] {
  if (value instanceof LuaTable) return value.keys();
  if (value && typeof value === "object") return Object.keys(value);
  return [];
}

function charCount(value: string): number {
  return [...value].length;
}

function validatePrefix(
  char: unknown,
  what: string,
  claimed: Map<string, string>,
) {
  if (luaType(char) !== "string") {
    throw new Error(`view.define: ${what} must be a string`);
  }
  const text = char as string;
  if (charCount(text) !== 1) {
    throw new Error(`view.define: ${what} must be exactly one character`);
  }
  const code = text.codePointAt(0) ?? 0;
  if (/\s/.test(text) || code < 0x20 || code === 0x7f) {
    throw new Error(`view.define: ${what} must be a printable character`);
  }
  const owner = claimed.get(text);
  if (owner) {
    throw new Error(
      `view.define: prefix '${text}' is claimed twice (${owner} and ${what})`,
    );
  }
  claimed.set(text, what);
}

function prefixViewsMeta(spec: ViewSpec): Record<string, string> | undefined {
  const prefixViews = field(spec, "prefixViews");
  if (prefixViews === undefined || prefixViews === null) return undefined;
  if (luaType(prefixViews) !== "table") {
    throw new Error("view.define: prefixViews must be a table");
  }
  const out: Record<string, string> = {};
  let any = false;
  for (const char of keysOf(prefixViews)) {
    const name = field(prefixViews, char);
    if (luaType(name) !== "string" || name === "") {
      throw new Error(
        `view.define: prefixViews['${String(char)}'] must be a view name`,
      );
    }
    out[char] = name;
    any = true;
  }
  if (!any) return undefined;
  return out;
}

function validatePrefixes(spec: ViewSpec) {
  const claimed = new Map<string, string>();
  const segments = sequence(field(spec, "segments"));
  for (let i = 0; i < segments.length; i++) {
    const prefix = field(segments[i], "prefix");
    if (prefix !== undefined && prefix !== null) {
      validatePrefix(prefix, `segments[${i + 1}].prefix`, claimed);
    }
  }
  const prefixViews = field(spec, "prefixViews");
  for (const char of keysOf(prefixViews)) {
    validatePrefix(char, `prefixViews['${String(char)}']`, claimed);
  }
  for (const key of keysOf(field(spec, "keymap"))) {
    const owner = claimed.get(key);
    if (owner) {
      throw new Error(
        `view.define: '${key}' is both a keymap key and ${owner}`,
      );
    }
  }
}

function keymapKeys(spec: ViewSpec): string[] | undefined {
  const keymap = field(spec, "keymap");
  if (!truthy(keymap)) return undefined;
  const keys: string[] = [];
  for (const key of keysOf(keymap)) {
    if (RESERVED_KEYS.has(key)) {
      throw new Error(
        `view.define: key '${key}' is reserved by built-in navigation`,
      );
    }
    if (luaType(field(keymap, key)) !== "function") {
      throw new Error(`view.define: keymap['${key}'] must be a function`);
    }
    keys.push(key);
  }
  // An empty table crosses to the panel as an object, not an array, and `.includes`/`.some` on the other side would throw on it.
  if (keys.length === 0) return undefined;
  return keys;
}

function validateIcon(icon: unknown, what: string) {
  if (icon === undefined || icon === null) return;
  if (luaType(icon) === "string") return;
  throw new Error(
    `view.define: ${what} must be an icon name ("lock"), ` +
      'a namespaced name ("feather:lock"), or literal SVG markup ' +
      '(a string starting with "<svg")',
  );
}

// The string contract for a function's return is enforced at runtime by the "rowState" hook below, not here -- what it returns isn't known until it runs.
function validateRowIcon(icon: unknown, what: string) {
  if (icon === undefined || icon === null) return;
  const type = luaType(icon);
  if (type === "string" || type === "function") return;
  throw new Error(
    `view.define: ${what} must be an icon name ("lock"), ` +
      'a namespaced name ("feather:lock"), literal SVG markup ' +
      '(a string starting with "<svg"), or a function returning one',
  );
}

function actionMeta(spec: ViewSpec): ActionMeta[] | undefined {
  const actions = field(spec, "actions");
  if (!truthy(actions)) return undefined;
  const out: ActionMeta[] = [];
  const entries = sequence(actions);
  for (let i = 0; i < entries.length; i++) {
    const action = entries[i];
    const label = field(action, "label");
    const what = `actions[${i + 1}]`;
    if (luaType(label) !== "string" || label === "") {
      throw new Error(`view.define: ${what} requires a label`);
    }
    if (luaType(field(action, "run")) !== "function") {
      throw new Error(`view.define: ${what}.run must be a function`);
    }
    const when = field(action, "when");
    if (when !== undefined && when !== null && luaType(when) !== "function") {
      throw new Error(`view.define: ${what}.when must be a function`);
    }
    const requireMode = field(action, "requireMode");
    if (
      requireMode !== undefined &&
      requireMode !== null &&
      requireMode !== "rw"
    ) {
      throw new Error(`view.define: ${what}.requireMode must be "rw"`);
    }
    validateIcon(field(action, "icon"), `${what}.icon`);
    out.push({
      icon: toJS(field(action, "icon")),
      label,
      hasWhen: when !== undefined && when !== null,
      requireMode: toJS(requireMode),
    });
  }
  if (out.length === 0) return undefined;
  return out;
}

function segmentMeta(spec: ViewSpec): SegmentMeta[] | undefined {
  const segments = field(spec, "segments");
  if (!truthy(segments)) return undefined;
  const out: SegmentMeta[] = [];
  const seen = new Set<string>();
  const entries = sequence(segments);
  for (let i = 0; i < entries.length; i++) {
    const segment = entries[i];
    const what = `segments[${i + 1}]`;
    const label = field(segment, "label");
    if (luaType(label) !== "string" || label === "") {
      throw new Error(`view.define: ${what} requires a label`);
    }
    if (seen.has(label)) {
      throw new Error(`view.define: duplicate segment label '${label}'`);
    }
    seen.add(label);
    const where = field(segment, "where");
    if (
      where !== undefined &&
      where !== null &&
      luaType(where) !== "function"
    ) {
      throw new Error(`view.define: ${what}.where must be a function`);
    }
    validateIcon(field(segment, "icon"), `${what}.icon`);
    out.push({
      label,
      icon: toJS(field(segment, "icon")),
      hasWhere: where !== undefined && where !== null,
      default: field(segment, "default") === true,
      prefix: toJS(field(segment, "prefix")),
      placeholder: toJS(field(segment, "placeholder")),
    });
  }
  if (out.length === 0) return undefined;
  return out;
}

function dropdownMeta(spec: ViewSpec): DropdownMeta | undefined {
  const dropdown = field(spec, "dropdown");
  if (!truthy(dropdown)) return undefined;
  if (luaType(dropdown) !== "table") {
    throw new Error("view.define: dropdown must be a table");
  }
  const options = luaType(field(dropdown, "options"));
  if (options !== "function" && options !== "table") {
    throw new Error("view.define: dropdown.options must be a function or list");
  }
  const key = field(dropdown, "key");
  if (present(key) && luaType(key) !== "function") {
    throw new Error("view.define: dropdown.key must be a function");
  }
  // `key` is the cheap form of `where`: one call per row instead of one per
  // row per option. Either answers the same question, so a view needs one.
  if (!present(key) && luaType(field(dropdown, "where")) !== "function") {
    throw new Error("view.define: dropdown.where must be a function");
  }
  const placeholder = field(dropdown, "placeholder");
  if (present(placeholder) && luaType(placeholder) !== "string") {
    throw new Error("view.define: dropdown.placeholder must be a string");
  }
  const allLabel = field(dropdown, "allLabel");
  if (present(allLabel) && luaType(allLabel) !== "string") {
    throw new Error("view.define: dropdown.allLabel must be a string");
  }
  const defaultValue = field(dropdown, "default");
  if (
    present(defaultValue) &&
    luaType(defaultValue) !== "string" &&
    luaType(defaultValue) !== "function"
  ) {
    throw new Error(
      "view.define: dropdown.default must be a string or a function",
    );
  }
  return { placeholder: toJS(placeholder), allLabel: toJS(allLabel) };
}

function renderLimit(spec: ViewSpec): number {
  const limit = field(or(field(spec, "presentation"), {}), "limit");
  if (limit === undefined || limit === null) return 200;
  const value = numberOf(limit);
  if (luaType(limit) !== "number" || value < 1 || !Number.isInteger(value)) {
    throw new Error(
      "view.define: presentation.limit must be a positive integer",
    );
  }
  return value;
}

function expandAll(spec: ViewSpec): boolean {
  const p = or(field(spec, "presentation"), {});
  const value = field(p, "expandAll");
  if (value === undefined || value === null) return false;
  if (luaType(value) !== "boolean") {
    throw new Error("view.define: presentation.expandAll must be a boolean");
  }
  if (value && or(field(p, "mode"), "list") !== "tree") {
    throw new Error('view.define: presentation.expandAll requires mode "tree"');
  }
  return value;
}

function expansionScope(spec: ViewSpec): "view" | "page" {
  const p = or(field(spec, "presentation"), {});
  const scope = field(p, "expansionScope");
  if (scope === undefined || scope === null) return "view";
  if (scope !== "view" && scope !== "page") {
    throw new Error(
      'view.define: presentation.expansionScope must be "view" or "page"',
    );
  }
  if (scope === "page" && or(field(p, "mode"), "list") !== "tree") {
    throw new Error(
      'view.define: presentation.expansionScope requires mode "tree"',
    );
  }
  return scope;
}

function searchMode(spec: ViewSpec): "client" | "source" {
  const mode = field(spec, "search");
  if (mode === undefined || mode === null) return "client";
  if (mode !== "client" && mode !== "source") {
    throw new Error('view.define: search must be "client" or "source"');
  }
  return mode;
}

function contentFn(spec: ViewSpec, caller: string): unknown {
  const content = field(spec, "content");
  if (content === undefined || content === null) return undefined;
  if (luaType(content) !== "function") {
    throw new Error(
      `${caller}: content must be a function returning a markdown string`,
    );
  }
  if (truthy(field(spec, "source"))) {
    throw new Error(
      `${caller}: content and source are mutually exclusive -- a view either ` +
        "renders markdown (content) or lists rows (source)",
    );
  }
  return content;
}

export function contentMarkdown(value: unknown): string {
  if (value === undefined || value === null || value === false) return "";
  if (typeof value === "string") return value;
  if (luaType(value) === "table") {
    const markdown = field(value, "markdown");
    if (typeof markdown === "string") return markdown;
    if (markdown === undefined || markdown === null) return "";
  }
  throw new Error(
    `navigator: content must return a markdown string, got ${luaType(value)}`,
  );
}

function dockSlot(spec: ViewSpec): string {
  const dock = field(spec, "dock");
  if (dock === undefined || dock === null) return "modal";
  if (!(ALL_DOCKS as readonly string[]).includes(dock)) {
    throw new Error(`view.define: dock must be one of ${ALL_DOCKS.join(", ")}`);
  }
  return dock;
}

function supportedDocks(spec: ViewSpec): string[] {
  const dock = dockSlot(spec);
  const listed = field(spec, "supportedDocks");
  if (listed === undefined || listed === null) return [dock];
  const docks = sequence(listed).map((entry) => toJS(entry));
  for (const entry of docks) {
    if (!(ALL_DOCKS as readonly string[]).includes(entry)) {
      throw new Error(
        `view.define: supportedDocks entry '${entry}' must be one of ${ALL_DOCKS.join(", ")}`,
      );
    }
  }
  if (!docks.includes(dock)) {
    throw new Error(
      `view.define: supportedDocks must include the default dock '${dock}'`,
    );
  }
  return docks;
}

function defaultOpen(spec: ViewSpec): boolean {
  const value = field(spec, "defaultOpen");
  if (value === undefined || value === null) return false;
  if (luaType(value) !== "boolean") {
    throw new Error("view.define: defaultOpen must be a boolean");
  }
  return value;
}

function presentationMode(spec: ViewSpec): "list" | "tree" {
  const mode = field(or(field(spec, "presentation"), {}), "mode");
  if (mode === undefined || mode === null) return "list";
  if (mode !== "list" && mode !== "tree") {
    throw new Error('view.define: presentation.mode must be "list" or "tree"');
  }
  return mode;
}

function hierarchy(spec: ViewSpec): { field: string; separator: string } {
  const h = field(or(field(spec, "presentation"), {}), "hierarchy");
  if (h === undefined || h === null) return { field: "name", separator: "/" };
  if (
    luaType(h) !== "table" ||
    luaType(field(h, "field")) !== "string" ||
    luaType(field(h, "separator")) !== "string"
  ) {
    throw new Error(
      "view.define: presentation.hierarchy must be " +
        "{ field = <string>, separator = <string> }",
    );
  }
  return toJS(h);
}

// `{}` is a plausible spelling of "no refresh, thanks" and has to become `nil` to mean it: see keymapKeys.
function refreshOnEvents(spec: ViewSpec): string[] | undefined {
  const refreshOn = field(spec, "refreshOn");
  if (refreshOn === undefined || refreshOn === null) return undefined;
  if (luaType(refreshOn) !== "table") {
    throw new Error("view.define: refreshOn must be a list of event names");
  }
  if (sequence(refreshOn).length === 0) return undefined;
  return toJS(refreshOn);
}

/** `filter = false` turns the phrase filter off entirely; a table configures
 * it; anything else is a spelling mistake worth rejecting. */
function noFilter(spec: ViewSpec): boolean {
  const filter = field(spec, "filter");
  if (filter === undefined || filter === null) return false;
  if (filter === false) return true;
  if (luaType(filter) !== "table") {
    throw new Error("view.define: filter must be a table or false");
  }
  return false;
}

// An empty map is *not* the same as none: the panel would rank every row against zero fields, score them all 0, and empty the list on the first keystroke.
function filterFields(spec: ViewSpec): Record<string, any> | undefined {
  const filter = field(spec, "filter");
  const fields = truthy(filter) ? field(filter, "fields") : undefined;
  if (fields === undefined || fields === null) return undefined;
  if (luaType(fields) !== "table") {
    throw new Error("view.define: filter.fields must be a table");
  }
  if (keysOf(fields).length === 0) return undefined;
  return toJS(fields);
}

export function wireMeta(spec: ViewSpec): ViewMeta {
  const p = or(field(spec, "presentation"), {});
  const f = or(field(spec, "filter"), {});
  const name = field(spec, "name");
  const title = field(spec, "title");
  const hasContent = present(field(spec, "content"));
  return {
    name,
    title: truthy(title) ? title : name,
    label: toJS(field(spec, "label")),
    placeholder: toJS(field(spec, "placeholder")),
    stripPrefix: toJS(field(f, "stripPrefix")),
    createIcon: toJS(field(p, "createIcon")),
    mode: presentationMode(spec),
    hasContent,
    dock: dockSlot(spec),
    supportedDocks: supportedDocks(spec),
    hierarchy: hierarchy(spec),
    foldersFirst: field(p, "foldersFirst") !== false,
    expandAll: expandAll(spec),
    expansionScope: expansionScope(spec),
    filterFields: filterFields(spec),
    // A content view has no rows to narrow, so the panel shows it no filter
    // input at all -- the box stays as the panel's focus home (see `noFilter`
    // in `ViewMeta`), which is what keeps Escape and the dock menu working.
    noFilter: hasContent || noFilter(spec),
    followEditor: field(spec, "followEditor") === true,
    refreshOn: refreshOnEvents(spec),
    hasMove: present(field(spec, "onMove")),
    hasCreate: present(field(spec, "onCreate")),
    refreshOnOpen: field(spec, "refreshOnOpen") === true,
    keys: keymapKeys(spec),
    actions: actionMeta(spec),
    segments: segmentMeta(spec),
    dropdown: dropdownMeta(spec),
    limit: renderLimit(spec),
    search: searchMode(spec),
    hasRowIcon: present(field(or(field(p, "row"), {}), "icon")),
    prefixViews: prefixViewsMeta(spec),
    pathCompletion: field(f, "pathCompletion") === true,
    hashtagFilter: field(f, "hashtagFilter") === true,
    ephemeral: field(spec, "ephemeral") === true,
    openOnStart: field(spec, "openOnStart") === true,
    defaultOpen: defaultOpen(spec),
  } as ViewMeta;
}

/** Validation only -- `wireMeta` is what callers project with once this returns without throwing. */
export function validateViewSpec(spec: ViewSpec, caller: string) {
  if (!truthy(field(spec, "name"))) {
    throw new Error(`${caller}: name is required`);
  }
  const content = contentFn(spec, caller);
  if (!content && !truthy(field(spec, "source"))) {
    throw new Error(`${caller}: source is required`);
  }
  const p = or(field(spec, "presentation"), {});
  validateIcon(field(p, "createIcon"), "presentation.createIcon");
  validateRowIcon(
    field(or(field(p, "row"), {}), "icon"),
    "presentation.row.icon",
  );
  keymapKeys(spec);
  actionMeta(spec);
  segmentMeta(spec);
  dropdownMeta(spec);
  prefixViewsMeta(spec);
  validatePrefixes(spec);
  renderLimit(spec);
  searchMode(spec);
  dockSlot(spec);
  supportedDocks(spec);
  defaultOpen(spec);
  presentationMode(spec);
  hierarchy(spec);
  refreshOnEvents(spec);
  noFilter(spec);
  filterFields(spec);
  expandAll(spec);
  expansionScope(spec);
}

export function validateDefineSpec(spec: ViewSpec) {
  const name = field(spec, "name");
  if (luaType(name) === "string" && name.startsWith(RESERVED_PICK_PREFIX)) {
    throw new Error(
      `view.define: names starting with '${RESERVED_PICK_PREFIX}' are reserved for view.pick`,
    );
  }
  // A content view renders a document, not a list: there is no row to select,
  // so it is the one shape of view that needs no `onSelect`.
  if (
    !present(field(spec, "content")) &&
    luaType(field(spec, "onSelect")) !== "function"
  ) {
    throw new Error("view.define: onSelect is required");
  }
  if (
    (truthy(field(spec, "key")) || truthy(field(spec, "mac"))) &&
    !truthy(field(spec, "command"))
  ) {
    throw new Error("view.define: key/mac require command");
  }
  const dock = field(spec, "dock");
  if (field(spec, "openOnStart") === true && dock !== "lhs" && dock !== "rhs") {
    throw new Error('view.define: openOnStart requires dock "lhs" or "rhs"');
  }
  validateViewSpec(spec, "view.define");
}

const PICK_REJECTED_FIELDS = [
  "name",
  "command",
  "key",
  "mac",
  "menu",
  "menuMac",
  "menuWindows",
  "menuLinux",
  "hide",
  "dock",
  "supportedDocks",
  "defaultOpen",
  "openOnStart",
  "refreshOn",
  "refreshOnOpen",
  "followEditor",
  "onMove",
  "prefixViews",
];

const PICK_CONTENT_FIELDS = [
  "source",
  "filter",
  "segments",
  "dropdown",
  "presentation",
  "placeholder",
  "title",
  "label",
  "search",
  "onCreate",
  "actions",
  "keymap",
];

let pickCounter = 0;

// `pickCounter` alone would restart at 0 on a client reload while an old pending pick is still live, silently colliding names -- the random component is what actually guarantees uniqueness.
export function nextPickName(): string {
  pickCounter++;
  return `${RESERVED_PICK_PREFIX}${pickCounter}:${Math.random()}`;
}

/** The internal `view.define`-shaped spec one `view.pick` call
 * stands up: the user's content fields under a generated ephemeral name. */
export function buildPickSpec(spec: ViewSpec, name: string): ViewSpec {
  if (luaType(spec) !== "table") {
    throw new Error("view.pick: spec must be a table");
  }
  if (present(field(spec, "content"))) {
    throw new Error(
      "view.pick: 'content' is a view.define field -- a pick resolves to a " +
        "selected row, and a content view has no rows; use view.define",
    );
  }
  for (const rejected of PICK_REJECTED_FIELDS) {
    if (present(field(spec, rejected))) {
      throw new Error(
        `view.pick: '${rejected}' is a view.define field ` +
          "(a name, command chrome, or docking field) -- view.pick " +
          "doesn't take it; use view.define if this view needs one of its own",
      );
    }
  }
  const internal: Record<string, any> = {
    name,
    dock: "modal",
    ephemeral: true,
    onSelect: field(spec, "onSelect"),
  };
  for (const content of PICK_CONTENT_FIELDS) {
    internal[content] = field(spec, content);
  }
  validateViewSpec(internal, "view.pick");
  return internal;
}

// The frame has to carry the space's global env: string methods (`name:split(...)`) resolve their metatable off `_GLOBAL`, and a lost frame has none.
async function callLua(
  sf: LuaStackFrame,
  fn: ILuaFunction,
  ...args: any[]
): Promise<any> {
  return await luaValueToJS(fn, sf)(...args);
}

function handlerFrame(luaEnv?: LuaEnv): LuaStackFrame {
  return luaEnv
    ? LuaStackFrame.createWithGlobalEnv(luaEnv)
    : LuaStackFrame.lostFrame;
}

// The panel dispatches these fire-and-forget, so an escaping error would be invisible -- no panel feedback, nothing in the UI.
async function runHandler(what: string, fn: () => Promise<any>): Promise<any> {
  try {
    return await fn();
  } catch (e: any) {
    await editor.flashNotification(
      `navigator ${what}: ${e?.message ?? e}`,
      "error",
    );
    return undefined;
  }
}

async function readOnlyMode(): Promise<boolean> {
  if ((await system.getMode()) === "ro") return true;
  return (await editor.getUiOption("forcedROMode")) === true;
}

async function resolveDecorations(
  sf: LuaStackFrame,
  fn: unknown,
  obj: any,
): Promise<any> {
  if (fn === undefined || fn === null) return undefined;
  const out = await callLua(sf, fn as ILuaFunction, obj);
  if (out === undefined || out === null) return undefined;
  if (Array.isArray(out)) return out.length === 0 ? undefined : out;
  // An empty Lua table has no array part and arrives as an object: that is "no chips", not a shape mistake.
  if (luaType(out) === "table" && Object.keys(out as object).length === 0) {
    return undefined;
  }
  throw new Error(
    "navigator: presentation.row.decorations must return a list of chips",
  );
}

async function resolveField(
  sf: LuaStackFrame,
  fieldOrFn: unknown,
  obj: any,
): Promise<any> {
  if (fieldOrFn === undefined || fieldOrFn === null) return undefined;
  if (luaType(fieldOrFn) === "function") {
    return await callLua(sf, fieldOrFn as ILuaFunction, obj);
  }
  return obj?.[fieldOrFn as string];
}

async function buildRows(
  sf: LuaStackFrame,
  spec: ViewSpec,
  ctx: any,
): Promise<any[]> {
  const row = or(field(or(field(spec, "presentation"), {}), "row"), {});
  const objs = await callLua(sf, field(spec, "source") as ILuaFunction, ctx);
  if (objs === null || typeof objs !== "object") {
    throw new Error(
      `navigator: source must return a list, got ${luaType(objs)}`,
    );
  }
  const rows: any[] = [];
  // A Lua table with no array part converts to an object, which is what `ipairs` walks zero times.
  for (const obj of Array.isArray(objs) ? objs : []) {
    rows.push({
      obj,
      primary:
        (await resolveField(sf, field(row, "primary"), obj)) ??
        obj?.name ??
        obj?.ref,
      label: await resolveField(sf, field(row, "label"), obj),
      description: await resolveField(sf, field(row, "description"), obj),
      decorations: await resolveDecorations(sf, field(row, "decorations"), obj),
      cssClass: await resolveField(sf, field(row, "cssClass"), obj),
    });
  }
  return rows;
}

async function rowState(
  sf: LuaStackFrame,
  spec: ViewSpec,
  args: any,
): Promise<any[]> {
  const icon = field(
    or(field(or(field(spec, "presentation"), {}), "row"), {}),
    "icon",
  );
  const actions = sequence(field(spec, "actions"));
  const hasActions = truthy(field(spec, "actions"));
  const segments = sequence(field(spec, "segments"));
  const hasSegments =
    truthy(field(spec, "segments")) && searchMode(spec) !== "source";
  const out: any[] = [];
  for (const obj of args.objs ?? []) {
    const entry: { segments?: boolean[]; actions?: boolean[]; icon?: string } =
      {};
    if (hasActions) {
      const mask: boolean[] = [];
      for (const action of actions) {
        const when = field(action, "when");
        if (when === undefined || when === null) {
          mask.push(true);
          continue;
        }
        try {
          mask.push((await callLua(sf, when as ILuaFunction, obj)) === true);
        } catch {
          mask.push(false);
        }
      }
      entry.actions = mask;
    }
    if (hasSegments) {
      const mask: boolean[] = [];
      for (const segment of segments) {
        const where = field(segment, "where");
        if (where === undefined || where === null) {
          mask.push(true);
          continue;
        }
        try {
          mask.push((await callLua(sf, where as ILuaFunction, obj)) === true);
        } catch {
          mask.push(false);
        }
      }
      entry.segments = mask;
    }
    if (icon !== undefined && icon !== null) {
      try {
        // Unlike `row.primary`, a string here is the icon itself, not a field name to read off the object.
        const value =
          luaType(icon) === "function"
            ? await callLua(sf, icon as ILuaFunction, obj)
            : icon;
        if (typeof value === "string") entry.icon = value;
      } catch {}
    }
    out.push(entry);
  }
  return out;
}

/**
 * One batch per load, like rowState: the options are re-evaluated here (not
 * at define time, so a dynamic set stays fresh), and every row is masked
 * against every option's value, failing predicates closed.
 */
async function dropdownState(
  sf: LuaStackFrame,
  spec: ViewSpec,
  args: any,
): Promise<
  | { options: DropdownOption[]; masks: boolean[][]; default?: string }
  | undefined
> {
  const dropdown = field(spec, "dropdown");
  if (!truthy(dropdown)) return undefined;
  const listed =
    luaType(field(dropdown, "options")) === "function"
      ? await callLua(sf, field(dropdown, "options") as ILuaFunction)
      : field(dropdown, "options");
  const options: DropdownOption[] = [];
  for (const entry of sequence(listed)) {
    const label = field(entry, "label");
    const value = field(entry, "value");
    if (luaType(label) !== "string" || label === "" || !present(value)) {
      continue;
    }
    options.push({ label, value: toJS(value) });
  }
  const declared = field(dropdown, "default");
  let resolved: any;
  try {
    resolved = toJS(
      luaType(declared) === "function"
        ? await callLua(sf, declared as ILuaFunction)
        : declared,
    );
  } catch {
    resolved = undefined;
  }
  const key = field(dropdown, "key");
  const where = field(dropdown, "where") as ILuaFunction;
  const masks: boolean[][] = [];
  for (const obj of args.objs ?? []) {
    if (present(key)) {
      // One call per row, then plain equality against each option — the whole
      // point of `key` is not paying a Lua call per (row, option) pair.
      let value: unknown;
      try {
        value = toJS(await callLua(sf, key as ILuaFunction, obj));
      } catch {
        masks.push(options.map(() => false));
        continue;
      }
      masks.push(options.map((option) => option.value === value));
      continue;
    }
    const mask: boolean[] = [];
    for (const option of options) {
      try {
        mask.push((await callLua(sf, where, obj, option.value)) === true);
      } catch {
        mask.push(false);
      }
    }
    masks.push(mask);
  }
  return {
    options,
    masks,
    default: options.some((o) => o.value === resolved) ? resolved : undefined,
  };
}

/**
 * Run one panel hook against a Lua view's spec. `onPick` is the pick
 * bookkeeping a `view.pick` view carries: its user `onSelect` gets a
 * veto (returning `false`), and anything else settles the pick.
 */
export async function luaHandle(
  spec: ViewSpec,
  hook: NavigatorHook,
  args: any,
  luaEnv?: LuaEnv,
  onPick?: (obj: any) => void,
): Promise<any> {
  const sf = handlerFrame(luaEnv);
  switch (hook) {
    case "rows": {
      const incoming = args.ctx ?? {};
      const ctx = {
        phrase: incoming.phrase ?? "",
        segment: incoming.segment,
        dock: incoming.dock,
      };
      // Exceptions come back as data here (not flashed): unlike the other hooks, a throwing source leaves nothing else on screen to fall back to.
      try {
        return await buildRows(sf, spec, ctx);
      } catch (e: any) {
        return { error: e?.message ?? String(e) };
      }
    }
    case "content": {
      const content = field(spec, "content");
      if (!truthy(content)) return undefined;
      const incoming = args.ctx ?? {};
      // Same contract as "rows": a throwing content function comes back as
      // data, because there is nothing else left on screen to fall back to.
      try {
        return {
          markdown: contentMarkdown(
            await callLua(sf, content as ILuaFunction, {
              phrase: incoming.phrase ?? "",
              dock: incoming.dock,
            }),
          ),
        };
      } catch (e: any) {
        return { error: e?.message ?? String(e) };
      }
    }
    case "select":
      return await runHandler("onSelect", async () => {
        const onSelect = field(spec, "onSelect");
        if (onPick) {
          if (
            onSelect &&
            (await callLua(sf, onSelect as ILuaFunction, args.obj, {
              from: args.from,
            })) === false
          ) {
            return false;
          }
          onPick(args.obj);
          return undefined;
        }
        if (!onSelect) return undefined;
        return await callLua(sf, onSelect as ILuaFunction, args.obj, {
          from: args.from,
        });
      });
    case "create": {
      const onCreate = field(spec, "onCreate");
      if (!truthy(onCreate)) return undefined;
      await runHandler("onCreate", () =>
        callLua(sf, onCreate as ILuaFunction, args.phrase),
      );
      return undefined;
    }
    case "key": {
      const keymap = field(spec, "keymap");
      const fn = truthy(keymap) ? field(keymap, args.key) : undefined;
      if (!truthy(fn)) return undefined;
      await runHandler("keymap", () =>
        callLua(sf, fn as ILuaFunction, args.obj),
      );
      return undefined;
    }
    case "action": {
      const action = sequence(field(spec, "actions"))[args.index - 1];
      if (!action) return undefined;
      // The panel already hides these, but the click and a mode change could have crossed in flight, and this hook is reachable without the panel at all.
      if (field(action, "requireMode") === "rw" && (await readOnlyMode())) {
        await editor.flashNotification(
          `navigator: ${field(action, "label")} is unavailable in read-only mode`,
          "error",
        );
        return undefined;
      }
      await runHandler("action", () =>
        callLua(sf, field(action, "run") as ILuaFunction, args.obj),
      );
      return undefined;
    }
    case "rowState":
      return await rowState(sf, spec, args);
    case "dropdown":
      return await dropdownState(sf, spec, args);
    case "move": {
      const onMove = field(spec, "onMove");
      if (!truthy(onMove)) return undefined;
      await runHandler("onMove", () =>
        callLua(sf, onMove as ILuaFunction, args.obj, args.newName),
      );
      return undefined;
    }
    default:
      return undefined;
  }
}

const COMMAND_FIELDS = [
  "key",
  "mac",
  "menu",
  "menuMac",
  "menuWindows",
  "menuLinux",
  "hide",
];

/**
 * The command chrome `view.define` mirrors into a command definition.
 * Absent fields are left out rather than set to `undefined`: config validates
 * against its JSON schema, which rejects an `undefined` property value.
 */
export function commandDefinition(
  spec: ViewSpec,
  run: () => Promise<any>,
): Record<string, any> {
  const command: Record<string, any> = {
    name: toJS(field(spec, "command")),
    run,
  };
  for (const name of COMMAND_FIELDS) {
    const value = field(spec, name);
    if (value !== undefined && value !== null) command[name] = toJS(value);
  }
  return command;
}
