import { expect, test } from "vitest";
import { normalizePrefix, prefixFromName, slugify } from "./slugify.ts";

test("slugify lowercases and collapses non-alphanumerics", () => {
  expect(slugify("My Space!")).toBe("my-space");
  expect(slugify("  Spaced  Out  ")).toBe("spaced-out");
  expect(slugify("a---b")).toBe("a-b");
  expect(slugify("!!!")).toBe("");
});

test("prefixFromName returns an absolute path", () => {
  // The leading slash is part of the value: a binding prefix is a path, and
  // the field renders it directly into the URL it shows.
  expect(prefixFromName("My Space")).toBe("/my-space");
});

test("prefixFromName yields empty rather than a bare slash", () => {
  // "/" is a *root* binding, a meaningfully different thing from "no prefix
  // chosen yet" — defaulting an empty name to it would silently bind the
  // space to the server root.
  expect(prefixFromName("")).toBe("");
  expect(prefixFromName("   ")).toBe("");
  expect(prefixFromName("!!!")).toBe("");
});

test("normalizePrefix slugifies a value that already has a slash", () => {
  // The desktop app's `provision_space` takes anything starting with "/"
  // as-is, so the client is what has to guarantee a clean slug.
  expect(normalizePrefix("/My Space!")).toBe("/my-space");
  expect(normalizePrefix("My Space!")).toBe("/my-space");
});

test("normalizePrefix collapses repeated leading slashes", () => {
  expect(normalizePrefix("//wiki")).toBe("/wiki");
  expect(normalizePrefix("/wiki")).toBe("/wiki");
});

test("normalizePrefix maps a slash-only value to a root binding", () => {
  expect(normalizePrefix("/")).toBe("");
  expect(normalizePrefix("")).toBe("");
});

test("normalizePrefix is idempotent", () => {
  const once = normalizePrefix("/My Space!");
  expect(normalizePrefix(once)).toBe(once);
});
