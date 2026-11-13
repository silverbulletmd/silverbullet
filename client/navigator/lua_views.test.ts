import { expect, test } from "vitest";
import type { LuaFunctionCallStatement } from "../space_lua/ast.ts";
import { evalExpression } from "../space_lua/eval.ts";
import { parseBlock } from "../space_lua/parse.ts";
import {
  LuaEnv,
  LuaNativeJSFunction,
  LuaStackFrame,
  type LuaTable,
} from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";
import { luaHandle } from "./lua_views.ts";
import { buildPickSpec, validateDefineSpec, wireMeta } from "./view_spec.ts";

/** A real Lua table, closures and all -- the same value `lua:view.define` receives. */
function luaSpecIn(env: LuaEnv, source: string, ref?: string): LuaTable {
  const node = parseBlock(`e(${source})`, { ref })
    .statements[0] as LuaFunctionCallStatement;
  const sf = new LuaStackFrame(env, node.ctx);
  return evalExpression(node.call.args[0], env, sf) as LuaTable;
}

function luaSpec(source: string): LuaTable {
  return luaSpecIn(new LuaEnv(luaBuildStandardEnv()), source);
}

const SOURCE = "source = function() return {} end";
const CONTENT = 'content = function() return "# hi" end';
const ON_SELECT = "onSelect = function() end";

function define(fields: string) {
  return () => validateDefineSpec(luaSpec(`{ ${fields} }`));
}

const rejections: [string, string, string][] = [
  [
    "reserved pick prefix",
    `name = "__pick:x", ${SOURCE}, ${ON_SELECT}`,
    "view.define: names starting with '__pick:' are reserved for view.pick",
  ],
  [
    "missing onSelect",
    `name = "v", ${SOURCE}`,
    "view.define: onSelect is required",
  ],
  [
    "key without command",
    `name = "v", key = "Ctrl-j", ${SOURCE}, ${ON_SELECT}`,
    "view.define: key/mac require command",
  ],
  ["missing name", `${SOURCE}, ${ON_SELECT}`, "view.define: name is required"],
  [
    "missing source",
    `name = "v", ${ON_SELECT}`,
    "view.define: source is required",
  ],
  [
    "both content and source",
    `name = "v", ${SOURCE}, ${CONTENT}, ${ON_SELECT}`,
    "view.define: content and source are mutually exclusive -- a view either " +
      "renders markdown (content) or lists rows (source)",
  ],
  [
    "reserved keymap key",
    `name = "v", ${SOURCE}, ${ON_SELECT}, keymap = { Enter = function() end }`,
    "view.define: key 'Enter' is reserved by built-in navigation",
  ],
  [
    "prefix claimed twice",
    `name = "v", ${SOURCE}, ${ON_SELECT}, segments = { { label = "A", prefix = "$" } }, prefixViews = { ["$"] = "other" }`,
    "view.define: prefix '$' is claimed twice (segments[1].prefix and prefixViews['$'])",
  ],
  [
    "keymap key colliding with a prefix",
    `name = "v", ${SOURCE}, ${ON_SELECT}, prefixViews = { ["$"] = "other" }, keymap = { ["$"] = function() end }`,
    "view.define: '$' is both a keymap key and prefixViews['$']",
  ],
  [
    "unknown dock",
    `name = "v", ${SOURCE}, ${ON_SELECT}, dock = "left"`,
    "view.define: dock must be one of lhs, rhs, bhs, modal, page-top, page-bottom",
  ],
];

test.each(rejections)(
  "view.define rejects %s at define time",
  (_what, fields, message) => {
    expect(define(fields)).toThrow(message);
  },
);

test("the dropdown hook evaluates options fresh and masks rows per option, failing predicates closed", async () => {
  const spec = luaSpec(`{
    name = "v",
    ${SOURCE},
    ${ON_SELECT},
    dropdown = {
      options = function()
        return {
          { label = "Pete", value = "People/Pete" },
          { label = "Boom", value = "People/Boom" },
        }
      end,
      where = function(obj, value)
        if value == "People/Boom" then error("no") end
        return obj.target == value
      end,
    },
  }`);

  const state = await luaHandle(spec, "dropdown", {
    objs: [{ target: "People/Pete" }, { target: "People/Else" }],
  });

  expect(state).toEqual({
    options: [
      { label: "Pete", value: "People/Pete" },
      { label: "Boom", value: "People/Boom" },
    ],
    masks: [
      [true, false],
      [false, false],
    ],
  });
});

