import { readdir, readFile } from "node:fs/promises";
import { beforeAll, expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "./boot_config.ts";
import { evalStatement } from "./space_lua/eval.ts";
import { parseBlock } from "./space_lua/parse.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  luaValueToJS,
} from "./space_lua/runtime.ts";
import { luaBuildStandardEnv } from "./space_lua/stdlib.ts";

const env = new LuaEnv(luaBuildStandardEnv());
async function inputLibrary() {
  const names = await readdir(
    new URL("../libraries/Library/Std/Widgets/Inputs/", import.meta.url),
  );
  const scripts = await Promise.all(
    names
      .filter((name) => name.endsWith(".md"))
      .map(async (name) => {
        const code = await libraryCode(
          `Std/Widgets/Inputs/${name.slice(0, -3)}`,
        );
        const priority = Number(code.match(/-- priority: (\d+)/)?.[1] ?? 0);
        return { name, code, priority };
      }),
  );
  return scripts
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
    .map(({ code }) => code);
}

async function libraryCode(path: string) {
  const source = await readFile(
    new URL(`../libraries/Library/${path}.md`, import.meta.url),
    "utf8",
  );
  return extractSpaceLuaFromPageText(source);
}

async function lua(code: string) {
  const block = parseBlock(code);
  const frame = LuaStackFrame.createWithGlobalEnv(env, block.ctx);
  await evalStatement(block, new LuaEnv(env), frame);
  return luaValueToJS(env.get("out"), frame);
}

beforeAll(async () => {
  env.set(
    "jsonschema",
    jsToLuaValue({
      validateObject: (schema: any, value: unknown) => {
        if (
          schema.format === "ref" &&
          !(typeof value === "string" && /^\[\[.+\]\]$/.test(value))
        ) {
          return 'must match format "ref"';
        }
        if (schema.type === "number" && typeof value !== "number") {
          return "must be number";
        }
      },
    }),
  );
  await lua(await libraryCode("Std/APIs/Schema"));
  await lua(`
    function schema.ref(t) return { type = "string", format = "ref", tag = t } end
    function schema.enum(v) return { type = "string", enum = v } end
    function schema.date() return { type = "string", format = "date" } end
    store = { tags = {} }
    config = {
      get = function(path, default)
        local v = store
        for _, k in ipairs(path) do
          if type(v) ~= "table" then return default end
          v = v[k]
        end
        if v == nil then return default end
        return v
      end,
    }
    -- Merges like the real tag.define (config.merge)
    tag = {
      define = function(spec)
        local existing = store.tags[spec.name] or {}
        for k, v in pairs(spec) do existing[k] = v end
        store.tags[spec.name] = existing
      end,
    }
  `);
  await lua(await libraryCode("Std/Infrastructure/Root Tags"));
  await lua(`
    tag.define {
      name = "project",
      schema = {
        type = "object",
        properties = {
          status = schema.enum { "planned", "active", "done" },
          due = schema.date(),
        },
      },
    }
    tag.define {
      name = "contact",
      schema = {
        type = "object",
        properties = {
          role = schema.enum { "Designer", "Engineer" },
          email = schema.string(),
        },
      },
    }
    tag.define {
      name = "milestone",
      schema = {
        type = "object",
        properties = {
          owner = schema.ref("person"),
          budget = schema.number(),
          reviewed = { type = "string", readOnly = true },
        },
      },
    }
  `);
  await lua("widgets = widgets or {}");
  for (const code of await inputLibrary()) await lua(code);
  await lua(await libraryCode("Std/Widgets/Object Form"));
});

test("infer derives a field kind from the YAML value and its type", async () => {
  expect(
    await lua(`
      local function k(v, t) return objectForm.fieldKind(objectForm.infer(v, t)) end
      out = {
        k(4, "number"),
        k("2026-12-01", "date"),
        k("2026-12-01", "string"),
        k("2026-12-01T10:00:00.000Z", "date"),
        k("2026-13-01", "string"),
        k("1 Dec 2026", "string"),
        k("[[A]]", "string"),
        k({ "[[A]]", "[[B]]" }, "array"),
        k({ "[[A]]", 3 }, "array"),
        k({ a = 1 }, "object"),
        k(nil, "null"),
      }
    `),
  ).toEqual([
    "number",
    "date",
    "date",
    "string",
    "string",
    "string",
    "ref",
    "refs",
    "unknown",
    "unknown",
    "string",
  ]);
});

