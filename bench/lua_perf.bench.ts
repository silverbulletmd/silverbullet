// Focused micro-benchmarks for Space Lua interpreter performance.
// Benchmarks are weighted toward the real SilverBullet workload:
//   ~40% API/syscall patterns (LuaNativeJSFunction, LuaBuiltinFunction)
//   ~30% data structure traversal (tables, linked structures, iteration)
//   ~15% string manipulation (format, find, split, concat, interpolation)
//   ~15% function calls, closures, control flow
//
// Each snippet is pre-parsed to exclude parsing cost from measurements.
// All benchmarks create fresh Lua environments for isolation.

import { bench } from "vitest";
import { evalStatement } from "../client/space_lua/eval.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaNativeJSFunction,

  LuaStackFrame,
  LuaTable,
  luaTypeOf,
} from "../client/space_lua/runtime.ts";
import { parse as parseLua } from "../client/space_lua/parse.ts";
import { luaBuildStandardEnv } from "../client/space_lua/stdlib.ts";

const LOOP = 100_000;
const SMALL = 10_000;

// --- Helpers ---

function makeMinimalEnv(): { global: LuaEnv; sf: LuaStackFrame } {
  const global = new LuaEnv();
  global.setLocal("type", new LuaBuiltinFunction((_sf, v) => luaTypeOf(v)));
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  return { global, sf };
}

function makeStdEnv(): { global: LuaEnv; sf: LuaStackFrame } {
  const G = luaBuildStandardEnv();
  const env = new LuaEnv(G);
  const sf = LuaStackFrame.createWithGlobalEnv(env);
  return { global: env, sf };
}

async function runMinimal(ast: any) {
  const { global, sf } = makeMinimalEnv();
  const r = evalStatement(ast, global, sf, false);
  if (r instanceof Promise) await r;
}

async function runStd(ast: any) {
  const { global, sf } = makeStdEnv();
  const r = evalStatement(ast, global, sf, false);
  if (r instanceof Promise) await r;
}

// Environment with sync/async API stubs simulating real syscall patterns
function makeApiEnv(): { global: LuaEnv; sf: LuaStackFrame } {
  const G = luaBuildStandardEnv();
  const env = new LuaEnv(G);

  // Simulate sync API call (like space.readPage returning cached data)
  env.setLocal(
    "syncGet",
    new LuaBuiltinFunction((_sf, key) => `value_for_${key}`),
  );

  // Simulate async API call (like space.readPage hitting storage)
  env.setLocal(
    "asyncGet",
    new LuaNativeJSFunction((key: string) =>
      Promise.resolve(`value_for_${key}`)
    ),
  );

  // Simulate sync API returning a table (like space.listPages)
  env.setLocal(
    "syncGetRecord",
    new LuaBuiltinFunction((_sf, id: number) => {
      const t = new LuaTable();
      void t.set("id", id);
      void t.set("name", `item_${id}`);
      void t.set("tags", (() => {
        const tags = new LuaTable();
        void tags.set(1, "tag_a");
        void tags.set(2, "tag_b");
        return tags;
      })());
      return t;
    }),
  );

  // Simulate async API returning a table
  env.setLocal(
    "asyncGetRecord",
    new LuaNativeJSFunction((id: number) =>
      Promise.resolve({ id, name: `item_${id}`, tags: ["tag_a", "tag_b"] })
    ),
  );

  // Simulate sync predicate API (like checking config)
  env.setLocal(
    "syncCheck",
    new LuaBuiltinFunction((_sf, val) => val !== null && val !== undefined),
  );

  // Simulate async write API (like space.writePage)
  env.setLocal(
    "asyncSet",
    new LuaNativeJSFunction((_key: string, _value: string) =>
      Promise.resolve(true)
    ),
  );

  const sf = LuaStackFrame.createWithGlobalEnv(env);
  return { global: env, sf };
}

async function runApi(ast: any) {
  const { global, sf } = makeApiEnv();
  const r = evalStatement(ast, global, sf, false);
  if (r instanceof Promise) await r;
}

// =====================================================
// 1. API Call Patterns (sync and async)
//    The primary workload in SilverBullet: Lua scripts
//    call into TypeScript APIs via LuaNativeJSFunction
//    and LuaBuiltinFunction.
// =====================================================

const API_LOOP = 1_000;

