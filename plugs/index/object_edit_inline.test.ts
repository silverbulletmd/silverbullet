import { beforeEach, expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { applyEdits } from "./object_edit.ts";
import {
  planInlineAppend,
  planInlineDelete,
  planInlineUpdate,
} from "./object_edit_inline.ts";
import { objectsOf, planCtx } from "./object_test_util.ts";

beforeEach(() => {
  createMockSystem();
});

async function update(
  text: string,
  tag: "task" | "item" | "paragraph",
  patch: Record<string, unknown>,
  remove: string[] = [],
) {
  const found = (await objectsOf(text)).find((o) => o.tag === tag)!;
  return applyEdits(
    text,
    planInlineUpdate(planCtx(text), found, tag, patch, remove),
  );
}

const task = "* [ ] Call Pete #crm [due: 2026-11-01] $call-pete\n  * sub\n";

test("sets, replaces and removes attributes, keeping the anchor last", async () => {
  expect(await update(task, "task", { due: "2026-12-01", owner: "Ada" })).toBe(
    '* [ ] Call Pete #crm [due: "2026-12-01"] [owner: Ada] $call-pete\n  * sub\n',
  );
  expect(await update(task, "task", {}, ["due"])).toBe(
    "* [ ] Call Pete #crm $call-pete\n  * sub\n",
  );
});

test("done and state change the marker", async () => {
  expect(await update(task, "task", { done: true })).toBe(
    "* [x] Call Pete #crm [due: 2026-11-01] $call-pete\n  * sub\n",
  );
  expect(await update(task, "task", { state: "waiting" })).toBe(
    "* [waiting] Call Pete #crm [due: 2026-11-01] $call-pete\n  * sub\n",
  );
  await expect(update("* Plain #x\n", "item", { done: true })).rejects.toThrow(
    "only tasks have a state",
  );
});

test("name replaces the text, keeping tags, attributes and anchor", async () => {
  expect(await update(task, "task", { name: "Email Pete" })).toBe(
    "* [ ] Email Pete #crm [due: 2026-11-01] $call-pete\n  * sub\n",
  );
  expect(
    await update("* See [[Pete]] about #crm stuff\n", "item", {
      name: "Done",
    }),
  ).toBe("* Done #crm\n");
});

test("tags replaces the item's own hashtags", async () => {
  expect(await update(task, "task", { tags: ["sales", "q4"] })).toBe(
    "* [ ] Call Pete [due: 2026-11-01] #sales #q4 $call-pete\n  * sub\n",
  );
  expect(await update(task, "task", { tags: "sales" })).toBe(
    "* [ ] Call Pete [due: 2026-11-01] #sales $call-pete\n  * sub\n",
  );
});

test("paragraph text and attributes", async () => {
  const para = "Intro\n\nMeeting notes [room: 4] #meeting\n\nAfter\n";
  expect(await update(para, "paragraph", { text: "Standup", room: 5 })).toBe(
    "Intro\n\nStandup [room: 5] #meeting\n\nAfter\n",
  );
});

test("an empty patch changes nothing", async () => {
  const found = (await objectsOf(task)).find((o) => o.tag === "task")!;
  expect(planInlineUpdate(planCtx(task), found, "task", {}, [])).toEqual([]);
});

test("delete removes the item with its sub-items, and a paragraph with one blank line", async () => {
  const text = "* [ ] A #x\n  * child\n* [ ] B #x\n";
  const a = (await objectsOf(text)).find((o) => o.tag === "task")!;
  expect(applyEdits(text, planInlineDelete(planCtx(text), a, "task"))).toBe(
    "* [ ] B #x\n",
  );
  const para = "Intro\n\nGone #x\n\nAfter\n";
  const p = (await objectsOf(para)).find((o) => o.tag === "paragraph")!;
  expect(
    applyEdits(para, planInlineDelete(planCtx(para), p, "paragraph")),
  ).toBe("Intro\n\nAfter\n");
});

test("append adds a task at the end, or at the end of a section", () => {
  const text = "# Todo\n* [ ] A\n\n# Done\nNothing\n";
  const ctx = planCtx(text);
  expect(
    applyEdits(
      text,
      planInlineAppend(
        ctx,
        { tag: "task", name: "B", due: "2026-11-01", tags: "crm" },
        "task-1a2b",
        "Todo",
      ),
    ),
  ).toBe(
    '# Todo\n* [ ] A\n* [ ] B #crm [due: "2026-11-01"] $task-1a2b\n\n# Done\nNothing\n',
  );
  expect(
    applyEdits(
      text,
      planInlineAppend(
        ctx,
        { tag: "item", name: "Note" },
        undefined,
        undefined,
      ),
    ),
  ).toBe("# Todo\n* [ ] A\n\n# Done\nNothing\n\n* Note\n");
  expect(() =>
    planInlineAppend(ctx, { tag: "item", name: "x" }, undefined, "Missing"),
  ).toThrow('no header "Missing"');
});
