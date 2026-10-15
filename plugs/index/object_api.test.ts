import { beforeEach, expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import {
  appendObject,
  createPage,
  deleteObject,
  updateObject,
} from "./object_api.ts";
import { objectsOf } from "./object_test_util.ts";

let mock: ReturnType<typeof createMockSystem>;

beforeEach(() => {
  mock = createMockSystem();
});

const write = (name: string, text: string) =>
  globalThis.syscall("space.writePage", name, text);
const read = (name: string): Promise<string> =>
  globalThis.syscall("space.readPage", name);

async function tasksOf(page: string) {
  return (await objectsOf(await read(page), page)).filter(
    (o) => o.tag === "task",
  );
}

test("update changes a task found by a query", async () => {
  await write("Notes", "* [ ] A #x\n* [ ] B #x\n");
  const [, b] = await tasksOf("Notes");
  await updateObject(b as any, { done: true, owner: "Ada" });
  expect(await read("Notes")).toBe("* [ ] A #x\n* [x] B #x [owner: Ada]\n");
});

test("a batch update changes several objects in one write, or none", async () => {
  await write("Notes", "* [ ] A #x\n* [ ] B #x\n");
  await updateObject((await tasksOf("Notes")) as any, { done: true });
  expect(await read("Notes")).toBe("* [x] A #x\n* [x] B #x\n");
  const [a] = await tasksOf("Notes");
  await expect(updateObject([a, a] as any, { owner: "Ada" })).rejects.toThrow(
    "object.update: the same object is listed twice",
  );
  expect(await read("Notes")).toBe("* [x] A #x\n* [x] B #x\n");
});

test("update and delete a page", async () => {
  const page = { page: "Contacts/Pete", ref: "Contacts/Pete", tag: "page" };
  await write("Contacts/Pete", "---\ntags: contact\n---\nHi\n");
  await updateObject(page, { company: "Acme" });
  expect(await read("Contacts/Pete")).toBe(
    "---\ntags: contact\ncompany: Acme\n---\nHi\n",
  );
  await deleteObject(page);
  await expect(read("Contacts/Pete")).rejects.toThrow();
});

test("delete removes an anchored item wherever it moved", async () => {
  await write("Notes", "Intro\n\n* Keep\n* Drop $drop-me\n");
  await deleteObject({ page: "Notes", ref: "drop-me" });
  expect(await read("Notes")).toBe("Intro\n\n* Keep\n");
});

test("append returns a ref that update can use", async () => {
  await write("Trips/Lisbon", "Trip\n");
  const created = await appendObject(
    "Trips/Lisbon",
    { tag: "expense", what: "Tram", amount: 2 },
    { anchor: "tram" },
  );
  expect(created).toEqual({ page: "Trips/Lisbon", ref: "tram" });
  await updateObject(created, { amount: 3 });
  expect(await read("Trips/Lisbon")).toBe(
    "Trip\n\n```#expense\n$ref: tram\nwhat: Tram\namount: 3\n```\n",
  );
  const task = await appendObject("Trips/Lisbon", {
    tag: "task",
    name: "Pack",
  });
  expect(task.ref).toMatch(/^Trips\/Lisbon@\d+$/);
  await updateObject(task, { done: true });
  expect(await read("Trips/Lisbon")).toContain("* [x] Pack\n");
});

test("append with anchor = true generates a free anchor", async () => {
  await write("Notes", "");
  const { ref } = await appendObject(
    "Notes",
    { tag: "task", name: "A" },
    { anchor: true },
  );
  expect(ref).toMatch(/^task-[0-9a-f]{4}$/);
  expect(await read("Notes")).toBe(`* [ ] A $${ref}\n`);
});

test("schema validation blocks invalid writes", async () => {
  mock.config.set("tags", {
    expense: {
      schema: {
        type: "object",
        properties: { amount: { type: "number" } },
      },
    },
  });
  await write("Trip", "```#expense\nwhat: Tram\namount: 2\n```\n");
  const [tram] = (await objectsOf(await read("Trip"), "Trip")).filter(
    (o) => o.tag === "expense",
  );
  await expect(updateObject(tram as any, { amount: "lots" })).rejects.toThrow(
    "object.update:",
  );
  expect(await read("Trip")).toBe("```#expense\nwhat: Tram\namount: 2\n```\n");
});

test("createPage refuses an existing page", async () => {
  expect(await createPage("Contacts/Ada", { tags: "contact" }, "Hi\n")).toEqual(
    { page: "Contacts/Ada", ref: "Contacts/Ada" },
  );
  expect(await read("Contacts/Ada")).toBe("---\ntags: contact\n---\nHi\n");
  await expect(createPage("Contacts/Ada")).rejects.toThrow(
    "object.createPage: Contacts/Ada already exists",
  );
});

test("bad targets get a clear error", async () => {
  await expect(updateObject({} as any, { a: 1 })).rejects.toThrow(
    "object.update: expected an object from a query, or { page = …, ref = … }",
  );
});

// Final review findings

test("C1: a ref returned by append can't edit a neighbour after the page changed", async () => {
  await write("P", "");
  const a = await appendObject("P", { tag: "task", name: "A" });
  const b = await appendObject("P", { tag: "task", name: "B" });
  await deleteObject(a);
  await appendObject("P", { tag: "task", name: "C" });
  await expect(updateObject(b, { done: true })).rejects.toThrow("object moved");
  expect(await read("P")).toBe("* [ ] B\n* [ ] C\n");
});

test("C1: a bare positional ref is refused", async () => {
  await write("P", "* [ ] A\n* [ ] B\n");
  await expect(deleteObject({ page: "P", ref: "P@0" })).rejects.toThrow(
    "object.delete: P@0 is a position",
  );
  expect(await read("P")).toBe("* [ ] A\n* [ ] B\n");
});

test("C2: a stale table row with Name/Done columns doesn't edit its neighbour", async () => {
  const text =
    "| Name | Done |\n|---|---|\n| Ada | no |\n| Bob | no |\n| Cyd | no |\n";
  await write("T", text);
  const rows = (await objectsOf(text, "T")).filter((o) => o.tag === "table");
  await deleteObject(rows[0] as any);
  await expect(updateObject(rows[1] as any, { done: "yes" })).rejects.toThrow(
    "object moved",
  );
});

test("C3: updating a data document keeps nested values intact", async () => {
  await write(
    "D",
    "```#c\naddress:\n  name: Home\n  city: Lisbon\nname: Ada\n```\n",
  );
  const [c] = (await objectsOf(await read("D"), "D")).filter(
    (o) => o.tag === "c",
  );
  await updateObject(c as any, { name: "Bob" });
  const [after] = (await objectsOf(await read("D"), "D")).filter(
    (o) => o.tag === "c",
  );
  expect(after.name).toBe("Bob");
  expect(after.address).toEqual({ name: "Home", city: "Lisbon" });
  await updateObject(after as any, { address: "x" });
  const [last] = (await objectsOf(await read("D"), "D")).filter(
    (o) => o.tag === "c",
  );
  expect(last.address).toBe("x");
});

test("C3: replacing block-list frontmatter tags keeps the page parseable", async () => {
  const page = { page: "F", ref: "F", tag: "page" };
  await write("F", "---\ntags:\n- a\n- b\n---\nBody\n");
  await updateObject(page, { tags: ["c"] });
  expect(await read("F")).toBe("---\ntags:\n  - c\n---\nBody\n");
});

test("C4: data values keep their type", async () => {
  await write("D", "```#e\nv: 1\n```\n");
  for (const v of ["2026-11-01", "-12", "0x1F", "~", " pad", "a\nb", "- x"]) {
    const [e] = (await objectsOf(await read("D"), "D")).filter(
      (o) => o.tag === "e",
    );
    await updateObject(e as any, { v });
    const [after] = (await objectsOf(await read("D"), "D")).filter(
      (o) => o.tag === "e",
    );
    expect(after.v).toBe(v);
  }
});

test("C5: inline values with brackets round-trip", async () => {
  await write("N", "* [ ] T\n");
  for (const v of ["a]b", "[x", { a: "]" }]) {
    const [t] = await tasksOf("N");
    await updateObject(t as any, { v });
    const [after] = await tasksOf("N");
    expect(after.v).toEqual(v);
    expect(after.name).toBe("T");
  }
});

test("C6: listing the same object twice fails and writes nothing", async () => {
  const page = { page: "F", ref: "F", tag: "page" };
  await write("F", "---\na: 1\n---\n");
  await expect(updateObject([page, page], { b: 2 })).rejects.toThrow(
    "object.update: the same object is listed twice",
  );
  expect(await read("F")).toBe("---\na: 1\n---\n");
});

test("I7: nested items can be updated and deleted", async () => {
  await write("N", "* Parent #x\n  * Child #x\n");
  const child = (await objectsOf(await read("N"), "N")).find(
    (o) => o.name === "Child",
  )!;
  await updateObject(child as any, { k: 1 });
  expect(await read("N")).toBe("* Parent #x\n  * Child #x [k: 1]\n");
  const again = (await objectsOf(await read("N"), "N")).find(
    (o) => o.name === "Child",
  )!;
  await deleteObject(again as any);
  expect(await read("N")).toBe("* Parent #x\n");
});

test("I8: two documents in one block can be updated in one batch, and deleted", async () => {
  await write("D", "```#e\nv: 1\n---\nv: 2\n---\nv: 3\n```\n");
  const docs = (await objectsOf(await read("D"), "D")).filter(
    (o) => o.tag === "e",
  );
  await updateObject(docs as any, { paid: true });
  expect(await read("D")).toBe(
    "```#e\nv: 1\npaid: true\n---\nv: 2\npaid: true\n---\nv: 3\npaid: true\n```\n",
  );
  const [first, second, third] = (await objectsOf(await read("D"), "D")).filter(
    (o) => o.tag === "e",
  );
  await deleteObject(second as any);
  expect(await read("D")).toBe(
    "```#e\nv: 1\npaid: true\n---\nv: 3\npaid: true\n```\n",
  );
  void first;
  void third;
  const [, last] = (await objectsOf(await read("D"), "D")).filter(
    (o) => o.tag === "e",
  );
  await deleteObject(last as any);
  expect(await read("D")).toBe("```#e\nv: 1\npaid: true\n```\n");
  const [only] = (await objectsOf(await read("D"), "D")).filter(
    (o) => o.tag === "e",
  );
  await deleteObject(only as any);
  expect(await read("D")).toBe("");
});

test("I9: on the open page, edits are planned against the text at dispatch time", async () => {
  await write("Open", "* [ ] A #x\n");
  let text = "* [ ] A #x\n";
  let reads = 0;
  const dispatched: any[] = [];
  mock.system.registerSyscalls([], {
    "editor.getCurrentPage": { callback: () => "Open" },
    "editor.getText": {
      callback: () => {
        reads++;
        // The user typed a line above after the first read
        if (reads === 2) text = `New\n${text}`;
        return text;
      },
    },
    "editor.dispatch": {
      callback: (_ctx: any, spec: any) => {
        dispatched.push(spec);
        let out = text;
        for (const c of [...spec.changes].sort(
          (a: any, b: any) => b.from - a.from,
        )) {
          out = out.slice(0, c.from) + c.insert + out.slice(c.to);
        }
        text = out;
      },
    },
    "editor.save": { callback: () => {} },
  } as any);
  await updateObject(
    { page: "Open", ref: "Open@0", tag: "task", text: "A #x" },
    {
      done: true,
    },
  ).catch(() => {});
  // Either the stale plan is refused, or it's re-planned on the new text;
  // never applied at the old offsets
  expect(text).not.toBe("[x]w\n* [ ] A #x\n");
  expect(text.startsWith("New\n")).toBe(true);
});

test("I10: an anchored table row keeps its anchor and a clean value", async () => {
  await write("T", "| What | Amount |\n|---|---|\n");
  const ref = await appendObject(
    "T",
    { tag: "table", what: "Tram", amount: 2 },
    { anchor: "tram" },
  );
  const [row] = (await objectsOf(await read("T"), "T")).filter(
    (o) => o.tag === "table",
  );
  expect(row.ref).toBe("tram");
  expect(row.amount).toBe("2");
  await updateObject(ref, { amount: 3 });
  await updateObject(ref, { amount: 4 });
  const [after] = (await objectsOf(await read("T"), "T")).filter(
    (o) => o.tag === "table",
  );
  expect(after.ref).toBe("tram");
  expect(after.amount).toBe("4");
});

test("I11: a name with newlines stays on one line", async () => {
  await write("N", "* [ ] T\n* [ ] U\n");
  const [t] = await tasksOf("N");
  await updateObject(t as any, { name: "a\n\n# boom" });
  expect(await read("N")).toBe("* [ ] a # boom\n* [ ] U\n");
});

test("I12: a batch across pages writes nothing if one page fails", async () => {
  await write("P1", "* [ ] A #x\n");
  await write("P2", "* [ ] B #x\n");
  const [a] = await tasksOf("P1");
  const [b] = await tasksOf("P2");
  await write("P2", "Intro\n\n* [ ] B #x\n");
  await expect(updateObject([a, b] as any, { done: true })).rejects.toThrow(
    "object moved",
  );
  expect(await read("P1")).toBe("* [ ] A #x\n");
});

test("a batch retry after a page changed doesn't replan pages already written", async () => {
  await write("P1", "* [ ] A #x\n");
  await write("P2", "* [ ] B #x\n");
  const [a] = await tasksOf("P1");
  const [b] = await tasksOf("P2");
  const syscall = globalThis.syscall;
  let changed = false;
  globalThis.syscall = async (name: string, ...args: any[]) => {
    const result = await syscall(name, ...args);
    // Someone edits P2 right after P1 is written
    if (name === "space.writePage" && args[0] === "P1" && !changed) {
      changed = true;
      await syscall("space.writePage", "P2", "* [ ] B #x\n\nMore\n");
    }
    return result;
  };
  try {
    await updateObject([a, b] as any, { owner: "Ada" });
  } finally {
    globalThis.syscall = syscall;
  }
  expect(await read("P1")).toBe("* [ ] A #x [owner: Ada]\n");
  expect(await read("P2")).toBe("* [ ] B #x [owner: Ada]\n\nMore\n");
});