test("the dropdown hook takes a static options list and skips malformed entries", async () => {
  const spec = luaSpec(`{
    name = "v",
    ${SOURCE},
    ${ON_SELECT},
    dropdown = {
      options = {
        { label = "Pete", value = "p" },
        { label = "", value = "empty" },
        { label = "Valueless" },
        { value = "labelless" },
      },
      where = function(obj, value) return obj.target == value end,
    },
  }`);

  const state = await luaHandle(spec, "dropdown", {
    objs: [{ target: "p" }],
  });

  expect(state).toEqual({
    options: [{ label: "Pete", value: "p" }],
    masks: [[true]],
  });
});

test("the dropdown hook resolves a default, from a function or a string", async () => {
  const fromFunction = await luaHandle(
    luaSpec(`{
      name = "v",
      ${SOURCE},
      ${ON_SELECT},
      dropdown = {
        placeholder = "Recipient",
        options = function() return { { label = "Ada", value = "re:ada" } } end,
        default = function() return "re:ada" end,
        where = function(obj, value) return obj.target == value end,
      },
    }`),
    "dropdown",
    { objs: [] },
  );
  expect(fromFunction.default).toBe("re:ada");

  const fromString = await luaHandle(
    luaSpec(`{
      name = "v",
      ${SOURCE},
      ${ON_SELECT},
      dropdown = {
        options = function() return { { label = "Ada", value = "re:ada" } } end,
        default = "re:ada",
        where = function(obj, value) return obj.target == value end,
      },
    }`),
    "dropdown",
    { objs: [] },
  );
  expect(fromString.default).toBe("re:ada");
});

test("the dropdown hook drops a default that is not among the options", async () => {
  const state = await luaHandle(
    luaSpec(`{
      name = "v",
      ${SOURCE},
      ${ON_SELECT},
      dropdown = {
        options = function() return { { label = "Ada", value = "re:ada" } } end,
        default = function() return "recipient:ghost" end,
        where = function(obj, value) return obj.target == value end,
      },
    }`),
    "dropdown",
    { objs: [] },
  );
  expect(state.default).toBeUndefined();
});

test("a throwing dropdown default costs the default, not the options", async () => {
  const state = await luaHandle(
    luaSpec(`{
      name = "v",
      ${SOURCE},
      ${ON_SELECT},
      dropdown = {
        options = function() return { { label = "Ada", value = "re:ada" } } end,
        default = function() error("boom") end,
        where = function(obj, value) return obj.target == value end,
      },
    }`),
    "dropdown",
    { objs: [] },
  );
  expect(state.options).toEqual([{ label: "Ada", value: "re:ada" }]);
  expect(state.default).toBeUndefined();
});

test("view.pick rejects every view.define field", () => {
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
    ["rememberPhrase", "true"],
    ["followEditor", "true"],
    ["onMove", "function() end"],
    ["prefixViews", '{ ["$"] = "somewhere" }'],
  ];
  for (const [name, value] of rejected) {
    expect(() =>
      buildPickSpec(luaSpec(`{ ${SOURCE}, ${name} = ${value} }`), "__pick:1:0"),
    ).toThrow(
      `view.pick: '${name}' is a view.define field (a name, command chrome, or docking field) -- view.pick doesn't take it; use view.define if this view needs one of its own`,
    );
  }
});

// A content view renders a document, so it has no row to select and no rows
// to filter -- and it says so in its meta, which is how every container knows
// to render markdown instead of a list.
test("a content view needs no onSelect, and projects hasContent + noFilter", () => {
  expect(define(`name = "v", ${CONTENT}`)).not.toThrow();

  const meta = wireMeta(luaSpec(`{ name = "v", ${CONTENT} }`));
  expect(meta.hasContent).toBe(true);
  expect(meta.noFilter).toBe(true);

  // Even an explicit filter table can't put a filter input back: there is
  // nothing on screen for a phrase to narrow.
  const withFilter = wireMeta(
    luaSpec(`{ name = "v", ${CONTENT}, filter = { fields = { name = 1.0 } } }`),
  );
  expect(withFilter.noFilter).toBe(true);
});

test("a row view leaves hasContent off", () => {
  expect(
    wireMeta(luaSpec(`{ name = "v", ${SOURCE}, ${ON_SELECT} }`)).hasContent,
  ).toBe(false);
});

test("the content hook returns the value the view's own closure built", async () => {
  const spec = luaSpec(`{
    name = "v",
    content = function(ctx) return "# Hi " .. ctx.phrase end,
  }`);

  await expect(
    luaHandle(spec, "content", { ctx: { phrase: "there" } }),
  ).resolves.toEqual({ value: "# Hi there" });
  await expect(luaHandle(spec, "content", {})).resolves.toEqual({
    value: "# Hi ",
  });
});

