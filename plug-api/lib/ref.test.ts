import { expect, test } from "vitest";
import {
  decodePageURI,
  encodePageURI,
  encodeRef,
  isValidName,
  isValidPath,
  parseToRef,
} from "./ref.ts";

test("parseToRef() default cases", () => {
  expect(parseToRef("foo")).toEqual({ path: "foo.md" });
  expect(parseToRef("/foo")).toEqual({ path: "foo.md" });
  expect(parseToRef("foo/bar")).toEqual({ path: "foo/bar.md" });
  expect(parseToRef("foo.png")).toEqual({ path: "foo.png" });
  expect(parseToRef("foo.md")).toEqual({ path: "foo.md" });
  expect(parseToRef("foo.")).toEqual({ path: "foo..md" });
  expect(parseToRef("foo..")).toEqual({ path: "foo...md" });
  expect(parseToRef(" .foo")).toEqual({ path: " .foo" });
  expect(parseToRef("foo[bar")).toEqual({ path: "foo[bar.md" });
  expect(parseToRef("foo]bar")).toEqual({ path: "foo]bar.md" });
  expect(parseToRef("foo(bar")).toEqual({ path: "foo(bar.md" });
  expect(parseToRef("foo)bar")).toEqual({ path: "foo)bar.md" });
  expect(parseToRef("/bar/.../foo")).toEqual({ path: "bar/.../foo.md" });

  expect(parseToRef("/foo/.bar.md")).toEqual(null);
  expect(parseToRef("foo.md.md")).toEqual(null);
  expect(parseToRef("/.../foo")).toEqual(null);
  expect(parseToRef("^.foo")).toEqual(null);
  expect(parseToRef(".foobar")).toEqual(null);
  expect(parseToRef("foo[[bar")).toEqual(null);
  expect(parseToRef("foo]]bar")).toEqual(null);
  expect(parseToRef("foo|bar")).toEqual(null);
  expect(parseToRef("foo@bar")).toEqual(null);
  expect(parseToRef("/../foo")).toEqual(null);
  expect(parseToRef("/./foo")).toEqual(null);
  expect(parseToRef("/bar/../foo")).toEqual(null);
  expect(parseToRef("/bar/./foo")).toEqual(null);

  expect(parseToRef("")).toEqual({ path: "" });
  expect(parseToRef("/")).toEqual({ path: "" });
  expect(parseToRef("/.md")).toEqual(null);
  expect(parseToRef("/.foo")).toEqual(null);
  expect(parseToRef("/@132")).toEqual({
    path: "",
    details: { type: "position", pos: 132 },
  });
});

test("parseToRef() link cases", () => {
  expect(parseToRef("^foo")).toEqual({ path: "foo.md", meta: true });

  expect(parseToRef("foo# header")).toEqual({
    path: "foo.md",
    details: { type: "header", header: "header" },
  });
  expect(parseToRef("foo# header@123")).toEqual({
    path: "foo.md",
    details: { type: "header", header: "header@123" },
  });
  expect(parseToRef("foo@1231")).toEqual({
    path: "foo.md",
    details: { type: "position", pos: 1231 },
  });
  expect(parseToRef("foo@l42c69")).toEqual({
    path: "foo.md",
    details: { type: "linecolumn", line: 42, column: 69 },
  });
  expect(parseToRef("foo@L42C69")).toEqual({
    path: "foo.md",
    details: { type: "linecolumn", line: 42, column: 69 },
  });
  expect(parseToRef("foo@L42")).toEqual({
    path: "foo.md",
    details: { type: "linecolumn", line: 42, column: 1 },
  });

  expect(parseToRef("foo@ 123")).toEqual(null);
  expect(parseToRef("foo@c69")).toEqual(null);
  expect(parseToRef("foo@123#header")).toEqual(null);
  expect(parseToRef("foo@123@l29")).toEqual(null);
});

test("encodeRef() cases", () => {
  // Encoding
  expect(encodeRef({ path: "foo.md" })).toEqual("foo");
  expect(encodeRef({ path: "foo.md", details: { type: "position", pos: 10 } })).toEqual("foo@10");
  expect(encodeRef({
    path: "foo.md",
    details: { type: "linecolumn", line: 10, column: 69 },
  })).toEqual("foo@L10C69");
  expect(encodeRef({
    path: "foo.md",
    details: { type: "header", header: "bar" },
  })).toEqual("foo#bar");
});

test("isValidPath() and isValidName()", () => {
  expect(isValidPath("foo.md")).toBeTruthy();
  expect(!isValidPath("foo")).toBeTruthy();
  expect(!isValidPath("foo.md@123")).toBeTruthy();

  expect(isValidName("foo")).toBeTruthy();
  expect(!isValidName("foo.md")).toBeTruthy();
  expect(!isValidName("foo@123")).toBeTruthy();
  expect(!isValidName("^foo@123")).toBeTruthy();
  expect(!isValidName("foo[[bar")).toBeTruthy();

  // Disallow < and > in ref names
  expect(!isValidName("hello<there")).toBeTruthy();
  expect(!isValidName("hello>there")).toBeTruthy();
});

test("Page URI encoding", () => {
  expect(encodePageURI("foo")).toEqual("foo");
  expect(encodePageURI("folder/foo")).toEqual("folder/foo");
  expect(encodePageURI("hello there")).toEqual("hello%20there");
  expect(encodePageURI("hello?there")).toEqual("hello%3Fthere");
  // Now ensure all these cases are reversible
  expect(decodePageURI("foo")).toEqual("foo");
  expect(decodePageURI("folder/foo")).toEqual("folder/foo");
  expect(decodePageURI("hello%20there")).toEqual("hello there");
  expect(decodePageURI("hello%3Fthere")).toEqual("hello?there");
});
