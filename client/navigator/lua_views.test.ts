import { expect, test } from "vitest";
import type { LuaFunctionCallStatement } from "../space_lua/ast.ts";
import { evalExpression } from "../space_lua/eval.ts";
import { parseBlock } from "../space_lua/parse.ts";
import { LuaEnv, LuaStackFrame, type LuaTable } from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";
import {
  buildPickSpec,
  luaHandle,
  validateDefineSpec,
  wireMeta,
} from "./lua_views.ts";

/** A real Lua table, closures and all -- the same value `lua:navigator.define` receives. */
function luaSpecIn(env: LuaEnv, source: string): LuaTable {
  const node = parseBlock(`e(${source})`)
    .statements[0] as LuaFunctionCallStatement;
  const sf = new LuaStackFrame(env, node.ctx);
  return evalExpression(node.call.args[0], env, sf) as LuaTable;
}

function luaSpec(source: string): LuaTable {
  return luaSpecIn(new LuaEnv(luaBuildStandardEnv()), source);
}

const SOURCE = "source = function() return {} end";
const ON_SELECT = "onSelect = function() end";

function define(fields: string) {
  return () => validateDefineSpec(luaSpec(`{ ${fields} }`));
}

const rejections: [string, string, string][] = [
  [
    "reserved pick prefix",
    `name = "__pick:x", ${SOURCE}, ${ON_SELECT}`,
    "navigator.define: names starting with '__pick:' are reserved for navigator.pick",
  ],
  [
    "missing onSelect",
    `name = "v", ${SOURCE}`,
    "navigator.define: onSelect is required",
  ],
  [
    "key without command",
    `name = "v", key = "Ctrl-j", ${SOURCE}, ${ON_SELECT}`,
    "navigator.define: key/mac require command",
  ],
  [
    "mac without command",
    `name = "v", mac = "Cmd-j", ${SOURCE}, ${ON_SELECT}`,
    "navigator.define: key/mac require command",
  ],
  [
    "openOnStart on a modal",
    `name = "v", openOnStart = true, ${SOURCE}, ${ON_SELECT}`,
    'navigator.define: openOnStart requires dock "lhs" or "rhs"',
  ],
  [
    "missing name",
    `${SOURCE}, ${ON_SELECT}`,
    "navigator.define: name is required",
  ],
  [
    "missing source",
    `name = "v", ${ON_SELECT}`,
    "navigator.define: source is required",
  ],
  [
    "createIcon that is not a string",
    `name = "v", ${SOURCE}, ${ON_SELECT}, presentation = { createIcon = 42 }`,
    'navigator.define: presentation.createIcon must be an icon name ("lock"), a namespaced name ("feather:lock"), or literal SVG markup (a string starting with "<svg")',
  ],
  [
    "row icon table",
    `name = "v", ${SOURCE}, ${ON_SELECT}, presentation = { row = { icon = { svg = "<svg></svg>" } } }`,
    'navigator.define: presentation.row.icon must be an icon name ("lock"), a namespaced name ("feather:lock"), literal SVG markup (a string starting with "<svg"), or a function returning one',
  ],
  [
    "reserved keymap key",
    `name = "v", ${SOURCE}, ${ON_SELECT}, keymap = { Enter = function() end }`,
    "navigator.define: key 'Enter' is reserved by built-in navigation",
  ],
  [
    "keymap entry that is not a function",
    `name = "v", ${SOURCE}, ${ON_SELECT}, keymap = { x = 1 }`,
    "navigator.define: keymap['x'] must be a function",
  ],
  [
    "action without a label",
    `name = "v", ${SOURCE}, ${ON_SELECT}, actions = { { run = function() end } }`,
    "navigator.define: actions[1] requires a label",
  ],
  [
    "action without a run",
    `name = "v", ${SOURCE}, ${ON_SELECT}, actions = { { label = "A" } }`,
    "navigator.define: actions[1].run must be a function",
  ],
  [
    "action when that is not a function",
    `name = "v", ${SOURCE}, ${ON_SELECT}, actions = { { label = "A", run = function() end, when = true } }`,
    "navigator.define: actions[1].when must be a function",
  ],
  [
    "action requireMode other than rw",
    `name = "v", ${SOURCE}, ${ON_SELECT}, actions = { { label = "A", run = function() end, requireMode = "ro" } }`,
    'navigator.define: actions[1].requireMode must be "rw"',
  ],
  [
    "action icon table",
    `name = "v", ${SOURCE}, ${ON_SELECT}, actions = { { label = "A", run = function() end, icon = { svg = "<svg></svg>" } } }`,
    'navigator.define: actions[1].icon must be an icon name ("lock"), a namespaced name ("feather:lock"), or literal SVG markup (a string starting with "<svg")',
  ],
  [
    "segment without a label",
    `name = "v", ${SOURCE}, ${ON_SELECT}, segments = { { icon = "layers" } }`,
    "navigator.define: segments[1] requires a label",
  ],
  [
    "duplicate segment label",
    `name = "v", ${SOURCE}, ${ON_SELECT}, segments = { { label = "A" }, { label = "A" } }`,
    "navigator.define: duplicate segment label 'A'",
  ],
  [
    "segment where that is not a function",
    `name = "v", ${SOURCE}, ${ON_SELECT}, segments = { { label = "A", where = 3 } }`,
    "navigator.define: segments[1].where must be a function",
  ],
  [
    "segment icon table",
    `name = "v", ${SOURCE}, ${ON_SELECT}, segments = { { label = "A", icon = {} } }`,
    'navigator.define: segments[1].icon must be an icon name ("lock"), a namespaced name ("feather:lock"), or literal SVG markup (a string starting with "<svg")',
  ],
  [
    "prefixViews that is not a table",
    `name = "v", ${SOURCE}, ${ON_SELECT}, prefixViews = "nope"`,
    "navigator.define: prefixViews must be a table",
  ],
  [
    "prefixViews target that is not a name",
    `name = "v", ${SOURCE}, ${ON_SELECT}, prefixViews = { ["$"] = 7 }`,
    "navigator.define: prefixViews['$'] must be a view name",
  ],
  [
    "segment prefix that is not a string",
    `name = "v", ${SOURCE}, ${ON_SELECT}, segments = { { label = "A", prefix = 1 } }`,
    "navigator.define: segments[1].prefix must be a string",
  ],
  [
    "segment prefix longer than one character",
    `name = "v", ${SOURCE}, ${ON_SELECT}, segments = { { label = "A", prefix = "ab" } }`,
    "navigator.define: segments[1].prefix must be exactly one character",
  ],
  [
    "segment prefix that is whitespace",
    `name = "v", ${SOURCE}, ${ON_SELECT}, segments = { { label = "A", prefix = " " } }`,
    "navigator.define: segments[1].prefix must be a printable character",
  ],
  [
    "prefix claimed twice",
    `name = "v", ${SOURCE}, ${ON_SELECT}, segments = { { label = "A", prefix = "$" } }, prefixViews = { ["$"] = "other" }`,
    "navigator.define: prefix '$' is claimed twice (segments[1].prefix and prefixViews['$'])",
  ],
  [
    "keymap key colliding with a prefix",
    `name = "v", ${SOURCE}, ${ON_SELECT}, prefixViews = { ["$"] = "other" }, keymap = { ["$"] = function() end }`,
    "navigator.define: '$' is both a keymap key and prefixViews['$']",
  ],
  [
    "zero limit",
    `name = "v", ${SOURCE}, ${ON_SELECT}, presentation = { limit = 0 }`,
    "navigator.define: presentation.limit must be a positive integer",
  ],
  [
    "fractional limit",
    `name = "v", ${SOURCE}, ${ON_SELECT}, presentation = { limit = 1.5 }`,
    "navigator.define: presentation.limit must be a positive integer",
  ],
  [
    "unknown search mode",
    `name = "v", ${SOURCE}, ${ON_SELECT}, search = "fts"`,
    'navigator.define: search must be "client" or "source"',
  ],
  [
    "unknown dock",
    `name = "v", ${SOURCE}, ${ON_SELECT}, dock = "left"`,
    'navigator.define: dock must be "modal", "lhs" or "rhs"',
  ],
  [
    "unknown presentation mode",
    `name = "v", ${SOURCE}, ${ON_SELECT}, presentation = { mode = "table" }`,
    'navigator.define: presentation.mode must be "list" or "tree"',
  ],
  [
    "incomplete hierarchy",
    `name = "v", ${SOURCE}, ${ON_SELECT}, presentation = { mode = "tree", hierarchy = {} }`,
    "navigator.define: presentation.hierarchy must be { field = <string>, separator = <string> }",
  ],
  [
    "refreshOn that is not a list",
    `name = "v", ${SOURCE}, ${ON_SELECT}, refreshOn = "file:changed"`,
    "navigator.define: refreshOn must be a list of event names",
  ],
  [
    "filter.fields that is not a table",
    `name = "v", ${SOURCE}, ${ON_SELECT}, filter = { fields = "name" }`,
    "navigator.define: filter.fields must be a table",
  ],
  [
    "expandAll that is not a boolean",
    `name = "v", ${SOURCE}, ${ON_SELECT}, presentation = { mode = "tree", expandAll = "yes" }`,
    "navigator.define: presentation.expandAll must be a boolean",
  ],
  [
    "expandAll on a list view",
    `name = "v", ${SOURCE}, ${ON_SELECT}, presentation = { expandAll = true }`,
    'navigator.define: presentation.expandAll requires mode "tree"',
  ],
  [
    "unknown expansionScope",
    `name = "v", ${SOURCE}, ${ON_SELECT}, presentation = { mode = "tree", expansionScope = "space" }`,
    'navigator.define: presentation.expansionScope must be "view" or "page"',
  ],
  [
    "page expansionScope on a list view",
    `name = "v", ${SOURCE}, ${ON_SELECT}, presentation = { expansionScope = "page" }`,
    'navigator.define: presentation.expansionScope requires mode "tree"',
  ],
];

