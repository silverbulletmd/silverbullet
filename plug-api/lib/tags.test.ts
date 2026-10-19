import { describe, expect, it } from "vitest";
import {
  builtinTagKind,
  builtinTagsOfKind,
  isBuiltinRootTag,
  isBuiltinTag,
} from "./tags.ts";

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
