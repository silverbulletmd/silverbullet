import { encodePageRef, parsePageRef } from "./page_ref.ts";
import { assertEquals } from "$std/testing/asserts.ts";

Deno.test("Page utility functions", () => {
  // Base cases
  assertEquals(parsePageRef("foo"), { page: "foo" });
  assertEquals(parsePageRef("[[foo]]"), { page: "foo" });
  assertEquals(parsePageRef("foo@1"), { page: "foo", pos: 1 });
  assertEquals(parsePageRef("foo$bar"), { page: "foo", anchor: "bar" });
  assertEquals(parsePageRef("foo#My header"), {
    page: "foo",
    header: "My header",
  });
  assertEquals(parsePageRef("foo$bar@1"), {
    page: "foo",
    anchor: "bar",
    pos: 1,
  });

  // Edge cases
  assertEquals(parsePageRef(""), { page: "" });
  assertEquals(parsePageRef("user@domain.com"), { page: "user@domain.com" });

  // Encoding
  assertEquals(encodePageRef({ page: "foo" }), "foo");
  assertEquals(encodePageRef({ page: "foo", pos: 10 }), "foo@10");
  assertEquals(encodePageRef({ page: "foo", anchor: "bar" }), "foo$bar");
  assertEquals(encodePageRef({ page: "foo", header: "bar" }), "foo#bar");
});