test.each(
  rejections,
)("navigator.define rejects %s at define time", (_what, fields, message) => {
  expect(define(fields)).toThrow(message);
});

test("a fully defaulted spec projects the meta the panel expects", () => {
  const meta = wireMeta(luaSpec(`{ name = "v", ${SOURCE}, ${ON_SELECT} }`));

  expect(meta).toEqual({
    name: "v",
    title: "v",
    label: undefined,
    placeholder: undefined,
    stripPrefix: undefined,
    createIcon: undefined,
    mode: "list",
    dock: "modal",
    hierarchy: { field: "name", separator: "/" },
    foldersFirst: true,
    expandAll: false,
    expansionScope: "view",
    filterFields: undefined,
    followEditor: false,
    refreshOn: undefined,
    hasMove: false,
    hasCreate: false,
    refreshOnOpen: false,
    keys: undefined,
    actions: undefined,
    segments: undefined,
    limit: 200,
    search: "client",
    hasRowIcon: false,
    prefixViews: undefined,
    pathCompletion: false,
    hashtagFilter: false,
    ephemeral: false,
    openOnStart: false,
  });
});

// Both plausible spellings of "nothing here": each has to become absent, or
// the panel reads an object where it expects an array (refreshOn, keys,
// actions, segments) or ranks every row against zero fields (filter.fields).
test("empty tables mean 'none', not 'broken'", () => {
  const meta = wireMeta(
    luaSpec(
      `{ name = "v", ${SOURCE}, ${ON_SELECT}, refreshOn = {}, keymap = {},
         actions = {}, segments = {}, prefixViews = {}, filter = { fields = {} } }`,
    ),
  );

  expect(meta.refreshOn).toBeUndefined();
  expect(meta.keys).toBeUndefined();
  expect(meta.actions).toBeUndefined();
  expect(meta.segments).toBeUndefined();
  expect(meta.prefixViews).toBeUndefined();
  expect(meta.filterFields).toBeUndefined();
});

