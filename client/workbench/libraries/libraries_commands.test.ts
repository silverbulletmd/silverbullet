import { describe, expect, test, vi } from "vitest";
import { LIBRARY_COMMANDS, runLibraryUpdate } from "./libraries_commands.ts";

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
});
