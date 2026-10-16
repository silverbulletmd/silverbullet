import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { deleteLocalSpaceData } from "../logout_cleanup.ts";
import { historyKey, historyStore, InputHistory } from "./history.ts";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

test("walks back and forward, restoring the draft", () => {
  const h = new InputHistory("k", memStore());
  h.push("a");
  h.push("b");
  expect(h.prev("draft")).toBe("b");
  expect(h.prev("b")).toBe("a");
  expect(h.prev("a")).toBe(null);
  expect(h.next()).toBe("b");
  expect(h.next()).toBe("draft");
  expect(h.next()).toBe(null);
});

test("skips empty input and consecutive duplicates, caps length", () => {
  const h = new InputHistory("k", memStore(), 2);
  h.push("");
  h.push("x");
  h.push("x");
  h.push("y");
  h.push("z");
  expect(h.prev("")).toBe("z");
  expect(h.prev("z")).toBe("y");
  expect(h.prev("y")).toBe(null);
});

test("persists per key and survives a broken store", () => {
  const store = memStore();
  new InputHistory("space-a", store).push("one");
  expect(new InputHistory("space-a", store).prev("")).toBe("one");
  expect(new InputHistory("space-b", store).prev("")).toBe(null);
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  const h = new InputHistory("k", broken);
  h.push("still works");
  expect(h.prev("")).toBe("still works");
});

test("with client encryption on, history stays in memory only", () => {
  let writes = 0;
  const store = { ...memStore(), setItem: () => void writes++ };
  const h = new InputHistory(
    historyKey("https://notes.example/"),
    historyStore(true, store),
  );
  h.push("secret = 1");
  expect(h.prev("")).toBe("secret = 1");
  expect(writes).toBe(0);
  new InputHistory("k", historyStore(false, store)).push("x");
  expect(writes).toBe(1);
});

test("the history key is removed by logout cleanup", async () => {
  const key = historyKey("https://notes.example/");
  const values = new Map([
    [key, "[]"],
    ["unrelated", "keep"],
  ]);
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index],
    getItem: (k: string) => values.get(k) ?? null,
    removeItem: (k: string) => values.delete(k),
  });
  try {
    await deleteLocalSpaceData();
    expect([...values.keys()]).toEqual(["unrelated"]);
  } finally {
    vi.unstubAllGlobals();
  }
});
