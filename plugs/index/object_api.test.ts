import { beforeEach, expect, test } from "vitest";
import { evalStatement } from "../../client/space_lua/eval.ts";
import { parseBlock } from "../../client/space_lua/parse.ts";
import {
  LuaEnv,
  LuaNativeJSFunction,
  LuaStackFrame,
  LuaTable,
} from "../../client/space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../../client/space_lua/stdlib.ts";
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

test("update reorders page and data block keys", async () => {
  const page = { page: "Contacts/Pete", ref: "Contacts/Pete", tag: "page" };
  await write(
    "Contacts/Pete",
    "---\ntags: contact\nrole: lead\nage: 55\n---\nHi\n",
  );
  await updateObject(page, {}, { order: ["tags", "age", "role"] });
  expect(await read("Contacts/Pete")).toBe(
    "---\ntags: contact\nage: 55\nrole: lead\n---\nHi\n",
  );

  await write("D", "```#c\nname: Ada\nage: 36\n---\nname: Bob\nage: 40\n```\n");
  const [, bob] = (await objectsOf(await read("D"), "D")).filter(
    (o) => o.tag === "c",
  );
  await updateObject(bob as any, {}, { order: ["age", "name"] });
  expect(await read("D")).toBe(
    "```#c\nname: Ada\nage: 36\n---\nage: 40\nname: Bob\n```\n",
  );
});

test("reordering a data document leaves no blank line before the fence", async () => {
  await write("D", "```#c\nname: Ada\n\nage: 36\n```\n");
  const [ada] = (await objectsOf(await read("D"), "D")).filter(
    (o) => o.tag === "c",
  );
  await updateObject(ada as any, {}, { order: ["age", "name"] });
  expect(await read("D")).toBe("```#c\nage: 36\nname: Ada\n```\n");
});

test("order is refused for objects that aren't YAML", async () => {
  await write("Notes", "* [ ] A #x\n");
  const [a] = await tasksOf("Notes");
  await expect(updateObject(a as any, {}, { order: ["done"] })).rejects.toThrow(
    "object.update: order only applies to pages and data block objects, not a task",
  );
  await expect(
    updateObject(a as any, {}, { order: "done" as any }),
  ).rejects.toThrow("order must be a list of attribute names");
  expect(await read("Notes")).toBe("* [ ] A #x\n");
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

const personSchema = {
  person: {
    schema: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["Designer", "Engineer"] },
      },
    },
  },
};

test("a page that already fails its schema still accepts an unrelated edit", async () => {
  mock.config.set("tags", personSchema);
  const page = { page: "Person/Bob", ref: "Person/Bob", tag: "page" };
  await write("Person/Bob", "---\ntags: person\nrole: Intern\n---\nBob\n");
  await updateObject(page, { email: "bob@example.com" });
  expect(await read("Person/Bob")).toBe(
    "---\ntags: person\nrole: Intern\nemail: bob@example.com\n---\nBob\n",
  );
});

test("a valid page still refuses an edit that breaks its schema", async () => {
  mock.config.set("tags", personSchema);
  const page = { page: "Person/Bob", ref: "Person/Bob", tag: "page" };
  await write("Person/Bob", "---\ntags: person\nrole: Engineer\n---\nBob\n");
  await expect(updateObject(page, { role: "Intern" })).rejects.toThrow(
    "object.update: role:",
  );
  expect(await read("Person/Bob")).toBe(
    "---\ntags: person\nrole: Engineer\n---\nBob\n",
  );
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
  expect(await read("F")).toBe("---\ntags:\n- c\n---\nBody\n");
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

test("concurrent updates to the open page both land and keep the page intact", async () => {
  let text = "---\ntags: project\nstatus: active\n---\n# Apollo\nBody\n";
  await write("Projects/Apollo", text);
  mock.system.registerSyscalls([], {
    "editor.getCurrentPage": { callback: () => "Projects/Apollo" },
    "editor.getText": { callback: () => text },
    "editor.dispatch": {
      callback: (_ctx: any, spec: any) => {
        for (const c of [...spec.changes].sort(
          (a: any, b: any) => b.from - a.from,
        )) {
          text = text.slice(0, c.from) + c.insert + text.slice(c.to);
        }
      },
    },
    "editor.save": { callback: () => {} },
  } as any);
  const page = { page: "Projects/Apollo", ref: "Projects/Apollo", tag: "page" };
  await Promise.all([
    updateObject(page, { status: "done" }),
    updateObject(page, { budget: 20000 }),
  ]);
  expect(text).toBe(
    "---\ntags: project\nstatus: done\nbudget: 20000\n---\n# Apollo\nBody\n",
  );
});

test("an edit waiting its turn while the user navigates lands on its own page", async () => {
  await write("Projects/Apollo", "---\nstatus: active\n---\nBody\n");
  await write("Projects/Zeus", "---\nstatus: planned\n---\nZeus\n");
  let current = "Projects/Apollo";
  let text = await read(current);
  let entered!: () => void;
  const dispatching = new Promise<void>((r) => (entered = r));
  let proceed!: () => void;
  const gate = new Promise<void>((r) => (proceed = r));
  const dispatched: string[] = [];
  mock.system.registerSyscalls([], {
    "editor.getCurrentPage": { callback: () => current },
    "editor.getText": { callback: () => text },
    "editor.dispatch": {
      callback: async (_ctx: any, spec: any) => {
        dispatched.push(current);
        for (const c of [...spec.changes].sort(
          (a: any, b: any) => b.from - a.from,
        )) {
          text = text.slice(0, c.from) + c.insert + text.slice(c.to);
        }
        entered();
        await gate;
      },
    },
    "editor.save": { callback: () => write(current, text) },
  } as any);
  const apollo = {
    page: "Projects/Apollo",
    ref: "Projects/Apollo",
    tag: "page",
  };
  const first = updateObject(apollo, { status: "done" });
  await dispatching;
  // Queues behind the first edit, which holds the open page's turn
  const second = updateObject(apollo, { budget: 20000 });
  await new Promise((r) => setTimeout(r, 20));
  // The user navigates to another page meanwhile
  await write(current, text);
  current = "Projects/Zeus";
  text = await read(current);
  proceed();
  await withinTwoSeconds(Promise.all([first, second]));
  expect(dispatched).toEqual(["Projects/Apollo"]);
  expect(await read("Projects/Apollo")).toBe(
    "---\nstatus: done\nbudget: 20000\n---\nBody\n",
  );
  expect(await read("Projects/Zeus")).toBe("---\nstatus: planned\n---\nZeus\n");
  expect(text).toBe("---\nstatus: planned\n---\nZeus\n");
});

function withinTwoSeconds<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timed out: edits deadlocked")), 2000),
    ),
  ]);
}

