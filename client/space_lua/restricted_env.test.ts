import { expect, test } from "vitest";
import { createRestrictedEnv } from "./restricted_env.ts";
import { syntheticSpace } from "./restricted_env_test_util.ts";
import { spaceReadSyscalls } from "../plugos/syscalls/space.ts";
import type { Client } from "../client.ts";

const examples: [string, string, unknown][] = [
  ["arithmetic", "return math.floor(10 / 3)", 3],
  ["string methods", 'return ("Maple"):upper()', "MAPLE"],
  [
    "read page",
    'return space.readPage("Notes/Maple")',
    "# Maple\nA short note.",
  ],
  [
    "custom helper",
    'local function title(name) return string.match(space.readPage(name), "# (%w+)") end return title("Notes/Cedar")',
    "Cedar",
  ],
  [
    "loops and private mutation",
    "local total = 0; for _, p in ipairs(index.pages()) do total = total + p.size end return total",
    51,
  ],
  [
    "sort and callbacks",
    "local rows = index.pages(); table.sort(rows, function(a,b) return a.name < b.name end); return rows[1].name",
    "Notes/Cedar",
  ],
  [
    "query",
    "return query[[from p = index.pages() where p.size > 25 select p.name]]",
    ["Notes/Cedar"],
  ],
  [
    "pairs",
    "local n = 0; for k,v in pairs({a=1,b=2}) do n = n + v end return n",
    3,
  ],
  [
    "pattern iterator",
    'local out = {}; for word in string.gmatch("a b", "%w+") do table.insert(out, word) end return table.concat(out, ",")',
    "a,b",
  ],
  [
    "local metamethod",
    'local t = setmetatable({}, {__index = function(_, k) return k .. "!" end}); return t.ok',
    "ok!",
  ],
  [
    "protected errors",
    'local ok = pcall(function() error("example") end); return ok',
    false,
  ],
  [
    "detached rows",
    'local rows = index.pages(); rows[1].name = "changed"; return index.pages()[1].name',
    "Notes/Maple",
  ],
];

test.each(examples)("useful: %s", async (_name, code, expected) => {
  const space = syntheticSpace();
  expect(await createRestrictedEnv(space.apis).run(code)).toEqual(expected);
  expect(space.writes()).toBe(0);
});

const attacks = [
  'return rawget(1.0, "constructor")',
  'return rawget(1.0, "__proto__")',
  "return setmetatable(1.0, {})",
  "return getmetatable(1.0)",
  'return space.writePage("Notes/Maple", "destroyed")',
  'local f = space.writePage; return f("Notes/Maple", "destroyed")',
  'local function helper() return space.writePage("Notes/Maple", "destroyed") end return helper()',
  'local t = setmetatable({}, {__index = function() space.writePage("Notes/Maple", "destroyed") end}); return t.x',
  'return ("probe").constructor.constructor("return globalThis")()',
  'return ({}).constructor.constructor("return globalThis")()',
  "return type.fn",
  "return (function() end).capturedEnv",
  "return js.window",
  'return load("return 1")()',
  'return lua.evalExpression("space.writePage()")',
  'return net.request("https://example.invalid")',
  "return future.api()",
  "return function() return 1 end",
  "return setmetatable({}, {__index = function() return 1 end})",
  "local t = {}; t.self = t; return t",
  "type.fn = function() end",
  'return string.rep("x", 100001)',
];

test.each(attacks)("rejects: %s", async (code) => {
  const space = syntheticSpace();
  const before = JSON.stringify(space.pages);
  await expect(createRestrictedEnv(space.apis).run(code)).rejects.toThrow();
  expect(space.writes()).toBe(0);
  expect(JSON.stringify(space.pages)).toBe(before);
});

test("pcall cannot make the blocked implementation run", async () => {
  const space = syntheticSpace();
  expect(
    await createRestrictedEnv(space.apis).run(
      'return pcall(function() space.writePage("Notes/Maple", "changed") end)',
    ),
  ).toBe(false);
  expect(space.writes()).toBe(0);
});

test("fresh environments do not share API tables", async () => {
  await createRestrictedEnv().run("math.abs = nil; _G.changed = true");
  expect(await createRestrictedEnv().run("return math.abs(-3)")).toBe(3);
  expect(await createRestrictedEnv().run("return changed")).toBeNull();
});

test("API results reject getters without invoking them", async () => {
  let calls = 0;
  const run = createRestrictedEnv({
    "read.value": {
      capabilities: [],
      callback: () => ({
        get secret() {
          calls++;
          return 1;
        },
      }),
    },
  });
  await expect(run.run("return read.value()")).rejects.toThrow("accessor");
  expect(calls).toBe(0);
});

test("API inputs reject callbacks before invoking native code", async () => {
  let calls = 0;
  const run = createRestrictedEnv({
    "read.value": {
      capabilities: [],
      callback: () => {
        calls++;
      },
    },
  });
  await expect(run.run("return read.value(function() end)")).rejects.toThrow(
    "non-data",
  );
  expect(calls).toBe(0);
});