test("fieldKind unwraps nullable and array-or-string schemas", async () => {
  expect(
    await lua(`
      out = {
        objectForm.fieldKind(store.tags.page.schema.properties.tags),
        objectForm.fieldKind(schema.nullable("string")),
        objectForm.fieldKind(schema.array(schema.ref("person"))),
        objectForm.fieldKind({ anyOf = { schema.null(), schema.null() } }),
      }
    `),
  ).toEqual(["tags", "string", "refs", "unknown"]);
});

test("fieldKind and typeName recognise tags and @names", async () => {
  expect(
    await lua(`
      local page = store.tags.page.schema.properties
      local function both(s)
        local kind = objectForm.fieldKind(s)
        return kind .. " " .. objectForm.typeName(kind)
      end
      out = {
        both(page.tags),
        both(page.recipients),
        both(page.authors),
        both(schema.tags()),
        both(schema.nullable(schema.identities())),
        both(schema.array { type = "string", format = "tag" }),
        both({ type = "string", format = "identities" }),
        both(page.aliases),
      }
    `),
  ).toEqual([
    "tags tag[]",
    "identities identity[]",
    "identities identity[]",
    "tags tag[]",
    "identities identity[]",
    "tags tag[]",
    "identities identity[]",
    "strings string[]",
  ]);
});

test("convert changes a value's type or explains why it can't", async () => {
  expect(
    await lua(`
      local function c(v, t)
        local value, reason = objectForm.convert(v, t)
        return { value = value, reason = reason }
      end
      out = {
        c("4", "number"),
        c("abc", "number"),
        c("[[Bob]]", "string"),
        c("Bob", "ref[]"),
        c("", "ref"),
        c("[[A]] and [[B]]", "ref"),
        c("2026-12-01", "string"),
      }
    `),
  ).toEqual([
    { value: 4 },
    { reason: "not a number" },
    { value: "Bob" },
    { value: ["[[Bob]]"] },
    { reason: "empty" },
    { reason: "contains brackets" },
    { value: "2026-12-01" },
  ]);
  expect(await lua(`out = objectForm.convert("2026-12-01", "date")`)).toBe(
    "2026-12-01",
  );
  expect(await lua(`out = objectForm.convert({ "2026-12-01" }, "date")`)).toBe(
    "2026-12-01",
  );
  expect(
    await lua(`out = select(2, objectForm.convert("1 Dec", "date"))`),
  ).toBe("not a YYYY-MM-DD date");
  expect(
    await lua(`out = select(2, objectForm.convert("2026-02-30", "date"))`),
  ).toBe("not a YYYY-MM-DD date");
  expect(await lua(`out = objectForm.convert("2026-12-01", "string")`)).toBe(
    "2026-12-01",
  );
});

const apollo = `
  pageMeta = {
    name = "Projects/Apollo",
    tags = { "project" },
    status = "active",
    codename = "Apollo",
    created = "2026-01-01",
  }
  ctx = {
    values = { tags = { "project" }, status = "active", codename = "Apollo", created = "2026-01-01" },
    types = { tags = "array", status = "string", codename = "string", created = "string" },
    keys = { "tags", "status", "codename", "created" },
    readOnly = false,
  }
`;

test("rows lists tags, present keys in order, then the tag's absent properties", async () => {
  const rows = await lua(`
    ${apollo}
    out = {}
    for _, r in ipairs(objectForm.rows(pageMeta, ctx)) do
      table.insert(out, { key = r.key, locked = r.locked or false, empty = r.value == nil })
    end
  `);
  expect(rows).toEqual([
    { key: "tags", locked: false, empty: false },
    { key: "status", locked: false, empty: false },
    { key: "codename", locked: false, empty: false },
    { key: "created", locked: true, empty: false },
    { key: "due", locked: false, empty: true },
  ]);
});

