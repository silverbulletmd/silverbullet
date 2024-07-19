import { assertEquals } from "$std/testing/asserts.ts";
import { tokenize } from "./engine.ts";

Deno.test("Test search tokenizer", () => {
  assertEquals(tokenize("two words"), ["two", "words"]);
  assertEquals(tokenize("Two wOrDs"), ["two", "words"]);
  assertEquals(
    tokenize("interpunction, ignored!"),
    ["interpunction", "ignored"],
  );

  // Treat each ideogram as a word
  assertEquals(tokenize("汉字"), ["汉", "字"]); // Chinese
  assertEquals(tokenize("漢字"), ["漢", "字"]); // Japanese

  assertEquals(tokenize("mix English, 中文 and 日本語"), [
    "mix",
    "english",
    "中",
    "文",
    "and",
    "日",
    "本",
    "語",
  ]);
});
