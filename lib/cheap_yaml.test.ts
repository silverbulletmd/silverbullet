import { assertEquals } from "$std/testing/asserts.ts";
import { determineTags, isTemplate } from "./cheap_yaml.ts";

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

Deno.test("Test template extraction", () => {
  assertEquals(
    isTemplate(`---
name: bla
tags: template
---

Sup`),
    true,
  );

  assertEquals(
    isTemplate(`---
tags: template, something else
---
`),
    true,
  );

  assertEquals(
    isTemplate(`---
tags: something else, template
---
`),
    true,
  );

  assertEquals(
    isTemplate(`---
tags:
- bla
- template
---
`),
    true,
  );

  assertEquals(
    isTemplate(`#template`),
    true,
  );

  assertEquals(
    isTemplate(`  #template This is a template`),
    true,
  );

  assertEquals(
    isTemplate(`---
tags:
- bla
somethingElse:
- template
---
`),
    false,
  );

  assertEquals(
    isTemplate(`---
name: bla
tags: aefe
---

Sup`),
    false,
  );

  assertEquals(
    isTemplate(`Sup`),
    false,
  );
});
