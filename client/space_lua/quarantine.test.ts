import { expect, test } from "vitest";
import {
  isQuarantined,
  listQuarantined,
  quarantine,
  quarantineStorageKey,
  reconcileQuarantine,
  unquarantine,
} from "./quarantine.ts";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

test("a script is not quarantined by default", () => {
  const s = memStore();
  expect(isQuarantined("Scripts.md", "print(1)", s)).toBe(false);
});

test("quarantining a script hides it while the source is unchanged", () => {
  const s = memStore();
  quarantine("Scripts.md", "while true do end", s);
  expect(isQuarantined("Scripts.md", "while true do end", s)).toBe(true);
});

test("editing the source clears the quarantine", () => {
  const s = memStore();
  quarantine("Scripts.md", "while true do end", s);
  expect(isQuarantined("Scripts.md", "print('fixed')", s)).toBe(false);
});

test("quarantine is per-ref", () => {
  const s = memStore();
  quarantine("A.md", "x", s);
  expect(isQuarantined("B.md", "x", s)).toBe(false);
});

test("unquarantine re-enables a script", () => {
  const s = memStore();
  quarantine("Scripts.md", "x", s);
  unquarantine("Scripts.md", s);
  expect(isQuarantined("Scripts.md", "x", s)).toBe(false);
});

test("listQuarantined reports the refs currently disabled", () => {
  const s = memStore();
  quarantine("A.md", "x", s);
  quarantine("B.md", "y", s);
  expect(listQuarantined(s).sort()).toEqual(["A.md", "B.md"]);
});

test("corrupt stored JSON is treated as empty rather than throwing", () => {
  const s = memStore();
  s.setItem(quarantineStorageKey(), "{not json");
  expect(isQuarantined("A.md", "x", s)).toBe(false);
  expect(listQuarantined(s)).toEqual([]);
});

test("the storage key is namespaced (not the bare QUARANTINE_KEY)", () => {
  expect(quarantineStorageKey()).not.toBe("spaceLuaQuarantine");
  expect(quarantineStorageKey()).toContain("spaceLuaQuarantine");
});

test("editing the source prunes the stale entry from the store", () => {
  const s = memStore();
  quarantine("Scripts.md", "while true do end", s);
  expect(listQuarantined(s)).toEqual(["Scripts.md"]);
  expect(isQuarantined("Scripts.md", "print('fixed')", s)).toBe(false);
  expect(listQuarantined(s)).toEqual([]);
});

test("a store that throws on getItem fails open", () => {
  const s = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {},
  };
  expect(isQuarantined("Scripts.md", "x", s)).toBe(false);
  expect(listQuarantined(s)).toEqual([]);
});

test("a store that throws on setItem fails open", () => {
  const s = {
    getItem: () => null,
    setItem: () => {
      throw new Error("storage full");
    },
  };
  expect(() => quarantine("Scripts.md", "x", s)).not.toThrow();
  expect(() => unquarantine("Scripts.md", s)).not.toThrow();
  expect(isQuarantined("Scripts.md", "x", s)).toBe(false);
});

test("reconcileQuarantine keeps a ref that is still live", () => {
  const s = memStore();
  quarantine("Runaway@48", "while true do end", s);
  reconcileQuarantine(["Runaway@48", "Other.md"], s);
  expect(listQuarantined(s)).toEqual(["Runaway@48"]);
});

test("reconcileQuarantine drops a ref absent from the live list", () => {
  const s = memStore();
  quarantine("Runaway@48", "while true do end", s);
  reconcileQuarantine(["Runaway@58"], s);
  expect(listQuarantined(s)).toEqual([]);
});

test("reconcileQuarantine against an empty live list clears everything", () => {
  const s = memStore();
  quarantine("A.md", "x", s);
  quarantine("B.md", "y", s);
  reconcileQuarantine([], s);
  expect(listQuarantined(s)).toEqual([]);
});

test("reconcileQuarantine is safe with a throwing store", () => {
  const s = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage full");
    },
  };
  expect(() => reconcileQuarantine(["A.md"], s)).not.toThrow();
});