const luaSyncApiCalls = `
  local results = {}
  for i = 1, ${API_LOOP} do
    results[i] = syncGet("key_" .. i)
  end
`;

const luaAsyncApiCalls = `
  local results = {}
  for i = 1, ${API_LOOP} do
    results[i] = asyncGet("key_" .. i)
  end
`;

const luaMixedApiCalls = `
  local results = {}
  for i = 1, ${API_LOOP} do
    if i % 10 == 0 then
      results[i] = asyncGet("key_" .. i)
    else
      results[i] = syncGet("key_" .. i)
    end
  end
`;

// Simulate query-like pattern: fetch record, filter, collect
const luaApiFilterCollect = `
  local results = {}
  local count = 0
  for i = 1, ${API_LOOP} do
    local rec = syncGetRecord(i)
    if rec.id % 3 == 0 then
      count = count + 1
      results[count] = rec
    end
  end
`;

// Async record fetch with field access and filtering
const luaAsyncApiFilterCollect = `
  local results = {}
  local count = 0
  for i = 1, ${API_LOOP} do
    local rec = asyncGetRecord(i)
    if syncCheck(rec.name) then
      count = count + 1
      results[count] = rec
    end
  end
`;

// Chained async calls (read then write pattern)
const luaAsyncChainedCalls = `
  for i = 1, ${API_LOOP} do
    local val = asyncGet("key_" .. i)
    asyncSet("out_" .. i, val .. "_processed")
  end
`;

// Sync API with table construction (building query results)
const luaSyncApiTableBuild = `
  local results = {}
  for i = 1, ${API_LOOP} do
    local name = syncGet("name_" .. i)
    local status = syncGet("status_" .. i)
    results[i] = { name = name, status = status, index = i }
  end
`;

// =====================================================
// 2. Data Structure Traversal
//    Tables are the core data type in Space Lua.
//    Queries produce tables, configs are tables,
//    page metadata is tables.
// =====================================================

const luaTableConstructor = `
  local tables = {}
  for i = 1, ${SMALL} do
    tables[i] = { x = i, y = i * 2, z = "tag_" .. i }
  end
`;

const luaTableInsertLoop = `
  local t = {}
  for i = 1, ${LOOP} do
    t[#t + 1] = i
  end
`;

const luaIpairsIteration = `
  local t = {}
  for i = 1, 1000 do t[i] = i end
  local s = 0
  for round = 1, 100 do
    for _, v in ipairs(t) do
      s = s + v
    end
  end
`;

const luaPairsIteration = `
  local t = {}
  for i = 1, 100 do t["key" .. i] = i end
  local s = 0
  for round = 1, 1000 do
    for k, v in pairs(t) do
      s = s + v
    end
  end
`;

// Nested table access (common in page metadata traversal)
const luaNestedTableAccess = `
  local pages = {}
  for i = 1, 200 do
    pages[i] = {
      name = "page_" .. i,
      meta = { tags = { "tag1", "tag2" }, priority = i % 5 }
    }
  end
  local count = 0
  for _, page in ipairs(pages) do
    if page.meta.priority > 2 then
      for _, tag in ipairs(page.meta.tags) do
        count = count + 1
      end
    end
  end
`;

// Table used as a map: insert, lookup, delete
const luaTableAsMap = `
  local map = {}
  for i = 1, 5000 do
    map["key_" .. i] = "value_" .. i
  end
  local found = 0
  for i = 1, 5000 do
    if map["key_" .. i] ~= nil then
      found = found + 1
    end
  end
  for i = 1, 5000, 2 do
    map["key_" .. i] = nil
  end
`;

// Linked list traversal (common pattern for tree/graph data)
const luaLinkedList = `
  local head = nil
  for i = 1000, 1, -1 do
    head = { value = i, next = head }
  end
  local total = 0
  for round = 1, 100 do
    local node = head
    while node do
      total = total + node.value
      node = node.next
    end
  end
`;

// table.sort with custom comparator (query ORDER BY)
const luaTableSort = `
  local items = {}
  for i = 1, 1000 do
    items[i] = { name = "item_" .. (1000 - i), priority = i % 7 }
  end
  for round = 1, 20 do
    table.sort(items, function(a, b)
      if a.priority == b.priority then
        return a.name < b.name
      end
      return a.priority < b.priority
    end)
  end
`;

// table.concat (building output strings)
const luaTableConcat = `
  local parts = {}
  for i = 1, 1000 do
    parts[i] = "segment_" .. i
  end
  local result
  for round = 1, 100 do
    result = table.concat(parts, ", ")
  end
`;

