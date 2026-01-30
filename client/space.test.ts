import { sleep } from "@silverbulletmd/silverbullet/lib/async";
import { MemoryKvPrimitives } from "./data/memory_kv_primitives.ts";
import { EventHook } from "./plugos/hooks/event.ts";
import { Space } from "./space.ts";
import { DataStoreSpacePrimitives } from "./spaces/datastore_space_primitives.ts";
import { assertEquals } from "@std/assert";
import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";

const testPage = `
Some paragraph
# Header 1
Some text

# Header 2
* Item 1
  * Sub item
* [ ] Task 1
  * Sub item 2
    * Sub-sub item
`.trim();

Deno.test("readRef checks", async () => {
  const kv = new MemoryKvPrimitives();
  const eventHook = new EventHook();
  const space = new Space(new DataStoreSpacePrimitives(kv), eventHook);
  await sleep(1);
  await space.writePage("test", testPage);

  // Reference to page
  assertEquals(await space.readRef(parseToRef("test")!), {
    text: testPage,
    offset: 0,
  });

  // Pointer to a paragraph
  assertEquals(await space.readRef(parseToRef("test@0")!), {
    text: "Some paragraph",
    offset: 0,
  });

  // With a linecolumn ref
  assertEquals(await space.readRef(parseToRef("test@l1c1")!), {
    text: "Some paragraph",
    offset: 0,
  });

  // Reference to a header
  assertEquals(
    await space.readRef(parseToRef("test#Header 1")!),
    {
      text: "# Header 1\nSome text\n\n",
      offset: testPage.indexOf("# Header 1"),
    },
  );
  assertEquals(
    await space.readRef(parseToRef("test#Header 2")!),
    {
      text:
        "# Header 2\n* Item 1\n  * Sub item\n* [ ] Task 1\n  * Sub item 2\n    * Sub-sub item",
      offset: testPage.indexOf("# Header 2"),
    },
  );

  // Reference to an item should get item and children
  const itemPos = testPage.indexOf("* Item 1");
  assertEquals(
    await space.readRef(parseToRef(`test@${itemPos}`)!),
    { text: "* Item 1\n  * Sub item", offset: itemPos },
  );

  // Reference to a task should get item and children
  const taskPos = testPage.indexOf("* [ ] Task 1");
  assertEquals(
    await space.readRef(parseToRef(`test@${taskPos}`)!),
    {
      text: "* [ ] Task 1\n  * Sub item 2\n    * Sub-sub item",
      offset: taskPos,
    },
  );

  // Check left shift in case of jumping into nested item
  const subItemPos = testPage.indexOf("* Sub item 2");
  assertEquals(
    await space.readRef(parseToRef(`test@${subItemPos}`)!),
    { text: "* Sub item 2\n  * Sub-sub item", offset: subItemPos },
  );
});
