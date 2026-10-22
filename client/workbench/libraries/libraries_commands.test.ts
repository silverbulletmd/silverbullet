import { describe, expect, test, vi } from "vitest";
import { WORKBENCH_VIEW } from "../../navigator/views/workbench.ts";
import {
  LIBRARY_COMMANDS,
  runLibraryCommand,
  runLibraryUpdate,
} from "./libraries_commands.ts";
import { takeLibrariesFocus } from "./libraries_focus.ts";

test("the commands keep their names, order and focus", () => {
  expect(LIBRARY_COMMANDS.map((c) => [c.name, c.focus])).toEqual([
    ["Libraries: Manager", "manager"],
    ["Library: Manager", "manager"],
    ["Library: Install", "install"],
    ["Library: Add Repository", "addRepository"],
    ["Library: Update All", "updateAll"],
    ["Library: Update All Repositories", "updateAllRepositories"],
  ]);
});

test("the Manager commands also work in a read-only space; the others write", () => {
  expect(LIBRARY_COMMANDS.map((c) => [c.name, c.requireMode])).toEqual([
    ["Libraries: Manager", undefined],
    ["Library: Manager", undefined],
    ["Library: Install", "rw"],
    ["Library: Add Repository", "rw"],
    ["Library: Update All", "rw"],
    ["Library: Update All Repositories", "rw"],
  ]);
});

test("only Libraries: Manager has menu entries", () => {
  const [manager, ...rest] = LIBRARY_COMMANDS;
  expect(manager.menuMac).toEqual({
    location: "app",
    group: "4_prefs",
    order: 3,
    label: "Libraries...",
  });
  expect(manager.menu).toEqual({
    location: "file",
    group: "2_prefs",
    order: 3,
    label: "Libraries...",
  });
  for (const c of rest) {
    expect(c.menu).toBeUndefined();
    expect(c.menuMac).toBeUndefined();
  }
});

test("a command requests its focus before showing the Workbench, once", async () => {
  const showView = vi.fn(async () => {
    // The request must already be waiting when the tab shows
    expect(takeLibrariesFocus()).toBe("install");
  });
  const result = await runLibraryCommand("install", showView);
  expect(showView).toHaveBeenCalledTimes(1);
  expect(showView).toHaveBeenCalledWith(WORKBENCH_VIEW, {
    segment: "Libraries",
  });
  expect(takeLibrariesFocus()).toBeUndefined();
  expect(result).toBe(false);
});

test("a failing show clears the pending request and rethrows", async () => {
  const showView = vi.fn(async () => {
    throw new Error("no view");
  });
  await expect(runLibraryCommand("install", showView)).rejects.toThrow(
    "no view",
  );
  expect(takeLibrariesFocus()).toBeUndefined();
});

describe("runLibraryUpdate", () => {
  test("says what was updated", async () => {
    const notify = vi.fn();
    const update = vi.fn(async () => ({ changed: true }));
    await runLibraryUpdate([{ name: "Library/A" }], update, notify);
    expect(update).toHaveBeenCalledWith("Library/A");
    expect(notify).toHaveBeenCalledWith("Updated Library/A", "info");
  });

  test("says when nothing changed", async () => {
    const notify = vi.fn();
    await runLibraryUpdate(
      [{ name: "Library/A" }],
      async () => ({ changed: false }),
      notify,
    );
    expect(notify).toHaveBeenCalledWith(
      "Library/A is already up to date",
      "info",
    );
  });

  test("reports a failure as an error notification", async () => {
    const notify = vi.fn();
    await runLibraryUpdate(
      [{ name: "Library/A" }],
      async () => {
        throw new Error("boom");
      },
      notify,
    );
    expect(notify).toHaveBeenCalledWith("boom", "error");
  });

  test("reports a thrown non-Error as its text", async () => {
    const notify = vi.fn();
    await runLibraryUpdate(
      [{ name: "Library/A" }],
      async () => {
        throw "offline";
      },
      notify,
    );
    expect(notify).toHaveBeenCalledWith("offline", "error");
  });

  test("rejects a call without a name", async () => {
    const notify = vi.fn();
    const update = vi.fn();
    await runLibraryUpdate([], update, notify);
    expect(update).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Library: Update needs a library name",
      "error",
    );
  });
});
