// Direct micro-benchmarks for LuaTable operations.
// These bypass Lua eval to isolate LuaTable overhead.

import { bench } from "vitest";
import {
  jsToLuaValue,
  LuaStackFrame,
  LuaTable,
  luaValueToJS,
} from "../client/space_lua/runtime.ts";

const sf = LuaStackFrame.lostFrame;

// --- Construction ---

bench("LuaTable: construct empty", () => {
  new LuaTable();
});

// --- jsToLuaValue conversion ---

const smallArray = Array.from({ length: 10 }, (_, i) => i);
const medArray = Array.from({ length: 100 }, (_, i) => i);
const largeArray = Array.from({ length: 1000 }, (_, i) => i);

bench("jsToLuaValue: array (10 elements)", () => {
  jsToLuaValue(smallArray);
});

bench("jsToLuaValue: array (100 elements)", () => {
  jsToLuaValue(medArray);
});

bench("jsToLuaValue: array (1000 elements)", () => {
  jsToLuaValue(largeArray);
});

const smallObj: Record<string, any> = {};
for (let i = 0; i < 10; i++) smallObj[`k${i}`] = `v${i}`;
const medObj: Record<string, any> = {};
for (let i = 0; i < 100; i++) medObj[`k${i}`] = `v${i}`;

bench("jsToLuaValue: object (10 keys)", () => {
  jsToLuaValue(smallObj);
});

bench("jsToLuaValue: object (100 keys)", () => {
  jsToLuaValue(medObj);
});

// Nested structure (common: array of objects)
const nestedData = Array.from({ length: 100 }, (_, i) => ({
  name: `item_${i}`,
  value: i,
  tags: ["a", "b"],
}));

bench("jsToLuaValue: nested array of objects (100)", () => {
  jsToLuaValue(nestedData);
});

// --- String key set/get ---

bench("LuaTable: string key set+get (1k ops)", () => {
  const t = new LuaTable();
  for (let i = 0; i < 1000; i++) {
    void t.set(`key_${i}`, i);
  }
  let sum = 0;
  for (let i = 0; i < 1000; i++) {
    sum += t.get(`key_${i}`) as number;
  }
  return sum;
});

bench("LuaTable: string key rawSet+rawGet (1k ops)", () => {
  const t = new LuaTable();
  for (let i = 0; i < 1000; i++) {
    void t.rawSet(`key_${i}`, i);
  }
  let sum = 0;
  for (let i = 0; i < 1000; i++) {
    sum += t.rawGet(`key_${i}`) as number;
  }
  return sum;
});

// --- Integer key set/get ---

bench("LuaTable: integer key set+get (1k ops)", () => {
  const t = new LuaTable();
  for (let i = 1; i <= 1000; i++) {
    void t.set(i, i);
  }
  let sum = 0;
  for (let i = 1; i <= 1000; i++) {
    sum += t.get(i) as number;
  }
  return sum;
});

bench("LuaTable: integer key rawSet+rawGet (1k ops)", () => {
  const t = new LuaTable();
  for (let i = 1; i <= 1000; i++) {
    void t.rawSet(i, i);
  }
  let sum = 0;
  for (let i = 1; i <= 1000; i++) {
    sum += t.rawGet(i) as number;
  }
  return sum;
});

// --- has() ---

const hasTable = new LuaTable();
for (let i = 0; i < 100; i++) void hasTable.set(`k${i}`, i);
for (let i = 1; i <= 100; i++) void hasTable.set(i, i);

bench("LuaTable: has() string key (100 lookups)", () => {
  let count = 0;
  for (let i = 0; i < 100; i++) {
    if (hasTable.has(`k${i}`)) count++;
  }
  return count;
});

bench("LuaTable: has() integer key (100 lookups)", () => {
  let count = 0;
  for (let i = 1; i <= 100; i++) {
    if (hasTable.has(i)) count++;
  }
  return count;
});

// --- keys() ---

const keysTable10 = new LuaTable();
for (let i = 0; i < 10; i++) void keysTable10.set(`k${i}`, i);

const keysTable100 = new LuaTable();
for (let i = 0; i < 100; i++) void keysTable100.set(`k${i}`, i);

bench("LuaTable: keys() on 10-key table", () => {
  return keysTable10.keys();
});

bench("LuaTable: keys() on 100-key table", () => {
  return keysTable100.keys();
});

// --- length getter ---

const lenTable = new LuaTable();
for (let i = 1; i <= 1000; i++) void lenTable.set(i, i);

bench("LuaTable: length getter (1000-element array)", () => {
  return lenTable.length;
});

// --- Append pattern: t[#t+1] = v ---

bench("LuaTable: append pattern t[#t+1]=v (1k)", () => {
  const t = new LuaTable();
  for (let i = 0; i < 1000; i++) {
    void t.set(t.length + 1, i);
  }
  return t;
});

// --- toJS / toJSObject / toJSArray ---

const convArrayTable = jsToLuaValue(medArray) as LuaTable;
const convObjTable = jsToLuaValue(medObj) as LuaTable;
const convNestedTable = jsToLuaValue(nestedData) as LuaTable;

bench("LuaTable: toJSArray (100 elements)", () => {
  return convArrayTable.toJSArray(sf);
});

bench("LuaTable: toJSObject (100 keys)", () => {
  return convObjTable.toJSObject(sf);
});

bench("LuaTable: toJS nested (100 objects)", () => {
  return convNestedTable.toJS(sf);
});

// --- luaValueToJS roundtrip ---

bench("luaValueToJS: array table (100 elements)", () => {
  return luaValueToJS(convArrayTable, sf);
});

bench("luaValueToJS: object table (100 keys)", () => {
  return luaValueToJS(convObjTable, sf);
});

// --- Iteration pattern (pairs-like) ---

bench("LuaTable: iteration keys()+get() (100 string keys)", () => {
  const keys = keysTable100.keys();
  let sum = 0;
  for (const k of keys) {
    sum += keysTable100.get(k) as number;
  }
  return sum;
});

bench("LuaTable: iteration keys()+rawGet() (100 string keys)", () => {
  const keys = keysTable100.keys();
  let sum = 0;
  for (const k of keys) {
    sum += keysTable100.rawGet(k) as number;
  }
  return sum;
});
