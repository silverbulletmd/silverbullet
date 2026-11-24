import { describe, expect, test } from "vitest";
import { planFolderSync } from "./folder_sync.ts";

const plan = (known: string[], primary: string[], secondary: string[]) =>
  planFolderSync(new Set(known), new Set(primary), new Set(secondary));

describe("planFolderSync", () => {
  test("a folder on one side only, unknown before, is created on the other", () => {
    expect(plan([], ["A", "A/B"], ["C"])).toEqual({
      creates: [
        { on: "secondary", path: "A" },
        { on: "primary", path: "C" },
        { on: "secondary", path: "A/B" },
      ],
      deletes: [],
      present: [],
      gone: [],
    });
  });

  test("a known folder missing on one side is deleted on the other, deepest first", () => {
    expect(plan(["A", "A/B"], [], ["A", "A/B"]).deletes).toEqual([
      { on: "secondary", path: "A/B" },
      { on: "secondary", path: "A" },
    ]);
  });

  test("folders on both sides or on neither only update what's known", () => {
    expect(plan(["Gone"], ["Both"], ["Both"])).toEqual({
      creates: [],
      deletes: [],
      present: ["Both"],
      gone: ["Gone"],
    });
  });
});
