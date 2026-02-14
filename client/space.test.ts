import { expect, test } from "vitest";
import { sleep } from "@silverbulletmd/silverbullet/lib/async";
import { MemoryKvPrimitives } from "./data/memory_kv_primitives.ts";
import { EventHook } from "./plugos/hooks/event.ts";
import { Space } from "./space.ts";
import { DataStoreSpacePrimitives } from "./spaces/datastore_space_primitives.ts";
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

test("readRef checks", async () => {
  const kv = new MemoryKvPrimitives();
  const eventHook = new EventHook();
  const space = new Space(new DataStoreSpacePrimitives(kv), eventHook);
  await sleep(1);
  await space.writePage("test", testPage);

  // Reference to page
  expect(await space.readRef(parseToRef("test")!)).toEqual({
    text: testPage,
    offset: 0,
  });

  // Pointer to a paragraph
  expect(await space.readRef(parseToRef("test@0")!)).toEqual({
    text: "Some paragraph",
    offset: 0,
  });

  // With a linecolumn ref
  expect(await space.readRef(parseToRef("test@l1c1")!)).toEqual({
    text: "Some paragraph",
    offset: 0,
  });

  // Reference to a header
  expect(await space.readRef(parseToRef("test#Header 1")!)).toEqual({
      text: "# Header 1\nSome text\n\n",
      offset: testPage.indexOf("# Header 1"),
    },
  );
  expect(await space.readRef(parseToRef("test#Header 2")!)).toEqual({
      text:
        "# Header 2\n* Item 1\n  * Sub item\n* [ ] Task 1\n  * Sub item 2\n    * Sub-sub item",
      offset: testPage.indexOf("# Header 2"),
    },
  );

  // Reference to an item should get item and children
  const itemPos = testPage.indexOf("* Item 1");
  expect(await space.readRef(parseToRef(`test@${itemPos}`)!)).toEqual({ text: "* Item 1\n  * Sub item", offset: itemPos },
  );

  // Reference to a task should get item and children
  const taskPos = testPage.indexOf("* [ ] Task 1");
  expect(await space.readRef(parseToRef(`test@${taskPos}`)!)).toEqual({
      text: "* [ ] Task 1\n  * Sub item 2\n    * Sub-sub item",
      offset: taskPos,
    },
  );

  // Check left shift in case of jumping into nested item
  const subItemPos = testPage.indexOf("* Sub item 2");
  expect(await space.readRef(parseToRef(`test@${subItemPos}`)!)).toEqual({ text: "* Sub item 2\n  * Sub-sub item", offset: subItemPos },
  );
});