test("declared chrome projects into the meta the panel draws from", () => {
  const meta = wireMeta(
    luaSpec(`{
      name = "v",
      title = "Title",
      label = "Open",
      placeholder = "Thing",
      dock = "rhs",
      openOnStart = true,
      followEditor = true,
      refreshOn = { "file:changed" },
      refreshOnOpen = true,
      search = "source",
      filter = { fields = { name = 1.0 }, stripPrefix = "#", pathCompletion = true, hashtagFilter = true },
      presentation = {
        mode = "tree",
        expandAll = true,
        expansionScope = "page",
        foldersFirst = false,
        limit = 25,
        createIcon = "file-text",
        hierarchy = { field = "path", separator = "." },
        row = { icon = function() return "hash" end },
      },
      prefixViews = { ["#"] = "std.tags" },
      keymap = { [" "] = function() end },
      actions = {
        { label = "Rename", icon = "edit-3", requireMode = "rw", run = function() end,
          when = function() return true end },
      },
      segments = {
        { label = "All", icon = "layers", default = true, placeholder = "Anything" },
        { label = "Pages", prefix = "^", where = function() return true end },
      },
      onMove = function() end,
      onCreate = function() end,
      ${SOURCE},
      ${ON_SELECT},
    }`),
  );

  expect(meta).toMatchObject({
    title: "Title",
    label: "Open",
    placeholder: "Thing",
    dock: "rhs",
    openOnStart: true,
    followEditor: true,
    refreshOn: ["file:changed"],
    refreshOnOpen: true,
    search: "source",
    stripPrefix: "#",
    pathCompletion: true,
    hashtagFilter: true,
    filterFields: { name: 1 },
    mode: "tree",
    expandAll: true,
    expansionScope: "page",
    foldersFirst: false,
    limit: 25,
    createIcon: "file-text",
    hierarchy: { field: "path", separator: "." },
    hasRowIcon: true,
    prefixViews: { "#": "std.tags" },
    keys: [" "],
    hasMove: true,
    hasCreate: true,
    actions: [
      { label: "Rename", icon: "edit-3", requireMode: "rw", hasWhen: true },
    ],
    segments: [
      {
        label: "All",
        icon: "layers",
        default: true,
        placeholder: "Anything",
        hasWhere: false,
      },
      { label: "Pages", prefix: "^", default: false, hasWhere: true },
    ],
  });
});