test("content returning nil is a null value, which renders no chrome at all", async () => {
  const spec = luaSpec(`{ name = "v", content = function() return nil end }`);
  await expect(luaHandle(spec, "content", {})).resolves.toEqual({
    value: null,
  });
  const falsy = luaSpec(
    `{ name = "v", content = function() return false end }`,
  );
  await expect(luaHandle(falsy, "content", {})).resolves.toEqual({
    value: null,
  });
});

// Same contract as the rows hook: there is nothing else left on screen to fall
// back to, so a throwing content function has to arrive as data.
test("a throwing content function comes back as data, not a rejection", async () => {
  const spec = luaSpec(
    `{ name = "v", content = function() error("boom") end }`,
  );
  const result = await luaHandle(spec, "content", {});
  expect(result.markdown).toBeUndefined();
  expect(String(result.error)).toContain("boom");
});

test("view.pick rejects content outright", () => {
  expect(() => buildPickSpec(luaSpec(`{ ${CONTENT} }`), "__pick:1:0")).toThrow(
    "view.pick: 'content' is a view.define field -- a pick resolves to a " +
      "selected row, and a content view has no rows; use view.define",
  );
});

test("view.pick rejects a non-table spec and a sourceless one", () => {
  expect(() => buildPickSpec("nope" as any, "__pick:1:0")).toThrow(
    "view.pick: spec must be a table",
  );
  expect(() => buildPickSpec(luaSpec("{ }"), "__pick:1:0")).toThrow(
    "view.pick: source is required",
  );
});

test("view.pick keeps the content fields and stands them up as an ephemeral modal", () => {
  const internal = buildPickSpec(
    luaSpec(
      `{ ${SOURCE}, title = "Pick", placeholder = "Fruit", helpText = "Choose fruit", ${ON_SELECT} }`,
    ),
    "__pick:1:0.5",
  );
  const meta = wireMeta(internal);

  expect(meta.name).toBe("__pick:1:0.5");
  expect(meta.dock).toBe("modal");
  expect(meta.ephemeral).toBe(true);
  expect(meta.title).toBe("Pick");
  expect(meta.placeholder).toBe("Fruit");
  expect(meta.helpText).toBe("Choose fruit");
});

