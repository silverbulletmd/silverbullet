import { assertEquals } from "@std/assert";
import { determineTags } from "./cheap_yaml.ts";

Deno.test("cheap yaml", () => {
  assertEquals([], determineTags(""));
  assertEquals([], determineTags("hank: bla"));
  assertEquals(["template"], determineTags("tags: template"));
  assertEquals(["bla", "template"], determineTags("tags: bla,template"));
  assertEquals(["bla", "template"], determineTags("tags:\n- bla\n- template"));
  assertEquals(["bla", "template"], determineTags(`tags: "#bla,#template"`));
  assertEquals(["bla", "template"], determineTags(`tags: '#bla, #template'`));
  assertEquals(
    ["bla", "template"],
    determineTags(`tags:\n- "#bla"\n- template`),
  );
});