test("a read-only form has no rows for absent schema properties, but keeps empty present keys", async () => {
  expect(
    await lua(`
      ${apollo}
      local function keys(o, c)
        local out = {}
        for _, r in ipairs(objectForm.rows(o, c)) do table.insert(out, r.key) end
        return out
      end
      local readOnlyCtx = {
        values = { tags = { "project" }, status = "active" },
        types = { tags = "array", status = "string" },
        keys = { "tags", "status" },
        readOnly = true,
      }
      local emptyCtx = {
        values = { tags = { "project" }, due = "" },
        types = { tags = "array", due = "string" },
        keys = { "tags", "due" },
        readOnly = true,
      }
      out = {
        editable = keys(pageMeta, ctx),
        readOnly = keys({ tags = { "project" }, status = "active" }, readOnlyCtx),
        emptyPresent = keys({ tags = { "project" } }, emptyCtx),
      }
    `),
  ).toEqual({
    editable: ["tags", "status", "codename", "created", "due"],
    readOnly: ["tags", "status"],
    emptyPresent: ["tags", "due"],
  });
});

test("rows keeps the raw tags value next to the normalized one", async () => {
  expect(
    await lua(`
      local rows = objectForm.rows(
        { name = "Notes/Ideas", tags = { "a", "b" } },
        { values = { tags = "a, b" }, types = { tags = "string" }, keys = { "tags" } }
      )
      out = { count = #rows, raw = rows[1].raw, kind = rows[1].kind, value = rows[1].value }
    `),
  ).toEqual({ count: 1, raw: "a, b", kind: "tags", value: ["a", "b"] });
});

test("resolveField falls back to inference when the value breaks the schema", async () => {
  expect(
    await lua(`
      local f = objectForm.resolveField(
        "owner",
        { name = "Projects/Apollo/Launch", tags = { "milestone" }, owner = "Bob" },
        { values = { owner = "Bob" }, types = { owner = "string" }, keys = { "owner" } },
        { "milestone" }
      )
      out = { kind = f.kind, fromSchema = f.fromSchema, warning = f.warning }
    `),
  ).toEqual({
    kind: "string",
    fromSchema: true,
    warning: 'must match format "ref"',
  });
});

test("resolveField flags a non-number in a number field", async () => {
  expect(
    await lua(`
      local f = objectForm.resolveField(
        "budget",
        { name = "Projects/Apollo/Launch", tags = { "milestone" }, budget = "abc" },
        { values = { budget = "abc" }, types = { budget = "string" }, keys = { "budget" } },
        { "milestone" }
      )
      out = { kind = f.kind, fromSchema = f.fromSchema, warning = f.warning }
    `),
  ).toEqual({ kind: "string", fromSchema: true, warning: "must be number" });
});

test("rows shows a present but empty tags key, and hides a tag's absent readOnly properties", async () => {
  expect(
    await lua(`
      local function keys(tagsRaw)
        local rows = objectForm.rows(
          { name = "Projects/Apollo/Launch", tags = { "milestone" } },
          {
            values = { tags = tagsRaw },
            types = { tags = type(tagsRaw) == "table" and "array" or "string", due = "null" },
            keys = { "tags", "due" },
          }
        )
        local out = {}
        for _, r in ipairs(rows) do table.insert(out, r.key .. ":" .. r.kind) end
        return out
      end
      out = { keys({}), keys("") }
    `),
  ).toEqual([
    ["tags:tags", "due:string", "budget:number", "owner:ref"],
    ["tags:tags", "due:string", "budget:number", "owner:ref"],
  ]);
});

