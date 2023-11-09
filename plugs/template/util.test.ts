import { assertEquals } from "../../test_deps.ts";
import { isTemplate } from "./util.ts";

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
