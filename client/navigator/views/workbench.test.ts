import { expect, test } from "vitest";
import { WORKBENCH_TABS, workbenchView } from "./workbench.ts";

test("Overview is the first tab, and the Workbench opens on it", () => {
  expect([...WORKBENCH_TABS]).toEqual([
    "Overview",
    "Query",
    "Console",
    "Scripts",
    "Styles",
    "Libraries",
    "Health",
  ]);
  expect(workbenchView.segments?.find((s) => s.default)?.label).toBe(
    "Overview",
  );
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