test("navigator.pick rejects every navigator.define field", () => {
  const rejected = [
    ["name", '"x"'],
    ["command", '"X"'],
    ["key", '"k"'],
    ["mac", '"k"'],
    ["menu", '"File"'],
    ["menuMac", '"File"'],
    ["menuWindows", '"File"'],
    ["menuLinux", '"File"'],
    ["hide", "true"],
    ["dock", '"lhs"'],
    ["openOnStart", "true"],
    ["refreshOn", '{ "file:changed" }'],
    ["refreshOnOpen", "true"],
    ["followEditor", "true"],
    ["onMove", "function() end"],
    ["prefixViews", '{ ["$"] = "somewhere" }'],
  ];
  for (const [name, value] of rejected) {
    expect(() =>
      buildPickSpec(luaSpec(`{ ${SOURCE}, ${name} = ${value} }`), "__pick:1:0"),
    ).toThrow(
      `navigator.pick: '${name}' is a navigator.define field (a name, command chrome, or docking field) -- navigator.pick doesn't take it; use navigator.define if this view needs one of its own`,
    );
  }
});

// `~= nil`, not truthiness: `followEditor = false` is a plausible copy-paste
// from a define spec and still isn't a field navigator.pick takes.
test("navigator.pick rejects a define field even when its value is false", () => {
  expect(() =>
    buildPickSpec(luaSpec(`{ ${SOURCE}, followEditor = false }`), "__pick:1:0"),
  ).toThrow(
    "navigator.pick: 'followEditor' is a navigator.define field (a name, command chrome, or docking field) -- navigator.pick doesn't take it; use navigator.define if this view needs one of its own",
  );
});

test("a present-but-false onMove/onCreate/row.icon still counts as declared", () => {
  const meta = wireMeta(
    luaSpec(
      `{ name = "v", ${SOURCE}, ${ON_SELECT}, onMove = false, onCreate = false,
         presentation = { row = { icon = false } } }`,
    ),
  );

  expect(meta.hasMove).toBe(true);
  expect(meta.hasCreate).toBe(true);
  expect(meta.hasRowIcon).toBe(true);
});

test("navigator.pick rejects a non-table spec and a sourceless one", () => {
  expect(() => buildPickSpec("nope" as any, "__pick:1:0")).toThrow(
    "navigator.pick: spec must be a table",
  );
  expect(() => buildPickSpec(luaSpec("{ }"), "__pick:1:0")).toThrow(
    "navigator.pick: source is required",
  );
});

test("navigator.pick keeps the content fields and stands them up as an ephemeral modal", () => {
  const internal = buildPickSpec(
    luaSpec(
      `{ ${SOURCE}, title = "Pick", placeholder = "Fruit", ${ON_SELECT} }`,
    ),
    "__pick:1:0.5",
  );
  const meta = wireMeta(internal);

  expect(meta.name).toBe("__pick:1:0.5");
  expect(meta.dock).toBe("modal");
  expect(meta.ephemeral).toBe(true);
  expect(meta.title).toBe("Pick");
  expect(meta.placeholder).toBe("Fruit");
});

