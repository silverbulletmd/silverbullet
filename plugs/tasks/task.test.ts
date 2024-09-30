import "../../plug-api/lib/syscall_mock.ts";
import { parseMarkdown } from "$common/markdown_parser/parser.ts";
import { extractTasks } from "./task.ts";
import { assertEquals } from "@std/assert";

const itemsMd = `
* Item 1 #tag1 #tag2 [age: 100]
  * [ ] Task 1 [age: 200]
  * [ ] Task 2 #tag3 #tag1
    * [x] Task 2.1
`;

Deno.test("Test task extraction", async () => {
  const t = parseMarkdown(itemsMd);
  const tasks = await extractTasks("test", t);

  assertEquals(tasks.length, 3);
  assertEquals(tasks[0].name, "Task 1");
  assertEquals(tasks[0].age, 200);
  assertEquals(tasks[0].page, "test");
  assertEquals(tasks[0].text, "Task 1 [age: 200]");
  assertEquals(new Set(tasks[0].itags), new Set(["tag1", "tag2", "task"]));
  assertEquals(tasks[0].parent, "test@1");
  assertEquals(tasks[1].name, "Task 2");
  // Don't inherit attributes
  assertEquals(tasks[1].age, undefined);
  // But inherit tags through itags, not tags
  assertEquals(
    new Set(tasks[1].tags),
    new Set(["tag1", "tag3"]),
  );
  assertEquals(
    new Set(tasks[1].itags),
    new Set(["tag1", "tag3", "task", "tag2"]),
  );
  assertEquals(tasks[1].parent, "test@1");
  // Deeply
  assertEquals(tasks[2].name, "Task 2.1");
  assertEquals(tasks[2].tags, []);
  assertEquals(
    new Set(tasks[2].itags),
    new Set(["tag1", "tag3", "task", "tag2"]),
  );
});