test("an empty tags: key (null) gets an editable tags row without a warning; an absent one none", async () => {
  expect(
    await lua(`
      local function rows(ctx)
        local out = {}
        for _, r in ipairs(objectForm.rows({ name = "Notes/Plain", tags = {} }, ctx)) do
          table.insert(out, r.key .. ":" .. r.kind .. ":" .. tostring(r.warning))
        end
        return out
      end
      out = {
        rows({ kind = "page", values = {}, types = { tags = "null" }, keys = { "tags" } }),
        rows({ kind = "page", values = {}, types = { tags = "null" }, keys = { "tags" }, readOnly = true }),
        #rows({ kind = "page", values = {}, types = {}, keys = {} }),
      }
    `),
  ).toEqual([["tags:tags:nil"], ["tags:tags:nil"], 0]);
});

test("resolveField treats a nested object as unknown", async () => {
  expect(
    await lua(`
      local f = objectForm.resolveField(
        "a",
        { name = "Notes/Ideas", a = { b = 1 } },
        { values = { a = { b = 1 } }, types = { a = "object" }, keys = { "a" } },
        {}
      )
      out = f.kind
    `),
  ).toBe("unknown");
});

test("listItems reads list values; only tags and identities split on spaces", async () => {
  expect(
    await lua(`
      local i = objectForm.listItems
      out = {
        tagsSpace = i("project  glossary", "tags"),
        tagsComma = i("project, glossary,idea", "tags"),
        tagsList = i({ "project", "#glossary" }, "tags"),
        identities = i("alice, @bob [[Person/Carol]]", "identities"),
        aliases = i("Apollo, Moon shot", "strings"),
        aliasList = i({ "Moon shot" }, "strings"),
        absent = #i(nil, "tags"),
      }
    `),
  ).toEqual({
    tagsSpace: ["project", "glossary"],
    tagsComma: ["project", "glossary", "idea"],
    tagsList: ["project", "#glossary"],
    identities: ["alice", "@bob", "[[Person/Carol]]"],
    aliases: ["Apollo", "Moon shot"],
    aliasList: ["Moon shot"],
    absent: 0,
  });
});

test("listValue keeps the YAML shape of the value it replaces", async () => {
  expect(
    await lua(`
      local v = objectForm.listValue
      out = {
        space = v({ "project", "glossary", "idea" }, "project glossary", "tags"),
        comma = v({ "project", "idea" }, "project, glossary", "tags"),
        list = v({ "project", "idea" }, { "project" }, "tags"),
        absent = v({ "project", "glossary" }, nil, "tags"),
        identities = v({ "alice", "bob" }, nil, "identities"),
        aliases = v({ "Apollo", "Moon shot" }, "Apollo", "strings"),
        aliasList = v({ "Moon shot" }, nil, "strings"),
        empty = v({}, "project", "tags") or "removed",
      }
    `),
  ).toEqual({
    space: "project glossary idea",
    comma: "project, idea",
    list: ["project", "idea"],
    absent: "project glossary",
    identities: "alice bob",
    aliases: "Apollo, Moon shot",
    aliasList: ["Moon shot"],
    empty: "removed",
  });
});

test("customNameProblem refuses name, existing and computed attributes", async () => {
  expect(
    await lua(`
      local shown = { status = true }
      local function p(k) return objectForm.customNameProblem(k, shown) or "ok" end
      out = { p("name"), p("status"), p("created"), p("lastModified"), p("perm"), p("rating") }
    `),
  ).toEqual([
    "name is the page name, it can't be set",
    "status already exists",
    "created is computed by the index, it can't be set",
    "lastModified is computed by the index, it can't be set",
    "perm is computed by the index, it can't be set",
    "ok",
  ]);
});

test("typeOptions keeps failed conversions in place with the reason", async () => {
  const options = await lua(`out = objectForm.typeOptions("abc", "string")`);
  expect(options.map((o: any) => [o.name, o.description ?? ""])).toEqual([
    ["string", "current type"],
    ["number", "can't convert: not a number"],
    ["boolean", "can't convert: not true or false"],
    ["date", "can't convert: not a YYYY-MM-DD date"],
    ["ref", ""],
    ["string[]", ""],
    ["ref[]", ""],
    ["remove", "Delete this attribute"],
  ]);
});

