import { beforeEach, expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { applyEdits } from "./object_edit.ts";
import {
  planDataAppend,
  planDataDelete,
  planDataUpdate,
} from "./object_edit_data.ts";
import { objectsOf, planCtx } from "./object_test_util.ts";

beforeEach(() => {
  createMockSystem();
});

const page =
  "Trip\n\n```#expense\nwhat: Tram\namount: 12.5\n---\nwhat: Bus\namount: 3\n```\n";

async function expenses(text: string) {
  return (await objectsOf(text)).filter((o) => o.tag === "expense");
}

test("update patches one document only", async () => {
  const [, bus] = await expenses(page);
  expect(
    applyEdits(
      page,
      planDataUpdate(planCtx(page), bus, { amount: 4, paid: true }, ["what"]),
    ),
  ).toBe(
    "Trip\n\n```#expense\nwhat: Tram\namount: 12.5\n---\namount: 4\npaid: true\n```\n",
  );
});

test("delete removes a document, or the whole block for the last one", async () => {
  const [tram] = await expenses(page);
  const once = applyEdits(page, planDataDelete(planCtx(page), tram));
  expect(once).toBe("Trip\n\n```#expense\nwhat: Bus\namount: 3\n```\n");
  const [bus] = await expenses(once);
  expect(applyEdits(once, planDataDelete(planCtx(once), bus))).toBe("Trip\n\n");
});

test("append adds a document to the last block of that tag, or a new block", () => {
  const ctx = planCtx(page);
  expect(
    applyEdits(
      page,
      planDataAppend(ctx, { tag: "expense", what: "Taxi" }, "e-1"),
    ),
  ).toBe(
    "Trip\n\n```#expense\nwhat: Tram\namount: 12.5\n---\nwhat: Bus\namount: 3\n---\n$ref: e-1\nwhat: Taxi\n```\n",
  );
  expect(
    applyEdits(
      "Trip\n",
      planDataAppend(
        planCtx("Trip\n"),
        { tag: "expense", what: "Taxi" },
        undefined,
      ),
    ),
  ).toBe("Trip\n\n```#expense\nwhat: Taxi\n```\n");
});

test("the appended document is indexed as an object of that tag", async () => {
  const text = applyEdits(
    page,
    planDataAppend(planCtx(page), { tag: "expense", what: "Taxi" }, undefined),
  );
  expect((await expenses(text)).map((e) => e.what)).toEqual([
    "Tram",
    "Bus",
    "Taxi",
  ]);
});