// =====================================================
// 3. String Manipulation
//    Template interpolation, string matching, and
//    building output are core SilverBullet patterns.
// =====================================================

const luaStringFormat = `
  local s
  for i = 1, ${SMALL} do
    s = string.format("hello %s world %d", "test", i)
  end
`;

const luaStringFind = `
  local text = "the quick brown fox jumps over the lazy dog"
  local count = 0
  for i = 1, ${SMALL} do
    if string.find(text, "fox") then
      count = count + 1
    end
  end
`;

const luaStringSub = `
  local text = "abcdefghijklmnopqrstuvwxyz"
  local s
  for i = 1, ${LOOP} do
    s = string.sub(text, 5, 15)
  end
`;

// String concatenation building (template-like patterns)
const luaStringConcat = `
  local result = ""
  for i = 1, 1000 do
    result = result .. "item " .. i .. ", "
  end
`;

// String split + rejoin (common in tag processing)
const luaStringSplitProcess = `
  local input = "tag1,tag2,tag3,tag4,tag5"
  local results = {}
  for round = 1, 2000 do
    local parts = string.split(input, ",")
    local upper = {}
    for i, v in ipairs(parts) do
      upper[i] = string.upper(v)
    end
    results[round] = table.concat(upper, ";")
  end
`;

// String matching (regex-like patterns in content processing)
const luaStringGsub = `
  local text = "Hello [world](link1) and [foo](link2) and [bar](link3)"
  local result
  for i = 1, 5000 do
    result = string.gsub(text, "%[(.-)%]%((.-)%)", "%1")
  end
`;

// =====================================================
// 4. Function Calls, Closures, Control Flow
//    Function call overhead matters because every API
//    call, iterator, and callback goes through luaCall.
// =====================================================

const luaFibonacci = `
  local function fib(n)
    if n < 2 then return n end
    return fib(n - 1) + fib(n - 2)
  end
  local r = fib(20)
`;

const luaClosureCreateCall = `
  local s = 0
  for i = 1, ${SMALL} do
    local function add(x) return x + i end
    s = s + add(i)
  end
`;

const luaMethodCall = `
  local obj = {}
  obj.value = 0
  function obj:inc(n)
    self.value = self.value + n
  end
  for i = 1, ${LOOP} do
    obj:inc(1)
  end
`;

const luaVarargs = `
  local function sum(...)
    local args = {...}
    local s = 0
    for i = 1, #args do
      s = s + args[i]
    end
    return s
  end
  local total = 0
  for i = 1, ${SMALL} do
    total = total + sum(1, 2, 3, 4, 5)
  end
`;

// Higher-order functions (filter/map pattern used in queries)
const luaHigherOrderFunctions = `
  local function filter(t, pred)
    local result = {}
    local n = 0
    for _, v in ipairs(t) do
      if pred(v) then
        n = n + 1
        result[n] = v
      end
    end
    return result
  end
  local function map(t, fn)
    local result = {}
    for i, v in ipairs(t) do
      result[i] = fn(v)
    end
    return result
  end
  local data = {}
  for i = 1, 1000 do data[i] = i end
  for round = 1, 50 do
    local evens = filter(data, function(x) return x % 2 == 0 end)
    local doubled = map(evens, function(x) return x * 2 end)
  end
`;

// =====================================================
// 5. Realistic Mixed Workloads
//    Patterns that combine multiple operations the way
//    real SilverBullet Lua code does.
// =====================================================

// Simulate query: fetch pages, filter by tag, sort, build result
const luaQuerySimulation = `
  local pages = {}
  for i = 1, 500 do
    pages[i] = {
      name = "page_" .. i,
      tags = { "tag_" .. (i % 5) },
      modified = 1000000 - i,
    }
  end
  -- filter: only tag_1 and tag_3
  local filtered = {}
  local n = 0
  for _, p in ipairs(pages) do
    local tag = p.tags[1]
    if tag == "tag_1" or tag == "tag_3" then
      n = n + 1
      filtered[n] = p
    end
  end
  -- sort by modified desc
  table.sort(filtered, function(a, b)
    return a.modified > b.modified
  end)
  -- build output table
  local result = {}
  for i, p in ipairs(filtered) do
    result[i] = { name = p.name, tag = p.tags[1] }
  end
`;

