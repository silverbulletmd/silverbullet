import { assertEquals } from "$std/testing/asserts.ts";
import { parseCommand } from "./command.ts";

Deno.test("Command parser", () => {
  assertEquals(parseCommand("Hello world"), { name: "Hello world", args: [] });
  assertEquals(parseCommand("{[Hello world]}"), {
    name: "Hello world",
    args: [],
  });
  assertEquals(parseCommand("{[Hello world|sup]}"), {
    name: "Hello world",
    alias: "sup",
    args: [],
  });
  assertEquals(parseCommand("{[Hello world](1, 2, 3)}"), {
    name: "Hello world",
    args: [1, 2, 3],
  });
  assertEquals(parseCommand("{[Hello world|sup](1, 2, 3)}"), {
    name: "Hello world",
    alias: "sup",
    args: [1, 2, 3],
  });
});