test("attributeSuggestions lists absent tag properties, then root page properties", async () => {
  const options = await lua(`
    out = objectForm.attributeSuggestions(
      { name = "Projects/Apollo/Launch", tags = { "milestone" } },
      { tags = true, budget = true }
    )
  `);
  expect(
    options.map((o: any) => [o.name, o.description, o.hint ?? ""]),
  ).toEqual([
    ["owner", "ref → #person", "#milestone"],
    ["aliases", "string[]", "page"],
    ["authors", "identity[]", "page"],
    ["displayName", "string", "page"],
    ["recipients", "identity[]", "page"],
  ]);
});

const bob = `
  bob = {
    name = "Bob",
    email = "bob@example.com",
    ref = "Contacts@40",
    tag = "contact",
    tags = {},
    page = "Contacts",
  }
  bobCtx = {
    kind = "data",
    values = { name = "Bob", email = "bob@example.com" },
    types = { name = "string", email = "string" },
    keys = { "name", "email" },
    readOnly = false,
  }
`;

test("rows of a data object come from its tag's schema; name is an ordinary key", async () => {
  expect(
    await lua(`
      ${bob}
      out = {}
      for _, r in ipairs(objectForm.rows(bob, bobCtx)) do
        table.insert(out, r.key .. ":" .. r.kind .. ":" .. tostring(r.value))
      end
    `),
  ).toEqual([
    "name:string:Bob",
    "email:string:bob@example.com",
    "role:enum:nil",
  ]);
});

test("a data object's computed keys are locked by the data schema", async () => {
  expect(
    await lua(`
      local rows = objectForm.rows(
        { tag = "contact", tags = {}, page = "Contacts", name = "Bob" },
        {
          kind = "data",
          values = { page = "Elsewhere", name = "Bob" },
          types = { page = "string", name = "string" },
          keys = { "page", "name" },
        }
      )
      out = {}
      for _, r in ipairs(rows) do table.insert(out, r.key .. ":" .. tostring(r.locked or false)) end
    `),
  ).toEqual(["page:true", "name:false", "email:false", "role:false"]);
});

test("attributeSuggestions for a data object offers its tag's and the data tag's properties", async () => {
  const options = await lua(`
    ${bob}
    out = objectForm.attributeSuggestions(bob, { name = true, email = true }, "data")
  `);
  expect(
    options.map((o: any) => [o.name, o.description, o.hint ?? ""]),
  ).toEqual([
    ["role", "enum", "#contact"],
    // Sorted by name: $ sorts first
    ["$ref", "string", "data"],
    ["tags", "tag[]", "data"],
  ]);
});

test("customNameProblem for a data object allows name and refuses index keys", async () => {
  expect(
    await lua(`
      local function p(k) return objectForm.customNameProblem(k, {}, "data") or "ok" end
      out = { p("name"), p("ref"), p("page"), p("tag"), p("rating") }
    `),
  ).toEqual([
    "ok",
    "ref is computed by the index, it can't be set",
    "page is computed by the index, it can't be set",
    "tag is computed by the index, it can't be set",
    "ok",
  ]);
});

test("write goes through ctx.set and ctx.remove, never object.update", async () => {
  expect(
    await lua(`
      local calls = {}
      local ctx = {
        set = function(k, v) table.insert(calls, "set " .. k .. "=" .. tostring(v)) end,
        remove = function(k) table.insert(calls, "remove " .. k) end,
      }
      object = { update = function() error("object.update called") end }
      objectForm.write(ctx, "email", "bob@example.org")
      objectForm.write(ctx, "email", "")
      objectForm.write(ctx, "note", "", true)
      objectForm.write(ctx, "role", nil)
      objectForm.write(ctx, "tags", nil, true)
      out = calls
    `),
  ).toEqual([
    "set email=bob@example.org",
    "remove email",
    "set note=",
    "remove role",
    "set tags=nil",
  ]);
});