test("the rows hook runs the spec's own closures", async () => {
  const spec = luaSpec(`{
    name = "v",
    source = function(ctx) return { { name = "a" .. ctx.phrase, weight = 2 } } end,
    presentation = { row = { description = function(obj) return "w=" .. obj.weight end } },
    ${ON_SELECT},
  }`);

  const rows = await luaHandle(spec, "rows", { ctx: { phrase: "!" } });

  expect(rows).toEqual([
    { obj: { name: "a!", weight: 2 }, primary: "a!", description: "w=2" },
  ]);
});

// `ipairs(nil)` used to throw inside the source's own pcall, so a spec whose
// source forgets to return anything showed the panel an error rather than an
// empty list that looks like a legitimately empty view.
test("a source that returns no list at all comes back as an error", async () => {
  const spec = luaSpec(`{ name = "v", source = function() end, ${ON_SELECT} }`);

  await expect(luaHandle(spec, "rows", {})).resolves.toEqual({
    error: "navigator: source must return a list, got nil",
  });
});

// An empty Lua table has no array part and converts to an object, which is
// exactly what `ipairs` walks zero times -- not an error.
test("a source that returns an empty table is an empty list, not an error", async () => {
  const spec = luaSpec(`{ name = "v", ${SOURCE}, ${ON_SELECT} }`);

  await expect(luaHandle(spec, "rows", {})).resolves.toEqual([]);
});

test("a throwing source comes back as data, not a rejection", async () => {
  const spec = luaSpec(
    `{ name = "v", source = function() error("kaboom") end, ${ON_SELECT} }`,
  );

  await expect(luaHandle(spec, "rows", {})).resolves.toEqual({
    error: expect.stringContaining("kaboom"),
  });
});

test("rowState masks segments and actions per row, failing predicates closed", async () => {
  const spec = luaSpec(`{
    name = "v",
    ${SOURCE},
    ${ON_SELECT},
    segments = {
      { label = "All" },
      { label = "Big", where = function(obj) return obj.size > 1 end },
    },
    actions = {
      { label = "Always", run = function() end },
      { label = "Boom", run = function() end, when = function() error("no") end },
    },
    presentation = { row = { icon = function(obj) return obj.icon end } },
  }`);

  const state = await luaHandle(spec, "rowState", {
    objs: [{ size: 2, icon: "hash" }, { size: 0 }],
  });

  expect(state).toEqual([
    { segments: [true, true], actions: [true, false], icon: "hash" },
    { segments: [true, false], actions: [true, false] },
  ]);
});

test("a pick view's onSelect can veto the settle by returning false", async () => {
  const spec = buildPickSpec(
    luaSpec(`{ ${SOURCE}, onSelect = function(obj) return obj.keep end }`),
    "__pick:1:0",
  );
  const picked: unknown[] = [];

  expect(
    await luaHandle(
      spec,
      "select",
      { obj: { keep: false } },
      undefined,
      (obj) => picked.push(obj),
    ),
  ).toBe(false);
  expect(picked).toEqual([]);

  await luaHandle(spec, "select", { obj: { keep: true } }, undefined, (obj) =>
    picked.push(obj),
  );
  expect(picked).toEqual([{ keep: true }]);
});

test("a pick view with no onSelect of its own settles straight away", async () => {
  const spec = buildPickSpec(luaSpec(`{ ${SOURCE} }`), "__pick:1:0");
  const picked: unknown[] = [];

  await luaHandle(spec, "select", { obj: { name: "One" } }, undefined, (obj) =>
    picked.push(obj),
  );

  expect(picked).toEqual([{ name: "One" }]);
});

// A closure's stack frame has to carry the space's global env: string methods
// resolve their metatable off `_GLOBAL`, and this row's `primary` would throw
// "attempt to index a string value" without one.
test("closures run against the space's own global environment", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  const spec = luaSpecIn(
    env,
    `{
      name = "v",
      source = function() return { { name = "notes/inbox" } } end,
      presentation = { row = { primary = function(obj)
        return string.upper(obj.name):split("/")[1]
      end } },
      ${ON_SELECT},
    }`,
  );

  const rows = await luaHandle(spec, "rows", {}, env);

  expect(rows).toEqual([{ obj: { name: "notes/inbox" }, primary: "NOTES" }]);
});