test("tree pickers can opt into Space file uploads", () => {
  const pick = buildPickSpec(
    luaSpec(
      `{ ${SOURCE}, presentation = { mode = "tree", uploadFiles = true } }`,
    ),
    "__pick:files",
  );
  expect(wireMeta(pick).uploadFiles).toBe(true);
  expect(
    wireMeta(luaSpec(`{ ${SOURCE}, presentation = { mode = "tree" } }`))
      .uploadFiles,
  ).toBe(false);
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

// A source returning nil must surface an error, not an apparently empty view.
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

// Reject a bare decoration chip: the renderer expects an array.
test("a decorations function returning a single chip is an error, not a silent drop", async () => {
  const spec = luaSpec(`{
    name = "v",
    source = function() return { { name = "a" } } end,
    ${ON_SELECT},
    presentation = { row = { decorations = function() return { text = "hi" } end } },
  }`);

  await expect(luaHandle(spec, "rows", {})).resolves.toEqual({
    error:
      "navigator: presentation.row.decorations must return a list of chips",
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

test("a keyed dropdown masks by equality, calling the view once per row", async () => {
  // key costs one Lua call per row; where costs one per row per option.
  const spec = luaSpec(`{
    name = "v",
    ${SOURCE},
    ${ON_SELECT},
    dropdown = {
      options = {
        { label = "Pete", value = "p" },
        { label = "Sales", value = "s" },
        { label = "Ops", value = "o" },
      },
      key = function(obj)
        calls = (calls or 0) + 1
        return obj.target
      end,
    },
  }`);

  const state = await luaHandle(spec, "dropdown", {
    objs: [{ target: "p" }, { target: "o" }, { target: "nobody" }],
  });

  expect(state.masks).toEqual([
    [true, false, false],
    [false, false, true],
    [false, false, false],
  ]);
});

test("supportedDocks validates and defaults to the declared dock", () => {
  const meta = wireMeta({
    name: "t",
    source: () => [],
    dock: "page-bottom",
    supportedDocks: ["page-bottom", "rhs", "modal"],
  });
  expect(meta.supportedDocks).toEqual(["page-bottom", "rhs", "modal"]);
  const bare = wireMeta({ name: "t", source: () => [], dock: "rhs" });
  expect(bare.supportedDocks).toEqual(["rhs"]);
});

// `ctx.dock` lets a view present itself differently in a document than in a
// panel -- the same "the container decides" principle the styling follows.
test("the rows hook hands the source its resolved dock", async () => {
  const spec = luaSpec(`{
    name = "v",
    source = function(ctx) return { { name = tostring(ctx.dock) } } end,
    ${ON_SELECT},
  }`);

  expect(
    await luaHandle(spec, "rows", { ctx: { phrase: "", dock: "page-top" } }),
  ).toEqual([{ obj: { name: "page-top" }, primary: "page-top" }]);
  expect(
    await luaHandle(spec, "rows", { ctx: { phrase: "", dock: "modal" } }),
  ).toEqual([{ obj: { name: "modal" }, primary: "modal" }]);
});

test("the content hook hands its function the same dock", async () => {
  const spec = luaSpec(
    `{ name = "v", content = function(ctx) return "dock=" .. tostring(ctx.dock) end }`,
  );

  await expect(
    luaHandle(spec, "content", { ctx: { phrase: "", dock: "rhs" } }),
  ).resolves.toEqual({ value: "dock=rhs" });
});

test("row descriptions carry labels and explicit ranges through Lua", async () => {
  const spec = luaSpec(`{
    name = "v",
    source = function() return { { name = "Walks" } } end,
    presentation = { row = { description = function(obj)
      return { label = "Weekend routes", text = "A quiet walking route.", highlights = { { 8, 15 } } }
    end } },
    ${ON_SELECT},
  }`);
  const rows = await luaHandle(spec, "rows", {});
  expect(rows[0].description).toEqual({
    label: "Weekend routes",
    text: "A quiet walking route.",
    highlights: [[8, 15]],
  });
});

test("table columns retain raw attributes and prepare Lua display callbacks", async () => {
  const spec = luaSpec(`{
    source = function() return {{completed = 3, total = 10, status = false}} end,
    presentation = {mode = "table", columns = {
      {attribute = "completed", label = "Progress", type = "number", value = function(obj) return obj.completed * 2 end},
      {attribute = "status"},
      {attribute = "missing"},
      {value = function(obj) return obj.total end},
    }},
  }`);
  expect(wireMeta(spec).mode).toBe("table");
  expect(wireMeta(spec).columns).toEqual([
    { attribute: "completed", label: "Progress", type: "number" },
    { attribute: "status", label: "status" },
    { attribute: "missing", label: "missing" },
    { label: "" },
  ]);
  const rows = await luaHandle(spec, "rows", {});
  expect(rows[0].cells).toEqual([6, false, undefined, 10]);
  expect(rows[0].obj.completed).toBe(3);
});

test("refreshOn expands trigger names at definition time", () => {
  expect(
    wireMeta(
      luaSpec(
        `{ name = "v", ${CONTENT}, refreshOn = { "navigate", "fixture:ping" } }`,
      ),
    ).refreshOn,
  ).toEqual(["editor:pageLoaded", "editor:documentLoaded", "fixture:ping"]);
});

test("rows and content report their reads; select does not", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.setLocal(
    "probe",
    new LuaNativeJSFunction({
      callback: (name: string) => name,
      observe: (sf, args) => sf.threadState.track?.(`probe:${args[0]}`),
    }),
  );
  const spec = luaSpecIn(
    env,
    `{
      source = function() probe("rows"); return {} end,
      content = function() probe("content"); return "x" end,
      onSelect = function() probe("select") end,
    }`,
  );
  const seen: string[] = [];
  const track = (e: string) => seen.push(e);
  await luaHandle(spec, "rows", { ctx: {}, track }, env);
  await luaHandle(spec, "content", { ctx: {}, track }, env);
  await luaHandle(spec, "select", { obj: {}, track }, env);
  expect(seen).toEqual(["probe:rows", "probe:content"]);
});

test("source views get dropdown options without per-row masks, and see ctx.dropdown", async () => {
  const spec = luaSpec(`{
    name = "v", search = "source",
    dropdown = { options = function() return { { label = "Exact phrase", value = "phrase" } } end },
    source = function(ctx) return { { name = ctx.dropdown or "default" } } end,
    ${ON_SELECT},
  }`);
  const dropdown = await luaHandle(spec, "dropdown", { objs: [{ name: "x" }] });
  expect(dropdown.options).toEqual([
    { label: "Exact phrase", value: "phrase" },
  ]);
  expect(dropdown.masks).toEqual([]);
  const rows = await luaHandle(spec, "rows", {
    ctx: { phrase: "f", dropdown: "phrase" },
  });
  expect(rows[0].primary).toBe("phrase");
});
