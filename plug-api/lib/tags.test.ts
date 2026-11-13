import { describe, expect, it } from "vitest";
import {
  builtinTagKind,
  builtinTagsOfKind,
  isBuiltinRootTag,
  isBuiltinTag,
  normalizeTagList,
} from "./tags.ts";

describe("normalizeTagList", () => {
  it("accepts comma and space separated strings and lists", () => {
    const expected = ["meta/library", "meta/theme"];
    expect(normalizeTagList("meta/library, meta/theme")).toEqual(expected);
    expect(normalizeTagList("#meta/library #meta/theme")).toEqual(expected);
    expect(normalizeTagList(["meta/library", " #meta/theme"])).toEqual(
      expected,
    );
  });

  it("drops duplicates and empty entries", () => {
    expect(normalizeTagList("a,, b a")).toEqual(["a", "b"]);
    expect(normalizeTagList(["a", "#a", ""])).toEqual(["a"]);
  });

  it("returns nothing for anything else", () => {
    expect(normalizeTagList(undefined)).toEqual([]);
    expect(normalizeTagList(5)).toEqual([]);
  });
});

describe("builtin tag kinds", () => {
  it("classifies each built-in tag", () => {
    expect(builtinTagKind("task")).toBe("root");
    expect(builtinTagKind("data")).toBe("root");
    expect(builtinTagKind("space-style")).toBe("system");
    expect(builtinTagKind("relation")).toBe("edge");
    expect(builtinTagKind("aspiring-page")).toBe("index");
  });

  it("knows nothing about user tags or prototype keys", () => {
    expect(builtinTagKind("contact")).toBeUndefined();
    expect(builtinTagKind("toString")).toBeUndefined();
    expect(isBuiltinRootTag("contact")).toBe(false);
  });

  it("treats link as a built-in view, not a kind", () => {
    expect(builtinTagKind("link")).toBeUndefined();
    expect(isBuiltinTag("link")).toBe(true);
  });

  it("lists tags per kind", () => {
    expect(builtinTagsOfKind("system")).toEqual(["space-lua", "space-style"]);
    expect(builtinTagsOfKind("edge")).toEqual(["relation"]);
  });
});
