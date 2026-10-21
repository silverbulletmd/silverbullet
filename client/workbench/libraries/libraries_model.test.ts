import { describe, expect, test, vi } from "vitest";
import type { LibrariesViewModel } from "./libraries_backend.ts";
import {
  onLibrariesFocus,
  requestLibrariesFocus,
  takeLibrariesFocus,
} from "./libraries_focus.ts";
import {
  confirmThen,
  EMPTY_LIBRARIES,
  initialLibrariesState,
  isLoading,
  type LibrariesEvent,
  type LibrariesState,
  librariesReducer,
  libraryLists,
  plural,
  removeMessage,
  revertMessage,
  rowActions,
  rowKey,
  runTask,
  toolbar,
  updateAllLibraries,
  whileShowing,
} from "./libraries_model.ts";

/** Runs `run` against a reducer, returning the state it ends in. */
async function drive(
  state: LibrariesState,
  run: (dispatch: (e: LibrariesEvent) => void) => Promise<unknown>,
) {
  let current = state;
  await run((e) => {
    current = librariesReducer(current, e);
  });
  return current;
}

const sample: LibrariesViewModel = {
  installed: [
    { name: "Library/Std/Core" },
    {
      name: "Library/Acme/Tools",
      uri: "github:acme/tools/Tools.md",
      mode: "pull",
    },
    {
      name: "Library/Mine/Draft",
      uri: "github:me/draft/Draft.md",
      mode: "push",
    },
  ],
  installable: [
    {
      name: "Gadgets",
      description: "Gadgets from Acme",
      uri: "github:acme/gadgets.md",
      repositoryPage: "Repositories/Acme",
    },
    {
      name: "Basics",
      uri: "github:std/basics.md",
      repositoryPage: "Repositories/Std",
    },
  ],
  repositories: [
    { name: "Repositories/Std" },
    {
      name: "Repositories/Acme",
      uri: "https://example.com/acme.md",
      mode: "pull",
    },
  ],
  roguePlugs: [{ path: "_plug/stray.plug.js" }],
};

