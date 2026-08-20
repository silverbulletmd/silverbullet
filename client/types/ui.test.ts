import { expect, test } from "vitest";
import { syncMessageNotification } from "./ui.ts";

test("syncMessageNotification maps sync-conflict to an error notification", () => {
  const result = syncMessageNotification({
    type: "sync-conflict",
    path: "foo/bar.md",
  });
  expect(result?.style).toEqual("error");
  expect(result?.text).toContain("foo/bar.md");
});

test("syncMessageNotification maps suppressed-deletion to an info notification", () => {
  const result = syncMessageNotification({
    type: "suppressed-deletion",
    path: "foo/bar.md",
  });
  expect(result?.style).toEqual("info");
  expect(result?.text).toContain("foo/bar.md");
});

test("syncMessageNotification returns null for unrelated message types", () => {
  expect(
    syncMessageNotification({
      type: "space-sync-complete",
      operations: 3,
    }),
  ).toBeNull();
});
