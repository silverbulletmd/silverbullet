import { assert, assertEquals } from "@std/assert";
import { federatedPathToLocalPath, wildcardPathToRegex } from "./util.ts";

Deno.test("Test wildcardPathToRegex", () => {
  assert(wildcardPathToRegex("test").test("test"));
  assert(wildcardPathToRegex("test").test("test.md"));
  assert(wildcardPathToRegex("test*").test("test"));
  assert(wildcardPathToRegex("test/*").test("test/bla"));
  assert(wildcardPathToRegex("test/*").test("test/bla.md"));
  assert(wildcardPathToRegex("test/*").test("test/bla/bla"));
  assert(!wildcardPathToRegex("test/*").test("tests/bla/bla"));
});

Deno.test("Test federatedPathToLocalPath", () => {
  assertEquals(federatedPathToLocalPath("!silverbullet.md"), "");
  assertEquals(
    federatedPathToLocalPath("!silverbullet.md/Library/Core/test"),
    "Library/Core/test",
  );
});