test("write reports a failed ctx.set and returns false", async () => {
  expect(
    await lua(`
      local flashed
      editor = { flashNotification = function(msg) flashed = msg end }
      local ok = objectForm.write({
        set = function() error("object moved") end,
      }, "email", "x")
      out = { ok = ok, flashed = flashed ~= nil and flashed:find("object moved", 1, true) ~= nil }
    `),
  ).toEqual({ ok: false, flashed: true });
});

test("isoDateProblem accepts only real YYYY-MM-DD dates", async () => {
  expect(
    await lua(`
      local function p(t) return widgets.inputDate.isoDateProblem(t) or "ok" end
      out = {
        p("2026-12-15"),
        p("2028-02-29"),
        p("2026-02-29"),
        p("2026-13-40"),
        p("2026-04-31"),
        p("2026-1-5"),
        p("15.12.2026"),
        p(""),
      }
    `),
  ).toEqual([
    "ok",
    "ok",
    "There is no day 29 in 2026-02",
    "There is no month 13",
    "There is no day 31 in 2026-04",
    "Use YYYY-MM-DD",
    "Use YYYY-MM-DD",
    "Use YYYY-MM-DD",
  ]);
});

test("a date row's type menu refuses string with a reason", async () => {
  const options = await lua(
    `out = objectForm.typeOptions("2026-12-01", "date")`,
  );
  const byName = Object.fromEntries(options.map((o: any) => [o.name, o]));
  expect(byName.date.current).toBe(true);
  expect(byName.string.reason).toBe(
    "ISO dates are detected automatically — declare schema.string() to keep it as text",
  );
  expect(byName["string[]"].reason).toBeUndefined();
});

test("pickedAttribute takes a suggestion's key or a typed new name", async () => {
  expect(
    await lua(`
      local shown = { status = true }
      local function p(picked, kind)
        local added, problem = objectForm.pickedAttribute(picked, shown, kind)
        if problem then return "problem: " .. problem end
        if not added then return "nothing" end
        return added.key .. (added.custom and " (new)" or "")
      end
      out = {
        p({ name = "owner", key = "owner" }),
        p({ name = "  rating ", hint = "Add", isNew = true }),
        p({ name = "rating", isNew = true }),
        p({ name = "status", isNew = true }),
        p({ name = "name", isNew = true }),
        p({ name = "name", isNew = true }, "data"),
        p({ name = "created", isNew = true }),
        p({ name = "   ", isNew = true }),
      }
    `),
  ).toEqual([
    "owner",
    "rating (new)",
    "rating (new)",
    "problem: status already exists",
    "problem: name is the page name, it can't be set",
    "name (new)",
    "problem: created is computed by the index, it can't be set",
    "nothing",
  ]);
});

test("rowMenuItems: type header, moves disabled at the ends, Change type only without a schema", async () => {
  const menu = await lua(`
    local function view(items)
      local out = {}
      for _, i in ipairs(items) do
        if i.header then table.insert(out, "# " .. i.header)
        elseif i.separator then table.insert(out, "---")
        else
          table.insert(out, i.label .. (i.disabled and (" [" .. i.reason .. "]") or ""))
        end
      end
      return out
    end
    out = {
      first = view(objectForm.rowMenuItems(
        { key = "rating", kind = "string", schema = schema.string() },
        { position = 1, count = 3 })),
      middle = view(objectForm.rowMenuItems(
        { key = "owner", kind = "ref", schema = schema.ref("person"), fromSchema = true },
        { position = 2, count = 3 })),
      last = view(objectForm.rowMenuItems(
        { key = "members", kind = "refs", schema = schema.array(schema.ref("person")) },
        { position = 3, count = 3 })),
      tags = view(objectForm.rowMenuItems(
        { key = "tags", kind = "tags", schema = schema.tags(), fromSchema = true },
        { count = 3 })),
      pending = view(objectForm.rowMenuItems(
        { key = "codename", kind = "string", schema = schema.string() },
        { pending = true, count = 3 })),
      locked = view(objectForm.rowMenuItems(
        { key = "created", kind = "string", schema = schema.string(), fromSchema = true, locked = true },
        { position = 2, count = 3 })),
      unknown = view(objectForm.rowMenuItems(
        { key = "nested", kind = "unknown", schema = {} },
        { position = 2, count = 3 })),
    }
  `);
  expect(menu.first).toEqual([
    "# string",
    "Move up [Already first]",
    "Move down",
    "Change type…",
    "---",
    "Delete",
  ]);
  expect(menu.middle).toEqual([
    "# ref → #person",
    "Move up",
    "Move down",
    "---",
    "Delete",
  ]);
  expect(menu.last).toEqual([
    "# ref[] → #person",
    "Move up",
    "Move down [Already last]",
    "Change type…",
    "---",
    "Delete",
  ]);
  expect(menu.tags).toEqual([
    "# tag[]",
    "Move up [tags is always shown first]",
    "Move down [tags is always shown first]",
    "---",
    "Delete",
  ]);
  expect(menu.pending).toEqual([
    "# string",
    "Move up [Give it a value first]",
    "Move down [Give it a value first]",
    "---",
    "Delete",
  ]);
  expect(menu.locked.at(-1)).toBe(
    "Delete [Computed by the index; edit in source]",
  );
  expect(menu.unknown[0]).toBe("Move up");
});

