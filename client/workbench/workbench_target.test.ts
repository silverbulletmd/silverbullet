import { expect, test, vi } from "vitest";
import { WORKBENCH_VIEW } from "../navigator/views/workbench.ts";
import {
  onWorkbenchTarget,
  openWorkbench,
  takeWorkbenchTarget,
} from "./workbench_target.ts";

vi.mock("../navigator/navigator.ts", () => ({ showView: vi.fn() }));

test("the target waits before the Workbench shows, and is taken once by its tab", async () => {
  const show = vi.fn(async () => {
    expect(takeWorkbenchTarget("Code")).toBeUndefined();
    expect(takeWorkbenchTarget("Libraries")).toEqual({
      tab: "Libraries",
      focus: "install",
    });
  });
  await openWorkbench({ tab: "Libraries", focus: "install" }, show);
  expect(show).toHaveBeenCalledWith(WORKBENCH_VIEW, { segment: "Libraries" });
  expect(takeWorkbenchTarget("Libraries")).toBeUndefined();
});

test("a later target replaces one not yet taken", async () => {
  const show = vi.fn(async () => {});
  await openWorkbench({ tab: "Code", section: "style" }, show);
  await openWorkbench({ tab: "Health" }, show);
  expect(takeWorkbenchTarget("Code")).toBeUndefined();
});

test("a failing show drops the target and rethrows", async () => {
  const show = vi.fn(async () => {
    throw new Error("no view");
  });
  await expect(
    openWorkbench({ tab: "Data", view: "schema" }, show),
  ).rejects.toThrow("no view");
  expect(takeWorkbenchTarget("Data")).toBeUndefined();
});

test("listeners hear targets until they unsubscribe", async () => {
  const listener = vi.fn();
  const off = onWorkbenchTarget(listener);
  await openWorkbench({ tab: "Code", section: "lua" }, async () => {});
  expect(listener).toHaveBeenCalledTimes(1);
  off();
  await openWorkbench({ tab: "Code", section: "style" }, async () => {});
  expect(listener).toHaveBeenCalledTimes(1);
  takeWorkbenchTarget("Code");
});
