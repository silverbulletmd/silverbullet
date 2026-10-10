import { isTaggedFloat } from "../space_lua/numeric.ts";
import {
  LuaStackFrame,
  LuaTable,
  luaTypeOf,
  luaValueToJS,
} from "../space_lua/runtime.ts";
import { luaDefinitionRef } from "../space_lua.ts";
import { expandRefreshTriggers } from "./refresh_triggers.ts";
import {
  type ActionMeta,
  ALL_DOCKS,
  type DropdownMeta,
  isWindowDock,
  type SegmentMeta,
  TABLE_COLUMN_TYPES,
  type TableColumn,
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

export function luaType(value: unknown): string {
  return luaTypeOf(value) as string;
}

export function field(spec: unknown, key: string): any {
  if (spec instanceof LuaTable) return spec.rawGet(key);
  if (spec && typeof spec === "object") return (spec as any)[key];
  return undefined;
}

/** `spec.x or {}`: only nil and false fall through. */
export function or<T>(value: T, fallback: T): T {
  return value === undefined || value === null || (value as unknown) === false
    ? fallback
    : value;
}

export function truthy(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

/** Lua's `~= nil`: present-but-false still counts as present. */
export function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function toJS(value: unknown): any {
  return luaValueToJS(value, LuaStackFrame.lostFrame);
}

function numberOf(value: unknown): number {
  return isTaggedFloat(value) ? value.value : (value as number);
}

/** `ipairs`: the array part up to its first hole. */
export function sequence(value: unknown): any[] {
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
    const helpText = field(segment, "helpText");
    if (present(helpText) && luaType(helpText) !== "string") {
      throw new Error(`view.define: ${what}.helpText must be a string`);
    }
    out.push({
      label,
      icon: toJS(field(segment, "icon")),
      hasWhere: where !== undefined && where !== null,
      default: field(segment, "default") === true,
      prefix: toJS(field(segment, "prefix")),
      placeholder: toJS(field(segment, "placeholder")),
      helpText: toJS(helpText),
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
  // `key` avoids a Lua call per option; `where` is the more general alternative.
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

export function searchMode(spec: ViewSpec): "client" | "source" {
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
      `${caller}: content must be a function returning the value to show (markdown, a widget, ...)`,
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

function frameStyle(spec: ViewSpec): "full" | "minimal" {
  const value = field(spec, "frame");
  if (!present(value)) return "full";
  if (value !== "full" && value !== "minimal") {
    throw new Error('view.define: frame must be "full" or "minimal"');
  }
  return value;
}

function defaultOpen(spec: ViewSpec): boolean {
  const value = field(spec, "defaultOpen");
  if (value === undefined || value === null) {
    return frameStyle(spec) === "minimal";
  }
  if (luaType(value) !== "boolean") {
    throw new Error("view.define: defaultOpen must be a boolean");
  }
  return value;
}

export function presentationMode(spec: ViewSpec): ViewMeta["mode"] {
  const mode = field(or(field(spec, "presentation"), {}), "mode");
  if (mode === undefined || mode === null) return "list";
  if (mode !== "list" && mode !== "tree" && mode !== "table") {
    throw new Error(
      'view.define: presentation.mode must be "list", "tree", or "table"',
    );
  }
  return mode;
}

export function tableColumns(spec: ViewSpec): TableColumn[] | undefined {
  const p = field(spec, "presentation");
  const columns = field(p, "columns");
  if (!present(columns)) return undefined;
  if (presentationMode(spec) !== "table") {
    throw new Error('view.define: presentation.columns requires mode "table"');
  }
  if (luaType(columns) !== "table") {
    throw new Error("view.define: presentation.columns must be a list");
  }
  const entries = sequence(columns);
  if (keysOf(columns).length !== entries.length) {
    throw new Error("view.define: presentation.columns must be a list");
  }
  return entries.map((column, index) => {
    const what = `view.define: presentation.columns[${index + 1}]`;
    const attribute = field(column, "attribute");
    const label = field(column, "label");
    const value = field(column, "value");
    const type = field(column, "type");
    if (
      present(attribute) &&
      (typeof attribute !== "string" || attribute.length === 0)
    ) {
      throw new Error(`${what}.attribute must be a non-empty string`);
    }
    if (!present(attribute) && !present(value)) {
      throw new Error(`${what} requires attribute or value`);
    }
    if (present(label) && typeof label !== "string") {
      throw new Error(`${what}.label must be a string`);
    }
    if (present(value) && luaType(value) !== "function") {
      throw new Error(`${what}.value must be a function`);
    }
    if (present(type) && !TABLE_COLUMN_TYPES.includes(type)) {
      throw new Error(
        `${what}.type must be one of ${TABLE_COLUMN_TYPES.join(", ")}`,
      );
    }
    return {
      ...(present(attribute) ? { attribute } : {}),
      label: label ?? attribute ?? "",
      ...(present(type) ? { type } : {}),
    };
  });
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
  return expandRefreshTriggers(toJS(refreshOn));
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

function inlineFilter(spec: ViewSpec): boolean {
  const inline = field(field(spec, "filter"), "inline");
  if (!present(inline)) return false;
  if (typeof inline !== "boolean") {
    throw new Error("view.define: filter.inline must be a boolean");
  }
  return inline;
}

export function wireMeta(spec: ViewSpec): ViewMeta {
  const p = or(field(spec, "presentation"), {});
  const f = or(field(spec, "filter"), {});
  const name = field(spec, "name") ?? "";
  const title = field(spec, "title");
  const hasContent = present(field(spec, "content"));
  return {
    name,
    title: truthy(title) ? title : name,
    definition:
      luaDefinitionRef(field(spec, "content")) ??
      luaDefinitionRef(field(spec, "source")) ??
      luaDefinitionRef(field(spec, "onSelect")) ??
      undefined,
    label: toJS(field(spec, "label")),
    placeholder: toJS(field(spec, "placeholder")),
    helpText: toJS(field(spec, "helpText")),
    stripPrefix: toJS(field(f, "stripPrefix")),
    createIcon: toJS(field(p, "createIcon")),
    mode: presentationMode(spec),
    columns: tableColumns(spec),
    hasContent,
    hasSelect:
      present(field(spec, "onSelect")) ||
      (typeof name === "string" && name.startsWith(RESERVED_PICK_PREFIX)),
    dock: dockSlot(spec),
    supportedDocks: supportedDocks(spec),
    hierarchy: hierarchy(spec),
    foldersFirst: field(p, "foldersFirst") !== false,
    expandAll: expandAll(spec),
    expansionScope: expansionScope(spec),
    filterFields: filterFields(spec),
    inlineFilter: inlineFilter(spec),
    // Content views hide the filter but retain its input as the keyboard focus home.
    noFilter: hasContent || noFilter(spec),
    followEditor: field(spec, "followEditor") === true,
    refreshOn: refreshOnEvents(spec),
    hasMove: present(field(spec, "onMove")),
    uploadFiles: field(p, "uploadFiles") === true,
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
    frame: frameStyle(spec),
  } as ViewMeta;
}

/** Validation only -- `wireMeta` is what callers project with once this returns without throwing. */
export function validateViewSpec(
  spec: ViewSpec,
  caller: string,
  requireName = true,
) {
  if (requireName && !truthy(field(spec, "name"))) {
    throw new Error(`${caller}: name is required`);
  }
  const content = contentFn(spec, caller);
  if (!content && !truthy(field(spec, "source"))) {
    throw new Error(`${caller}: source is required`);
  }
  const p = or(field(spec, "presentation"), {});
  const title = field(spec, "title");
  if (present(title) && typeof title !== "string") {
    throw new Error(`${caller}: title must be a string`);
  }
  const helpText = field(spec, "helpText");
  if (present(helpText) && luaType(helpText) !== "string") {
    throw new Error(`${caller}: helpText must be a string`);
  }
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
  frameStyle(spec);
  presentationMode(spec);
  tableColumns(spec);
  hierarchy(spec);
  refreshOnEvents(spec);
  noFilter(spec);
  filterFields(spec);
  inlineFilter(spec);
  expandAll(spec);
  expansionScope(spec);
}

export function validateDefineSpec(spec: ViewSpec, requireSelection = true) {
  if (present(field(spec, "view"))) {
    throw new Error("view.define: 'view' was renamed to 'widget'");
  }
  const name = field(spec, "name");
  if (luaType(name) === "string" && name.startsWith(RESERVED_PICK_PREFIX)) {
    throw new Error(
      `view.define: names starting with '${RESERVED_PICK_PREFIX}' are reserved for view.pick`,
    );
  }
  if (
    requireSelection &&
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
  if (field(spec, "openOnStart") === true && !isWindowDock(dock)) {
    throw new Error(
      'view.define: openOnStart requires dock "lhs", "rhs" or "bhs"',
    );
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
  "frame",
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
  "helpText",
  "title",
  "label",
  "search",
  "onCreate",
  "actions",
  "keymap",
];

let pickCounter = 0;

// Randomize names so a reload cannot collide with an old pending pick.
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