test("LIMITATION: a dishonest native annotation can mutate host state", async () => {
  let writes = 0;
  const run = createRestrictedEnv({
    "dishonest.read": {
      capabilities: ["space:read"],
      callback: () => {
        writes++;
        return "oops";
      },
    },
  });
  expect(await run.run("return dishonest.read()")).toBe("oops");
  expect(writes).toBe(1);
});

test("cooperative budget stops a Lua loop", async () => {
  await expect(createRestrictedEnv().run("while true do end")).rejects.toThrow(
    "stopped",
  );
});

test("table prototype names are inert data", async () => {
  expect(
    await createRestrictedEnv().run(
      'local t = {}; rawset(t, "__proto__", {x=9}); return t.x',
    ),
  ).toBeNull();
});

test("a private __pairs iterator still works without granting native authority", async () => {
  expect(
    await createRestrictedEnv().run(
      "local n=0; local t=setmetatable({}, {__pairs=function() local i=0; return function() i=i+1; if i<=2 then return i, 3 end end end}); for k,v in pairs(t) do n=n+v end return n",
    ),
  ).toBe(6);
});

test("nested tostring must not lose the safe policy", async () => {
  await expect(
    createRestrictedEnv().run(
      `return tostring({setmetatable({}, {__tostring = function() return ("probe").constructor.constructor("return typeof globalThis")() end})})`,
    ),
  ).rejects.toThrow("lost its policy");
});

test("gsub conversion must not lose the safe policy", async () => {
  await expect(
    createRestrictedEnv().run(
      `return string.gsub("x", ".", function() return setmetatable({}, {__tostring = function() return ("probe").constructor.constructor("return typeof globalThis")() end}) end)`,
    ),
  ).rejects.toThrow("lost its policy");
});

test.each(["local function escape()", "function escape()"])(
  "named callback preserves policy: %s",
  async (declaration) => {
    await expect(
      createRestrictedEnv().run(
        `${declaration} return ("probe").constructor.constructor("return typeof globalThis")() end return tostring({setmetatable({}, {__tostring=escape})})`,
      ),
    ).rejects.toThrow("lost its policy");
  },
);

test("real space read syscall implementations work through annotated adapters", async () => {
  const fixture = syntheticSpace();
  const client = {
    space: {
      readPage: async (name: string) => ({
        text: fixture.pages[name],
        meta: { name },
      }),
      fetchPageList: async () => fixture.rows,
      getPageMeta: async (name: string) => ({ name }),
    },
  } as unknown as Client;
  const syscalls = spaceReadSyscalls(client);
  const apis = Object.fromEntries(
    [
      "space.readPage",
      "space.listPages",
      "space.getPageMeta",
      "space.readPageWithMeta",
    ].map((name) => {
      const registration = syscalls[name];
      const callback =
        typeof registration === "function"
          ? registration
          : registration.callback;
      return [
        name,
        {
          capabilities: ["space:read" as const],
          callback: (...args: any[]) => callback({}, ...args),
        },
      ];
    }),
  );
  expect(
    await createRestrictedEnv(apis).run(
      'return space.readPageWithMeta("Notes/Cedar").meta.name',
    ),
  ).toBe("Notes/Cedar");
  expect(await createRestrictedEnv(apis).run("return #space.listPages()")).toBe(
    2,
  );
  expect(
    await createRestrictedEnv(apis).run(
      'return space.getPageMeta("Notes/Maple").name',
    ),
  ).toBe("Notes/Maple");
});

test.each([
  ['return table.includes({"work", "home"}, "work")', true],
  ['return ("Notebook"):startsWith("Note")', true],
  [
    'return table.find({"page", "data"}, function(t) return t == "data" end)',
    2,
  ],
  ['return table.select({name="Notebook", size=3}, "name").name', "Notebook"],
  ['return #os.date("%Y-%m-%d")', 10],
  [
    'return query[[from r = {{kind="a",n=1},{kind="a",n=3}} group by r.kind select {kind=r.kind, total=sum(r.n), count=count()}]]',
    [{ kind: "a", total: 4, count: 2 }],
  ],
])("Workbench query building block: %s", async (code, expected) => {
  expect(
    await createRestrictedEnv()
      .run(code as string)
      .catch((e) => e.message),
  ).toEqual(expected);
});

test("null aggregate results retain SQL null", async () => {
  expect(
    await createRestrictedEnv()
      .run('return query[[from r = {{name="Empty"}} select {total=sum(r.n)}]]')
      .catch((e) => e.message),
  ).toEqual([{ total: null }]);
});

test("custom query templates keep interpolation restricted", async () => {
  const context = createRestrictedEnv();
  expect(
    await context
      .run('return template.new[==[    * [[${name}]]]==]({name="Notebook"})')
      .catch((e) => e.message),
  ).toBe("* [[Notebook]]");
  await expect(
    context.run("return template.new[==[${js.window}]==]({})"),
  ).rejects.toThrow();
});