// Simulate config/metadata processing
const luaConfigProcessing = `
  local config = {
    theme = "dark",
    plugins = { "markdown", "lua", "query", "template" },
    shortcuts = {},
  }
  for i = 1, 100 do
    config.shortcuts["ctrl_" .. i] = "action_" .. i
  end
  -- Process: iterate config, build summary string
  local parts = {}
  local n = 0
  for round = 1, 100 do
    n = 0
    for k, v in pairs(config.shortcuts) do
      n = n + 1
      parts[n] = k .. "=" .. v
    end
  end
  local summary = table.concat(parts, "; ")
`;

// Simulate template rendering: string building from structured data
const luaTemplateRendering = `
  local items = {}
  for i = 1, 200 do
    items[i] = { title = "Item " .. i, done = i % 3 == 0, priority = i % 5 }
  end
  local output = {}
  for round = 1, 20 do
    local n = 0
    for _, item in ipairs(items) do
      n = n + 1
      local status = item.done and "x" or " "
      local prio = ""
      if item.priority > 3 then prio = " (!)" end
      output[n] = string.format("- [%s] %s%s", status, item.title, prio)
    end
  end
  local result = table.concat(output, "; ")
`;

// =====================================================
// 6. Async Patterns
//    Async API calls mixed with sync table/string work.
// =====================================================

// Async loop with sync re-entry (the key optimization from Phase 3)
const luaAsyncLoopReentry = `
  local results = {}
  for i = 1, ${API_LOOP} do
    local val = asyncGet("key_" .. i)
    -- sync work between async calls
    results[i] = string.upper(val) .. "_done"
  end
`;

// While loop with async body
const luaAsyncWhileLoop = `
  local i = 0
  local results = {}
  while i < ${API_LOOP} do
    i = i + 1
    results[i] = asyncGet("item_" .. i)
  end
`;

// Async __index metamethod (lazy loading pattern)
const luaAsyncMetamethod = `
  local mt = {}
  mt.__index = function(t, k)
    return asyncGet(k)
  end
  local proxy = setmetatable({}, mt)
  local results = {}
  for i = 1, ${API_LOOP} do
    results[i] = proxy["field_" .. i]
  end
`;

// Async record fetch + sync processing (realistic query pattern)
const luaAsyncQueryPattern = `
  local results = {}
  local count = 0
  for i = 1, ${API_LOOP} do
    local rec = asyncGetRecord(i)
    -- sync filtering and string work
    if syncCheck(rec) then
      count = count + 1
      results[count] = { id = i, label = "item_" .. i }
    end
  end
`;

// =====================================================
// Pre-parse all snippets
// =====================================================

const asts = {
  // API calls
  syncApiCalls: parseLua(luaSyncApiCalls),
  asyncApiCalls: parseLua(luaAsyncApiCalls),
  mixedApiCalls: parseLua(luaMixedApiCalls),
  apiFilterCollect: parseLua(luaApiFilterCollect),
  asyncApiFilterCollect: parseLua(luaAsyncApiFilterCollect),
  asyncChainedCalls: parseLua(luaAsyncChainedCalls),
  syncApiTableBuild: parseLua(luaSyncApiTableBuild),

  // Data structures
  tableConstructor: parseLua(luaTableConstructor),
  tableInsertLoop: parseLua(luaTableInsertLoop),
  ipairsIteration: parseLua(luaIpairsIteration),
  pairsIteration: parseLua(luaPairsIteration),
  nestedTableAccess: parseLua(luaNestedTableAccess),
  tableAsMap: parseLua(luaTableAsMap),
  linkedList: parseLua(luaLinkedList),
  tableSort: parseLua(luaTableSort),
  tableConcat: parseLua(luaTableConcat),

  // Strings
  stringFormat: parseLua(luaStringFormat),
  stringFind: parseLua(luaStringFind),
  stringSub: parseLua(luaStringSub),
  stringConcat: parseLua(luaStringConcat),
  stringSplitProcess: parseLua(luaStringSplitProcess),
  stringGsub: parseLua(luaStringGsub),

  // Functions / control flow
  fibonacci: parseLua(luaFibonacci),
  closureCreateCall: parseLua(luaClosureCreateCall),
  methodCall: parseLua(luaMethodCall),
  varargs: parseLua(luaVarargs),
  higherOrderFunctions: parseLua(luaHigherOrderFunctions),

  // Realistic workloads
  querySimulation: parseLua(luaQuerySimulation),
  configProcessing: parseLua(luaConfigProcessing),
  templateRendering: parseLua(luaTemplateRendering),

  // Async patterns
  asyncLoopReentry: parseLua(luaAsyncLoopReentry),
  asyncWhileLoop: parseLua(luaAsyncWhileLoop),
  asyncMetamethod: parseLua(luaAsyncMetamethod),
  asyncQueryPattern: parseLua(luaAsyncQueryPattern),
};