describe("running a task", () => {
  test("a failure sets the section's error and clears its info", async () => {
    let state = librariesReducer(initialLibrariesState(), {
      type: "info",
      section: "available",
      message: "Installed earlier",
    });
    const refresh = vi.fn(async () => {});
    let result: unknown;
    state = await drive(state, async (dispatch) => {
      result = await runTask(
        { refresh, dispatch },
        "k",
        "available",
        async () => {
          throw new Error("Read-only space");
        },
      );
    });
    expect(result).toEqual({ ok: false, error: "Read-only space" });
    expect(state.errors.available).toBe("Read-only space");
    expect(state.infos.available).toBeUndefined();
    expect(state.busy.size).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a success refreshes and returns its data, busy meanwhile", async () => {
    const refresh = vi.fn(async () => {});
    let result: unknown;
    let busyDuring = false;
    const state = await drive(initialLibrariesState(), async (dispatch) => {
      let s = initialLibrariesState();
      result = await runTask(
        {
          refresh,
          dispatch: (e) => {
            s = librariesReducer(s, e);
            dispatch(e);
          },
        },
        "k",
        "installed",
        async () => {
          busyDuring = s.busy.has("k");
          return { changed: true };
        },
      );
    });
    expect(busyDuring).toBe(true);
    expect(result).toEqual({ ok: true, data: { changed: true } });
    expect(refresh).toHaveBeenCalledOnce();
    expect(state.errors.installed).toBeUndefined();
  });

  test("a task that only reads can skip the refresh", async () => {
    const refresh = vi.fn(async () => {});
    await runTask(
      { refresh, dispatch: () => {} },
      "k",
      "installed",
      async () => 1,
      {
        refresh: false,
      },
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("update checks", () => {
  const checked = () =>
    librariesReducer(initialLibrariesState(), {
      type: "checked",
      checks: {
        "Library/Acme/Tools": { state: "remoteChanged" },
        "Library/Acme/Other": { state: "upToDate" },
        "Library/Gone": { state: "upToDate" },
      },
      at: 5,
    });

  test("survive a refresh for rows that are still there", () => {
    const state = librariesReducer(checked(), {
      type: "loaded",
      data: {
        ...sample,
        installed: [
          { name: "Library/Acme/Tools", uri: "x", mode: "pull" },
          { name: "Library/Acme/Other", uri: "y", mode: "pull" },
        ],
      },
    });
    expect(Object.keys(state.checks ?? {}).sort()).toEqual([
      "Library/Acme/Other",
      "Library/Acme/Tools",
    ]);
    expect(state.checkedAt).toBe(5);
    expect(state.loaded).toBe(true);
  });

  test("after an update only that row loses its label", () => {
    const state = librariesReducer(checked(), {
      type: "unchecked",
      names: ["Library/Acme/Tools"],
    });
    expect(Object.keys(state.checks ?? {}).sort()).toEqual([
      "Library/Acme/Other",
      "Library/Gone",
    ]);
  });

  test("a new check replaces all results", () => {
    const state = librariesReducer(checked(), {
      type: "checked",
      checks: { "Library/New": { state: "upToDate" } },
      at: 9,
    });
    expect(Object.keys(state.checks ?? {})).toEqual(["Library/New"]);
    expect(state.checkedAt).toBe(9);
  });

  test("rows carry their check", () => {
    const { installed, repositories } = libraryLists(sample, "", {
      "Library/Acme/Tools": { state: "remoteChanged" },
      "Repositories/Acme": { state: "upToDate" },
    });
    expect(installed[1].check).toEqual({ state: "remoteChanged" });
    expect(installed[0].check).toBeUndefined();
    expect(repositories[1].check).toEqual({ state: "upToDate" });
  });
});

describe("lists", () => {
  test("an empty view model gives all three empty states", () => {
    const lists = libraryLists(EMPTY_LIBRARIES, "");
    expect(lists.installed).toEqual([]);
    expect(lists.groups).toEqual([]);
    expect(lists.repositories).toEqual([]);
    expect(lists.updatable).toBe(0);
    // Before the first load the tab shows the same empty lists, not a spinner
    expect(initialLibrariesState().data).toEqual(EMPTY_LIBRARIES);
  });

  test("rows get their badge and what they allow", () => {
    const { installed, repositories } = libraryLists(sample, "");
    expect(installed.map((r) => [r.name, r.badge])).toEqual([
      ["Library/Std/Core", "built-in"],
      ["Library/Acme/Tools", "installed"],
      ["Library/Mine/Draft", "dev mode"],
      ["_plug/stray.plug.js", "Plug"],
    ]);
    expect(installed.map((r) => r.updatable)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(repositories.map((r) => [r.name, r.badge, r.updatable])).toEqual([
      ["Repositories/Std", "built-in", false],
      ["Repositories/Acme", undefined, true],
    ]);
  });

  test("Update all counts exactly the rows that offer Update", () => {
    const lists = libraryLists(
      {
        ...sample,
        installed: [
          ...sample.installed,
          // Built in, whatever its frontmatter says
          { name: "Library/Std/Pulled", uri: "github:x/y.md", mode: "pull" },
        ],
      },
      "",
    );
    const rows = lists.installed.filter((r) => r.kind === "library");
    expect(lists.updatable).toBe(rows.filter((r) => r.updatable).length);
    expect(lists.updatable).toBe(1);
  });

  test("available libraries group by repository, Std first", () => {
    const { groups } = libraryLists(sample, "");
    expect(groups.map((g) => [g.repo, g.label, g.libraries.length])).toEqual([
      ["Repositories/Std", "Recommended (Std)", 1],
      ["Repositories/Acme", "Acme", 1],
    ]);
  });

  test("the filter narrows installed and available, not repositories", () => {
    const lists = libraryLists(sample, "acme");
    expect(lists.installed.map((r) => r.name)).toEqual(["Library/Acme/Tools"]);
    expect(lists.groups.map((g) => g.repo)).toEqual(["Repositories/Acme"]);
    expect(lists.repositories).toHaveLength(2);
  });
});

describe("row actions", () => {
  const deps = () => ({
    update: vi.fn(async () => {}),
    revert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
  });

  test("an installed library can be updated, opened, copied and removed", () => {
    const row = libraryLists(sample, "").installed[1];
    expect(rowActions(row, true, deps()).map((a) => a.label)).toEqual([
      "Update",
      "Open page",
      "Copy URI",
      "Remove",
    ]);
  });

  test("a library changed locally offers Revert in place of Update", () => {
    const row = libraryLists(sample, "", {
      "Library/Acme/Tools": { state: "localChanged" },
    }).installed[1];
    expect(rowActions(row, true, deps()).map((a) => a.label)).toEqual([
      "Revert",
      "Open page",
      "Copy URI",
      "Remove",
    ]);
  });

  test("other states keep Update, and repositories never get Revert", () => {
    const lists = libraryLists(sample, "", {
      "Library/Acme/Tools": { state: "bothChanged" },
      "Repositories/Acme": { state: "localChanged" },
    });
    expect(
      rowActions(lists.installed[1], true, deps()).map((a) => a.label),
    ).toContain("Update");
    const repo = lists.repositories[1];
    expect(rowActions(repo, true, deps()).map((a) => a.label)).toContain(
      "Update",
    );
    expect(rowActions(repo, true, deps()).map((a) => a.label)).not.toContain(
      "Revert",
    );
  });

  test("a built-in library only opens; a stray plug only goes", () => {
    const [builtin, , , plug] = libraryLists(sample, "").installed;
    expect(rowActions(builtin, true, deps()).map((a) => a.label)).toEqual([
      "Open page",
    ]);
    expect(rowActions(plug, true, deps()).map((a) => a.label)).toEqual([
      "Remove",
    ]);
  });
});

describe("read-only spaces", () => {
  const deps = () => ({
    update: vi.fn(async () => {}),
    revert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
  });

  test("rows only open and copy", () => {
    const rows = libraryLists(sample, "").installed;
    for (const row of rows) {
      const labels = rowActions(row, false, deps()).map((a) => a.label);
      expect(labels).not.toContain("Update");
      expect(labels).not.toContain("Remove");
    }
    expect(rowActions(rows[1], false, deps()).map((a) => a.label)).toEqual([
      "Open page",
      "Copy URI",
    ]);
  });

  test("the toolbar has no buttons: the server reaches no remotes either", () => {
    expect(toolbar({ writable: false, updatable: 3 })).toEqual({
      install: false,
      addRepository: false,
      check: false,
      updateAll: false,
    });
    expect(toolbar({ writable: true, updatable: 0 })).toEqual({
      install: true,
      addRepository: true,
      check: true,
      updateAll: false,
    });
    expect(toolbar({ writable: true, updatable: 2 }).updateAll).toBe(true);
  });
});

describe("loading", () => {
  test("until the first load, unless it failed", () => {
    const initial = initialLibrariesState();
    expect(isLoading(initial)).toBe(true);
    expect(isLoading({ ...initial, loaded: true })).toBe(false);
    const failed = librariesReducer(initial, {
      type: "loadFailed",
      message: "offline",
    });
    expect(isLoading(failed)).toBe(false);
    expect(failed.errors.installed).toBe("offline");
  });

  test("dismissing a failed load's error doesn't bring Loading back", () => {
    let state = librariesReducer(initialLibrariesState(), {
      type: "loadFailed",
      message: "offline",
    });
    state = librariesReducer(state, { type: "error", section: "installed" });
    expect(isLoading(state)).toBe(false);
  });
});

describe("update all", () => {
  test("a second call while one runs does nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const update = vi.fn(async () => {
      await gate;
      return { ok: true as const, data: { changed: true } };
    });
    const deps = {
      ensureLoaded: async () => sample,
      update,
      dispatch: vi.fn(),
      setError: vi.fn(),
      setInfo: vi.fn(),
    };
    const guard = { running: false };
    const first = updateAllLibraries(deps, guard);
    await updateAllLibraries(deps, guard);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      name: "Library/Acme/Tools",
      uri: "github:acme/tools/Tools.md",
    });
    release();
    await first;
    expect(guard.running).toBe(false);
    expect(deps.dispatch).toHaveBeenCalledWith({
      type: "unchecked",
      names: ["Library/Acme/Tools"],
    });
  });
});

describe("confirming", () => {
  test("a failing confirm dialog shows in the row's section, and nothing happens", async () => {
    const repo = libraryLists(sample, "").repositories[1];
    const act = vi.fn(async () => {});
    const setError = vi.fn();
    await confirmThen(repo, removeMessage(repo), act, {
      confirm: async () => {
        throw new Error("No UI");
      },
      setError,
    });
    expect(setError).toHaveBeenCalledWith("repositories", "No UI");
    expect(act).not.toHaveBeenCalled();
  });

  test("acts only once confirmed", async () => {
    const lib = libraryLists(sample, "").installed[1];
    const act = vi.fn(async () => {});
    const confirm = vi.fn(async () => false);
    await confirmThen(lib, "Sure?", act, { confirm, setError: vi.fn() });
    expect(confirm).toHaveBeenCalledWith("Sure?");
    expect(act).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await confirmThen(lib, "Sure?", act, { confirm, setError: vi.fn() });
    expect(act).toHaveBeenCalledOnce();
  });

  test("the questions", () => {
    const { installed, repositories } = libraryLists(sample, "");
    expect(removeMessage(installed[1])).toBe(
      'Remove library "Library/Acme/Tools"?',
    );
    expect(removeMessage(installed[3])).toBe(
      'Remove plug "_plug/stray.plug.js"?',
    );
    expect(removeMessage(repositories[1])).toBe(
      'Remove repository "Repositories/Acme"?',
    );
    expect(revertMessage(installed[1])).toBe(
      'Discard your changes to "Library/Acme/Tools" and restore the installed version?',
    );
  });

  test("a row's actions share one busy key", () => {
    const { installed, repositories } = libraryLists(sample, "");
    expect(rowKey(installed[1])).toBe("library:Library/Acme/Tools");
    expect(rowKey(repositories[1])).toBe("repository:Repositories/Acme");
  });
});

describe("showing the tab", () => {
  const show = (reload: () => Promise<unknown>, run = vi.fn(async () => {})) =>
    whileShowing({
      reload,
      take: takeLibrariesFocus,
      run,
      subscribe: onLibrariesFocus,
    });

  test("reloads every time it shows", () => {
    const reload = vi.fn(async () => {});
    show(reload)();
    show(reload)();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test("runs a pending request once, and new ones only while showing", () => {
    const run = vi.fn(async () => {});
    requestLibrariesFocus("install");
    const hide = show(async () => {}, run);
    expect(run).toHaveBeenCalledWith("install");
    requestLibrariesFocus("updateAll");
    expect(run).toHaveBeenLastCalledWith("updateAll");
    hide();
    requestLibrariesFocus("addRepository");
    expect(run).toHaveBeenCalledTimes(2);
    takeLibrariesFocus();
  });
});

test("plural counts", () => {
  expect(plural(1, "library", "libraries")).toBe("1 library");
  expect(plural(2, "library", "libraries")).toBe("2 libraries");
});
