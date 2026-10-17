import { expect, test } from "vitest";
import { WORKBENCH_TABS, workbenchView } from "./workbench.ts";

test("Query is the first tab, and the Workbench opens on it", () => {
  expect(WORKBENCH_TABS[0]).toBe("Query");
  expect(workbenchView.segments?.find((s) => s.default)?.label).toBe("Query");
});

test("the Workbench can dock at the bottom, either side, or open as a modal", () => {
  expect(workbenchView.meta.dock).toBe("bhs");
  expect(workbenchView.meta.supportedDocks).toEqual([
    "bhs",
    "rhs",
    "lhs",
    "modal",
  ]);
});