// =====================================================
// Benchmarks
// =====================================================

// --- API Call Patterns (the primary workload) ---
bench("Perf: sync API calls (1k)", () => runApi(asts.syncApiCalls));
bench("Perf: async API calls (1k)", () => runApi(asts.asyncApiCalls));
bench("Perf: mixed sync/async API calls (1k, 10% async)", () =>
  runApi(asts.mixedApiCalls),
);
bench("Perf: sync API filter+collect (1k records)", () =>
  runApi(asts.apiFilterCollect),
);
bench("Perf: async API filter+collect (1k records)", () =>
  runApi(asts.asyncApiFilterCollect),
);
bench("Perf: async chained read+write (1k)", () =>
  runApi(asts.asyncChainedCalls),
);
bench("Perf: sync API + table construction (1k)", () =>
  runApi(asts.syncApiTableBuild),
);

// --- Data Structure Traversal ---
bench("Perf: table constructor (3 fields, 10k)", () =>
  runMinimal(asts.tableConstructor),
);
bench("Perf: table insert via t[#t+1] (100k)", () =>
  runMinimal(asts.tableInsertLoop),
);
bench("Perf: ipairs iteration (1000 elems x100)", () =>
  runStd(asts.ipairsIteration),
);
bench("Perf: pairs iteration (100 elems x1000)", () =>
  runStd(asts.pairsIteration),
);
bench("Perf: nested table access (page metadata)", () =>
  runStd(asts.nestedTableAccess),
);
bench("Perf: table as map (5k insert/lookup/delete)", () =>
  runMinimal(asts.tableAsMap),
);
bench("Perf: linked list traversal (1k nodes x100)", () =>
  runMinimal(asts.linkedList),
);
bench("Perf: table.sort with comparator (1k x20)", () =>
  runStd(asts.tableSort),
);
bench("Perf: table.concat (1k parts x100)", () =>
  runStd(asts.tableConcat),
);

// --- String Manipulation ---
bench("Perf: string.format (10k)", () => runStd(asts.stringFormat));
bench("Perf: string.find (10k)", () => runStd(asts.stringFind));
bench("Perf: string.sub (100k)", () => runStd(asts.stringSub));
bench("Perf: string concat loop (1k)", () => runMinimal(asts.stringConcat));
bench("Perf: string.split + upper + concat (2k)", () =>
  runStd(asts.stringSplitProcess),
);
bench("Perf: string.gsub pattern (5k)", () => runStd(asts.stringGsub));

// --- Function Calls / Control Flow ---
bench("Perf: fibonacci(20) recursive", () => runMinimal(asts.fibonacci));
bench("Perf: closure create + call (10k)", () =>
  runMinimal(asts.closureCreateCall),
);
bench("Perf: method call colon syntax (100k)", () =>
  runMinimal(asts.methodCall),
);
bench("Perf: varargs function (10k)", () => runStd(asts.varargs));
bench("Perf: higher-order filter+map (1k x50)", () =>
  runStd(asts.higherOrderFunctions),
);

// --- Realistic Mixed Workloads ---
bench("Perf: query simulation (filter+sort+build)", () =>
  runStd(asts.querySimulation),
);
bench("Perf: config processing (pairs+concat)", () =>
  runStd(asts.configProcessing),
);
bench("Perf: template rendering (format+concat)", () =>
  runStd(asts.templateRendering),
);

// --- Async Patterns ---
bench("Perf: async loop with sync re-entry (1k)", () =>
  runApi(asts.asyncLoopReentry),
);
bench("Perf: while loop with async body (1k)", () =>
  runApi(asts.asyncWhileLoop),
);
bench("Perf: async __index metamethod (1k)", () =>
  runApi(asts.asyncMetamethod),
);
bench("Perf: async query pattern (fetch+filter+build, 1k)", () =>
  runApi(asts.asyncQueryPattern),
);
