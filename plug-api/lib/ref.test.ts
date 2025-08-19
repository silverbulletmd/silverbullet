import {
  decodePageURI,
  encodePageURI,
  encodeRef,
  isValidName,
  isValidPath,
  parseToRef,
} from "./ref.ts";
import { assert, assertEquals } from "@std/assert";

Deno.test("parseToRef() default cases", () => {
  assertEquals(parseToRef("foo"), { path: "foo.md" });
  assertEquals(parseToRef("/foo"), { path: "/foo.md" });
  assertEquals(parseToRef("foo/bar"), { path: "foo/bar.md" });
  assertEquals(parseToRef("foo.md"), { path: "foo.md" });
  assertEquals(parseToRef("foo.md.md"), { path: "foo.md.md" });
  assertEquals(parseToRef("foo."), { path: "foo..md" });
  assertEquals(parseToRef("foo.."), { path: "foo...md" });
  assertEquals(parseToRef(" .foo"), { path: " .foo" });

  assertEquals(parseToRef("^.foo"), null);
  assertEquals(parseToRef(".foobar"), null);
  assertEquals(parseToRef("foo[bar"), null);
  assertEquals(parseToRef("foo]bar"), null);
  assertEquals(parseToRef("foo(bar"), null);
  assertEquals(parseToRef("foo)bar"), null);
  assertEquals(parseToRef("foo|bar"), null);
  assertEquals(parseToRef("foo@bar"), null);

  assertEquals(parseToRef(""), { path: "" });
  assertEquals(parseToRef("/"), null);
  assertEquals(parseToRef("/@132"), null);
});

Deno.test("parseToRef() link cases", () => {
  assertEquals(parseToRef("^foo"), { path: "foo.md", meta: true });

  assertEquals(parseToRef("foo# header"), {
    path: "foo.md",
    details: { type: "header", header: "header" },
  });
  assertEquals(parseToRef("foo# header@123"), {
    path: "foo.md",
    details: { type: "header", header: "header@123" },
  });
  assertEquals(parseToRef("foo@1231"), {
    path: "foo.md",
    details: { type: "position", pos: 1231 },
  });
  assertEquals(parseToRef("foo@l42c69"), {
    path: "foo.md",
    details: { type: "linecolumn", line: 42, column: 69 },
  });
  assertEquals(parseToRef("foo@L42C69"), {
    path: "foo.md",
    details: { type: "linecolumn", line: 42, column: 69 },
  });
  assertEquals(parseToRef("foo@L42"), {
    path: "foo.md",
    details: { type: "linecolumn", line: 42, column: 1 },
  });

  assertEquals(parseToRef("foo@ 123"), null);
  assertEquals(parseToRef("foo@c69"), null);
  assertEquals(parseToRef("foo@123#header"), null);
  assertEquals(parseToRef("foo@123@l29"), null);
});

Deno.test("encodeRef() cases", () => {
  // Encoding
  assertEquals(encodeRef({ path: "foo.md" }), "foo");
  assertEquals(
    encodeRef({ path: "foo.md", details: { type: "position", pos: 10 } }),
    "foo@10",
  );
  assertEquals(
    encodeRef({
      path: "foo.md",
      details: { type: "linecolumn", line: 10, column: 69 },
    }),
    "foo@L10C69",
  );
  assertEquals(
    encodeRef({
      path: "foo.md",
      details: { type: "header", header: "bar" },
    }),
    "foo#bar",
  );
});

Deno.test("isValidPath() and isValidName()", () => {
  assert(isValidPath("foo.md"));
  assert(!isValidPath("foo"));
  assert(!isValidPath("foo.md@123"));

  assert(isValidName("foo.md"));
  assert(isValidName("foo"));
  assert(!isValidName("foo@123"));
  assert(!isValidName("^foo@123"));
  assert(!isValidName("foo[bar"));
});

Deno.test("Page URI encoding", () => {
  assertEquals(encodePageURI("foo"), "foo");
  assertEquals(encodePageURI("folder/foo"), "folder/foo");
  assertEquals(encodePageURI("hello there"), "hello%20there");
  assertEquals(encodePageURI("hello?there"), "hello%3Fthere");
  // Now ensure all these cases are reversible
  assertEquals(decodePageURI("foo"), "foo");
  assertEquals(decodePageURI("folder/foo"), "folder/foo");
  assertEquals(decodePageURI("hello%20there"), "hello there");
  assertEquals(decodePageURI("hello%3Fthere"), "hello?there");
});