test("cycleIndex wraps and starts from either end", async () => {
  expect(
    await lua(`
      local c = widgets.inputMenus.cycleIndex
      out = { c(0, 3, 1), c(0, 3, -1), c(3, 3, 1), c(1, 3, -1), c(2, 3, 1), c(0, 0, 1) }
    `),
  ).toEqual([1, 3, 1, 3, 3, 0]);
});

test("linkSegments cuts text into plain runs and links", async () => {
  expect(
    await lua(`
      out = {
        widgets.inputCompletion.linkSegments("see [[Person/Alice]] and [[B|bee]], [[$t1]]."),
        widgets.inputCompletion.linkSegments("no links, [[]] or [[ open"),
        widgets.inputCompletion.hasLinks("x [[A]]"),
        widgets.inputCompletion.hasLinks("x [[ y"),
      }
    `),
  ).toEqual([
    [
      { text: "see " },
      {
        link: "[[Person/Alice]]",
        target: "Person/Alice",
        label: "Person/Alice",
      },
      { text: " and " },
      { link: "[[B|bee]]", target: "B", label: "bee" },
      { text: ", " },
      { link: "[[$t1]]", target: "$t1", label: "$t1" },
      { text: "." },
    ],
    [{ text: "no links, [[]]" }, { text: " or [[ open" }],
    true,
    false,
  ]);
});

test("linkPrefix finds an unclosed [[ before the caret; insertLink completes it", async () => {
  expect(
    await lua(`
      local p = widgets.inputCompletion.linkPrefix
      local function ins(text, caret)
        local prefix = p(text, caret)
        local t, c = widgets.inputCompletion.insertLink(text, caret, prefix, "[[Person/Bob]]")
        return { text = t, caret = c }
      end
      out = {
        p("see [[Per", 9),
        p("see [[", 6),
        p("see [[A]] x", 11) or "none",
        p("see [[A", 4) or "none",
        p("a [[b\\nc", 7) or "none",
        ins("see [[Per", 9),
        ins("see [[Per]] later", 9),
        ins("x [[ y", 4),
        ins("a [[Person]] b", 6),
        ins("a [[Foo|ali]] b", 7),
        p("a [[Foo|al", 10) or "none",
        ins("a [[Foo]] then [[x]]", 5),
      }
    `),
  ).toEqual([
    { start: 4, typed: "Per" },
    { start: 4, typed: "" },
    "none",
    "none",
    "none",
    { text: "see [[Person/Bob]]", caret: 18 },
    { text: "see [[Person/Bob]] later", caret: 18 },
    { text: "x [[Person/Bob]] y", caret: 16 },
    { text: "a [[Person/Bob]] b", caret: 16 },
    { text: "a [[Person/Bob|ali]] b", caret: 20 },
    "none",
    { text: "a [[Person/Bob]] then [[x]]", caret: 16 },
  ]);
});

