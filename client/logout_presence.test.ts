import { expect, test } from "vitest";
import { registerLogoutPresence } from "./logout_presence.ts";

test("HTTP logout waits for other open documents and releases closed documents", () => {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const first = registerLogoutPresence(storage);
  expect(first.isAlone()).toBe(true);
  const second = registerLogoutPresence(storage);
  expect(first.isAlone()).toBe(false);
  second.close();
  expect(first.isAlone()).toBe(true);
  first.close();
  expect(values.size).toBe(0);
});

test("unavailable storage cannot claim other documents are saved", () => {
  const presence = registerLogoutPresence({
    length: 0,
    key: () => null,
    setItem: () => {
      throw new Error("Storage unavailable");
    },
    removeItem: () => {},
  });
  expect(presence.isAlone()).toBe(false);
  presence.close();
});
