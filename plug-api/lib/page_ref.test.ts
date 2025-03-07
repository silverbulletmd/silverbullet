import {
  decodePageURI,
  encodePageURI,
  encodeRef,
  parseRef,
  validatePageName,
} from "./page_ref.ts";
import { assertEquals, AssertionError, assertThrows } from "@std/assert";

Deno.test("Page utility functions", () => {
  // Base cases
  assertEquals(parseRef("foo"), { kind: "page", page: "foo" });
  assertEquals(parseRef("[[foo]]"), { kind: "page", page: "foo" });
  assertEquals(parseRef("foo@1"), {
    kind: "page",
    page: "foo",
    pos: 1,
  });
  assertEquals(parseRef("foo@L1"), {
    kind: "page",
    page: "foo",
    pos: { line: 1, column: 1 },
  });
  assertEquals(parseRef("foo@L2C3"), {
    kind: "page",
    page: "foo",
    pos: { line: 2, column: 3 },
  });
  assertEquals(parseRef("foo@l2c3"), {
    kind: "page",
    page: "foo",
    pos: { line: 2, column: 3 },
  });
  assertEquals(parseRef("foo$bar"), {
    kind: "page",
    page: "foo",
    anchor: "bar",
  });
  assertEquals(parseRef("foo#My header"), {
    kind: "page",
    page: "foo",
    header: "My header",
  });
  assertEquals(parseRef("foo$bar@1"), {
    kind: "page",
    page: "foo",
    anchor: "bar",
    pos: 1,
  });
  assertEquals(parseRef("foo.pdf"), {
    kind: "document",
    page: "foo.pdf",
  });

  // Meta page
  assertEquals(parseRef("^foo"), {
    kind: "page",
    page: "foo",
    meta: true,
  });

  // Documents
  assertEquals(parseRef("foo.txt"), {
    kind: "document",
    page: "foo.txt",
  });
  assertEquals(parseRef("hello/foo.txt"), {
    kind: "document",
    page: "hello/foo.txt",
  });

  // Edge cases
  assertEquals(parseRef(""), { kind: "page", page: "" });

  // Encoding
  assertEquals(encodeRef({ kind: "page", page: "foo" }), "foo");
  assertEquals(encodeRef({ kind: "page", page: "foo", pos: 10 }), "foo@10");
  assertEquals(
    encodeRef({ kind: "page", page: "foo", pos: { line: 10, column: 1 } }),
    "foo@L10",
  );
  assertEquals(
    encodeRef({ kind: "page", page: "foo", pos: { line: 10, column: 5 } }),
    "foo@L10C5",
  );
  assertEquals(
    encodeRef({ kind: "page", page: "foo", anchor: "bar" }),
    "foo$bar",
  );
  assertEquals(
    encodeRef({ kind: "page", page: "foo", header: "bar" }),
    "foo#bar",
  );

  // Page name validation

  try {
    validatePageName("perfectly fine page name");
    validatePageName("this is special case of a.conflicted.1234");
  } catch (error) {
    throw new AssertionError(
      `Something is very wrong with the validatePageName function: ${error}`,
    );
  }

  assertThrows(() => validatePageName(""), Error);
  assertThrows(() => validatePageName(".hidden"), Error);
  assertThrows(() => validatePageName(".."), Error);

  for (const extension of ["md", "txt", "exe", "cc", "ts"]) {
    assertThrows(
      () => validatePageName(`extensions-are-not-welcome.${extension}`),
      Error,
    );
  }

  for (const extension of ["db2", "woff2", "sqlite3", "42", "0"]) {
    assertThrows(
      () => validatePageName(`extensions-can-contain-numbers-too.${extension}`),
      Error,
    );
  }
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