test("a page:saved listener can edit the page it was told about", async () => {
  await write("Projects/Apollo", "---\nstatus: active\n---\nBody\n");
  await mock.spacePrimitives.enable();
  let nested: Promise<void> | undefined;
  mock.eventHook.addLocalListener("page:saved", async (name: string) => {
    if (name !== "Projects/Apollo" || nested) return;
    nested = updateObject(
      { page: "Projects/Apollo", ref: "Projects/Apollo", tag: "page" },
      { reviewed: true },
    );
    await nested;
  });
  await withinTwoSeconds(
    updateObject(
      { page: "Projects/Apollo", ref: "Projects/Apollo", tag: "page" },
      { status: "done" },
    ),
  );
  await withinTwoSeconds(nested!);
  expect(await read("Projects/Apollo")).toBe(
    "---\nstatus: done\nreviewed: true\n---\nBody\n",
  );
});

test("an editor:pageSaved listener can edit the open page", async () => {
  let text = "---\nstatus: active\n---\nBody\n";
  await write("Projects/Apollo", text);
  const page = { page: "Projects/Apollo", ref: "Projects/Apollo", tag: "page" };
  let nested: Promise<void> | undefined;
  mock.system.registerSyscalls([], {
    "editor.getCurrentPage": { callback: () => "Projects/Apollo" },
    "editor.getText": { callback: () => text },
    "editor.dispatch": {
      callback: (_ctx: any, spec: any) => {
        for (const c of [...spec.changes].sort(
          (a: any, b: any) => b.from - a.from,
        )) {
          text = text.slice(0, c.from) + c.insert + text.slice(c.to);
        }
      },
    },
    // Saving waits for editor:pageSaved listeners, one of which edits again
    "editor.save": {
      callback: async () => {
        if (nested) return;
        nested = updateObject(page, { reviewed: true });
        await nested;
      },
    },
  } as any);
  await withinTwoSeconds(updateObject(page, { status: "done" }));
  await withinTwoSeconds(nested!);
  expect(text).toBe("---\nstatus: done\nreviewed: true\n---\nBody\n");
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

test("a page object from a query can be updated and deleted", async () => {
  await write("Tagged", "#the-tag\n\nHello\n");
  // As the page indexer stores it: no page field, the name is the ref
  const page = {
    ref: "Tagged",
    tag: "page",
    name: "Tagged",
    tags: ["the-tag"],
    perm: "rw",
    lastModified: "",
    created: "",
  };
  await updateObject(page as any, { bla: "zef" });
  expect(await read("Tagged")).toBe("---\nbla: zef\n---\n#the-tag\n\nHello\n");
  await deleteObject(page as any);
  await expect(read("Tagged")).rejects.toThrow();
});

test("a Date made in Space Lua reaches object.update as a Date and is written as a bare date", async () => {
  await write("Projects/Apollo", "---\ndue: 2026-12-01\n---\nBody\n");
  const received: unknown[][] = [];
  // Wired like exposeSyscalls; structuredClone stands in for the
  // postMessage to the plug worker
  const G = luaBuildStandardEnv();
  G.set(
    "object",
    new LuaTable({
      update: new LuaNativeJSFunction((...args) => {
        const cloned = structuredClone(args);
        received.push(cloned);
        return updateObject(cloned[0], cloned[1], cloned[2]);
      }),
    }),
  );
  const ast = parseBlock(
    `object.update({ page = "Projects/Apollo", ref = "Projects/Apollo" }, { due = js.new(js.window.Date, "2026-12-15") })`,
  );
  await evalStatement(
    ast,
    new LuaEnv(G),
    LuaStackFrame.createWithGlobalEnv(G, ast.ctx),
    false,
  );
  expect((received[0][1] as { due: unknown }).due).toBeInstanceOf(Date);
  expect(await read("Projects/Apollo")).toBe(
    "---\ndue: 2026-12-15\n---\nBody\n",
  );
});