test("Enter commits, Shift+Enter is a newline, composing does nothing", async () => {
  expect(
    await lua(`
      local a = widgets.inputText.enterAction
      out = {
        a({ key = "Enter" }),
        a({ key = "Enter", shiftKey = true }),
        a({ key = "Enter", isComposing = true }) or "none",
        a({ key = "a" }) or "none",
      }
    `),
  ).toEqual(["commit", "newline", "none", "none"]);
});

test("every public input function has a doc block, private helpers have none", async () => {
  const blocks = (await inputLibrary()).map((code) => parseBlock(code));
  const publicNames: string[] = [];
  const undocumented: string[] = [];
  const documentedPrivate: string[] = [];
  for (const statement of blocks.flatMap(
    (block) => block.statements,
  ) as any[]) {
    const fn = statement.body;
    if (!fn) continue;
    if (statement.type === "Function") {
      const full = statement.name.propNames.join(".");
      publicNames.push(full);
      const docs = fn.documentation;
      if (!docs?.description || !docs.parameters?.length || !docs.see) {
        undocumented.push(full);
      }
    } else if (statement.type === "LocalFunction" && fn.documentation) {
      documentedPrivate.push(statement.name);
    }
  }
  expect(publicNames.sort()).toEqual(
    [
      "booleanInput",
      "chipsInput",
      "dateInput",
      "identitiesInput",
      "listInput",
      "menu",
      "numberInput",
      "openMenu",
      "refInput",
      "refListInput",
      "schemaInput",
      "selectInput",
      "tagsInput",
      "textInput",
    ].map((n) => `widgets.${n}`),
  );
  expect(undocumented).toEqual([]);
  expect(documentedPrivate).toEqual([]);
});

test("refOption offers pages and anchored objects, not position refs", async () => {
  expect(
    await lua(`
      local function o(obj) return widgets.inputCompletion.refOption(obj) or "none" end
      out = {
        o({ tag = "page", name = "Person/Bob", ref = "Person/Bob" }),
        o({ tag = "task", ref = "launch", page = "Projects/Apollo" }),
        o({ tag = "anchor", ref = "alice", page = "People", hostTag = "item" }),
        o({ tag = "task", ref = "Projects/Apollo@42", page = "Projects/Apollo" }),
      }
    `),
  ).toEqual([
    { name: "Person/Bob", link: "[[Person/Bob]]" },
    {
      name: "$launch",
      description: "task on Projects/Apollo",
      link: "[[$launch]]",
    },
    { name: "$alice", description: "item on People", link: "[[$alice]]" },
    "none",
  ]);
});

test("filterOptions puts prefix matches first, skips taken values, limits, ignores case", async () => {
  expect(
    await lua(`
      local options = {
        { value = "glossary" }, { value = "project" }, { value = "projection" },
        { value = "subproject" }, { value = "Prototype", label = "Prototype" },
      }
      local function names(list)
        local r = {}
        for _, o in ipairs(list) do table.insert(r, o.value) end
        return r
      end
      local f = widgets.inputCompletion.filterOptions
      out = {
        names(f(options, "pro", { project = true })),
        names(f(options, "PRO", {}, nil, 2)),
        names(f(options, "", {})),
        names(f({ { value = "tags", label = "#tags" }, { value = "tag", label = "#tag" } }, "tag", {})),
      }
    `),
  ).toEqual([
    ["projection", "Prototype", "subproject"],
    ["project", "projection"],
    ["glossary", "project", "projection", "subproject", "Prototype"],
    ["tag", "tags"],
  ]);
});

test("uniqueTagNames keeps one sorted name per tag", async () => {
  expect(
    await lua(`
      out = widgets.inputCompletion.uniqueTagNames({
        { tag = "tag", name = "project" },
        { tag = "tag", name = "glossary" },
        { tag = "tag", name = "project" },
        { tag = "tag", name = "draft", inComment = true },
        { tag = "page", name = "Projects/Apollo" },
      })
    `),
  ).toEqual(["glossary", "project"]);
});
