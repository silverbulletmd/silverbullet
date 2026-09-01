import { beforeEach, expect, test, vi } from "vitest";

const index = {
  isAvailable: vi.fn<() => Promise<boolean>>(),
  queryLuaObjects: vi.fn<(tag: string, query: unknown) => Promise<unknown[]>>(),
};
const space = {
  listPages: vi.fn<() => Promise<unknown[]>>(),
  listDocuments: vi.fn<() => Promise<unknown[]>>(),
  deletePage: vi.fn<(name: string) => Promise<void>>(),
  deleteDocument: vi.fn<(name: string) => Promise<void>>(),
  listRevisions: vi.fn<(path: string, before?: string) => Promise<any>>(),
  getRevision:
    vi.fn<(path: string, rev: string, parent?: boolean) => Promise<string>>(),
  getRevisionDiff: vi.fn<(path: string, rev: string) => Promise<string>>(),
  getSpaceLog: vi.fn<(before?: string, q?: string) => Promise<any>>(),
};
const editor = {
  flashNotification: vi.fn<(msg: string, kind?: string) => Promise<void>>(),
  navigate: vi.fn<(ref: unknown) => Promise<void>>(),
  getCurrentPath: vi.fn<() => Promise<string>>(),
  getCurrentPage: vi.fn<() => Promise<string>>(),
  getText: vi.fn<() => Promise<string>>(),
  prompt: vi.fn<(msg: string, def?: string) => Promise<string | undefined>>(),
  confirm: vi.fn<(msg: string) => Promise<boolean>>(),
  getUiOption: vi.fn<(name: string) => Promise<unknown>>(),
  setText: vi.fn<(text: string, isolateHistory?: boolean) => Promise<void>>(),
};
const markdown = {
  parseMarkdown: vi.fn<(text: string) => Promise<unknown>>(),
};
const config = { get: vi.fn() };
const system = {
  getMode: vi.fn<() => Promise<string>>(),
  invokeFunction:
    vi.fn<(name: string, ...args: unknown[]) => Promise<unknown>>(),
};
const open = vi.fn<(name: string, opts?: unknown) => Promise<boolean>>();
const events = {
  dispatchEvent: vi.fn<(name: string, data: unknown) => Promise<unknown[]>>(),
};

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  index,
  space,
  config,
  events,
  editor,
  markdown,
  system,
}));
// Imported by builtins.ts only so a handler can reopen a view; unused here,
// and pulling in the real module would drag the whole panel plug along.
vi.mock("./navigator.ts", () => ({ open }));

const { builtinHandle, builtinMeta, setRevisionsAvailable, validateKeymaps } =
  await import("./builtins.ts");
const { EXPAND_ROW } = await import("./views/types.ts");
const { closePreview, currentPreview } = await import(
  "./views/revision_preview.ts"
);
const { spaceContents } = await import("./views/pages.ts");

beforeEach(() => {
  vi.clearAllMocks();
  system.getMode.mockResolvedValue("rw");
  editor.getUiOption.mockResolvedValue(false);
  setRevisionsAvailable(true);
  closePreview();
});

test("the revision views vanish entirely when revisions are unavailable", async () => {
  setRevisionsAvailable(false);

  for (const view of ["std.pageHistory", "std.spaceLog"]) {
    expect(builtinMeta(view)).toBeUndefined();
    expect(await builtinHandle(view, "rows", {})).toBeUndefined();
    expect(
      await builtinHandle(view, "select", { obj: { rev: "a".repeat(40) } }),
    ).toBeUndefined();
  }
  // Nothing else is affected.
  expect(builtinMeta("std.spaceTree")).toBeDefined();
});

test("with an index, the rows are the indexed objects", async () => {
  index.isAvailable.mockResolvedValue(true);
  index.queryLuaObjects.mockImplementation((tag) =>
    Promise.resolve(
      tag === "page"
        ? [{ name: "Projects/Alpha", tag: "page", tags: ["work"] }]
        : [{ name: "assets/logo.png", tag: "document", extension: "png" }],
    ),
  );

  const rows = await spaceContents();

  expect(index.queryLuaObjects).toHaveBeenCalledTimes(2);
  expect(space.listPages).not.toHaveBeenCalled();
  expect(space.listDocuments).not.toHaveBeenCalled();
  // Untouched: whatever the index says a page is, is what the picker shows.
  expect(rows).toEqual([
    { name: "Projects/Alpha", tag: "page", tags: ["work"] },
    { name: "assets/logo.png", tag: "document", extension: "png" },
  ]);
});

test("without one, the rows come from the space's own file listing", async () => {
  index.isAvailable.mockResolvedValue(false);
  space.listPages.mockResolvedValue([
    { name: "Projects/Alpha", lastModified: "2026-08-07" },
    { name: "Library/Std/Config", lastModified: "2026-08-01" },
  ]);
  space.listDocuments.mockResolvedValue([
    { name: "assets/logo.png", extension: "png" },
  ]);

  const rows = await spaceContents();

  // The index is not consulted at all -- it would answer with whatever
  // fraction of the space has been indexed so far, which is the trap.
  expect(index.queryLuaObjects).not.toHaveBeenCalled();
  expect(rows).toEqual([
    // Tagged, so the segments have something to subset by...
    {
      name: "Projects/Alpha",
      lastModified: "2026-08-07",
      tag: "page",
      tags: [],
    },
    // ...including the `Library/` -> meta heuristic the client's own
    // pre-index page-list cache uses, so the Meta segment isn't just empty.
    {
      name: "Library/Std/Config",
      lastModified: "2026-08-01",
      tag: "page",
      tags: ["meta"],
    },
    { name: "assets/logo.png", extension: "png", tag: "document" },
  ]);
});

test("the branch is re-evaluated per source run, so it upgrades on its own", async () => {
  index.isAvailable.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  space.listPages.mockResolvedValue([{ name: "Only", lastModified: "x" }]);
  space.listDocuments.mockResolvedValue([]);
  index.queryLuaObjects.mockResolvedValue([]);

  expect(await spaceContents()).toHaveLength(1);
  // Second run, index now available: no file listing, the index answers.
  expect(await spaceContents()).toEqual([]);
  expect(space.listPages).toHaveBeenCalledTimes(1);
});

test("a throwing handler is flashed, not left as a rejection", async () => {
  // The Lua bridge runs every handler through `runHandler` (pcall +
  // flashNotification). The panel dispatches these fire-and-forget, so a
  // handler that escapes leaves a panel that silently did nothing -- or, for
  // a modal, one that vanished without acting.
  open.mockRejectedValue(new Error("slot is gone"));

  // The tag round-trip: picked from a picker, so it hands the slot back.
  const result = await builtinHandle("std.tags", "select", {
    obj: { name: "work" },
    from: "std.pages",
  });

  expect(open).toHaveBeenCalledWith("std.pages", { phrase: "#work " });
  expect(editor.flashNotification).toHaveBeenCalledWith(
    "navigator onSelect: slot is gone",
    "error",
  );
  // Not `false`: the handler did not take the panel over, so the modal is
  // free to close rather than sitting there showing a list that did nothing.
  expect(result).toBeUndefined();
});

test("a handler that succeeds keeps its return value", async () => {
  open.mockResolvedValue(true);

  const result = await builtinHandle("std.tags", "select", {
    obj: { name: "work" },
    from: "std.pages",
  });

  // `false` is the documented "I took the panel over, don't close it".
  expect(result).toBe(false);
  expect(editor.flashNotification).not.toHaveBeenCalled();
});

function builtinRows(name: string, ctx?: { phrase: string }) {
  return builtinHandle(name, "rows", { ctx });
}

test("navigator:key runs std.spaceTree's Space entry: peek without closing the panel", async () => {
  const result = await builtinHandle("std.spaceTree", "key", {
    key: " ",
    obj: { name: "Alpha", ref: "Alpha" },
  });

  expect(editor.navigate).toHaveBeenCalledWith("Alpha");
  // A keymap entry has nothing analogous to onSelect's false-keeps-open
  // contract -- the panel's own keydown handler decides that, not the return
  // value -- so this is just "ran without throwing".
  expect(result).toBeUndefined();
});

test("navigator:key is a no-op for a view (or key) with no keymap entry", async () => {
  // std.pages defines no keymap at all.
  expect(
    await builtinHandle("std.pages", "key", { key: " ", obj: {} }),
  ).toBeUndefined();
  // std.spaceTree has one, but not for this key.
  expect(
    await builtinHandle("std.spaceTree", "key", { key: "x", obj: {} }),
  ).toBeUndefined();
  expect(editor.navigate).not.toHaveBeenCalled();
});

test("a throwing keymap handler is flashed, not left as a rejection", async () => {
  editor.navigate.mockRejectedValueOnce(new Error("no such page"));

  const result = await builtinHandle("std.spaceTree", "key", {
    key: " ",
    obj: { name: "Gone", ref: "Gone" },
  });

  expect(editor.flashNotification).toHaveBeenCalledWith(
    "navigator keymap: no such page",
    "error",
  );
  expect(result).toBeUndefined();
});

test("validateKeymaps rejects a key reserved by built-in navigation", () => {
  expect(() =>
    validateKeymaps({ "test.view": { keymap: { ArrowDown: () => {} } } }),
  ).toThrow('"ArrowDown" is reserved');
});

test("validateKeymaps accepts the real registry (std.spaceTree's Space included)", () => {
  expect(() =>
    validateKeymaps({
      "std.spaceTree": { keymap: { " ": () => {} } },
      "std.pages": {},
    }),
  ).not.toThrow();
});

function rowState(name: string, objs: unknown[]) {
  return builtinHandle(name, "rowState", { objs });
}

function runAction(
  index: number,
  obj: unknown,
  primary?: string,
  name = "std.spaceTree",
) {
  return builtinHandle(name, "action", { index, obj, primary });
}

test("std.spaceTree sources the same content as the space picker, sorted by name", async () => {
  index.isAvailable.mockResolvedValue(true);
  index.queryLuaObjects.mockImplementation((tag) =>
    Promise.resolve(
      tag === "page"
        ? [
            { name: "Zeta", tag: "page" },
            { name: "Alpha", tag: "page" },
          ]
        : [{ name: "Alpha.png", tag: "document" }],
    ),
  );

  const rows = await builtinRows("std.spaceTree");

  expect((rows as any[]).map((r) => r.obj.name)).toEqual([
    "Alpha",
    "Alpha.png",
    "Zeta",
  ]);
});

test("std.spaceTree's ordering honours the space's queryCollation config, not raw codepoint order", async () => {
  index.isAvailable.mockResolvedValue(true);
  index.queryLuaObjects.mockImplementation((tag) =>
    Promise.resolve(
      tag === "page"
        ? [
            { name: "Zeta", tag: "page" },
            { name: "apple", tag: "page" },
          ]
        : [],
    ),
  );

  // Raw `<` puts "Zeta" (codepoint 90) before "apple" (97). This is exactly
  // the pair the query engine's own collation test uses for German (see
  // client/space_lua/query_collection.test.ts).
  config.get.mockResolvedValueOnce({ enabled: true, locale: "de" });
  const collatedRows = await builtinRows("std.spaceTree");
  expect((collatedRows as any[]).map((r) => r.obj.name)).toEqual([
    "apple",
    "Zeta",
  ]);

  config.get.mockResolvedValueOnce({ enabled: false });
  const codepointRows = await builtinRows("std.spaceTree");
  expect((codepointRows as any[]).map((r) => r.obj.name)).toEqual([
    "Zeta",
    "apple",
  ]);
});

test("std.spaceTree's meta carries hasMove, the three actions, and the Space keymap", () => {
  const meta = builtinMeta("std.spaceTree")!;
  expect(meta.hasMove).toBe(true);
  expect(meta.keys).toEqual([" "]);
  expect(meta.actions).toEqual([
    {
      icon: "plus",
      label: "New page here",
      hasWhen: true,
      requireMode: "rw",
    },
    {
      icon: "edit-3",
      label: "Rename",
      hasWhen: false,
      requireMode: "rw",
    },
    {
      icon: "trash-2",
      label: "Delete",
      hasWhen: true,
      requireMode: "rw",
    },
  ]);
  expect(meta.segments!.map((s) => s.label)).toEqual([
    "All",
    "Pages",
    "Documents",
    "Meta",
  ]);
});

test("std.spaceTree's row state: icon per kind, and the action mask", async () => {
  const [folder, page, doc, image, locked, aspiring, dual] = (await rowState(
    "std.spaceTree",
    [
      { isFolder: true, name: "Projects" },
      { tag: "page", name: "Projects/Alpha", ref: "Projects/Alpha" },
      { tag: "document", name: "notes.txt", ref: "notes.txt" },
      { tag: "document", name: "logo.png", contentType: "image/png" },
      { tag: "page", name: "RO", ref: "RO", perm: "ro" },
      { tag: "page", name: "Ghost", isAspiring: true },
      { isFolder: true, tag: "page", name: "Projects", ref: "Projects" },
    ],
  )) as any[];

  expect(folder.icon).toBe("folder");
  expect(page.icon).toBe("file-text");
  expect(doc.icon).toBe("file");
  expect(image.icon).toBe("image");
  expect(locked.icon).toBe("lock");
  expect(aspiring.icon).toBe("file-plus");
  // A dual heads a folder but opens as a page, and takes the page's icon --
  // what marks it out as a dual is the row's own styling, not the icon.
  expect(dual.icon).toBe("file-text");

  // "New page here" (index 0) only offers on folders; "Delete" (index 2)
  // only where there's something to delete -- a bare folder has neither a
  // page nor a document behind it.
  expect(folder.actions).toEqual([true, true, false]);
  expect(page.actions).toEqual([false, true, true]);
  // A page that also heads a folder (a "dual") keeps its own Delete -- the
  // one case a bare folder-or-page pair doesn't exercise on either side.
  expect(dual.actions).toEqual([true, true, true]);
});

test("navigator:action New page here prompts, then navigates to the trimmed name", async () => {
  editor.prompt.mockResolvedValue("  Projects/Gamma  ");

  const result = await runAction(1, { name: "Projects", isFolder: true });

  expect(editor.prompt).toHaveBeenCalledWith("New page name:", "Projects/");
  expect(editor.navigate).toHaveBeenCalledWith("Projects/Gamma");
  expect(result).toBeUndefined();
});

test("navigator:action New page here does nothing on Escape or an unedited prefill", async () => {
  editor.prompt.mockResolvedValueOnce(undefined);
  await runAction(1, { name: "Projects", isFolder: true });
  editor.prompt.mockResolvedValueOnce("Projects/");
  await runAction(1, { name: "Projects", isFolder: true });

  expect(editor.navigate).not.toHaveBeenCalled();
});

test("navigator:action Rename on a page runs the page rename command, no prompt", async () => {
  await runAction(2, { tag: "page", name: "Projects/Alpha" });

  expect(editor.prompt).not.toHaveBeenCalled();
  expect(system.invokeFunction).toHaveBeenCalledWith(
    "index.renamePageCommand",
    { oldPage: "Projects/Alpha" },
  );
});

test("navigator:action Rename on a document runs the document rename command", async () => {
  await runAction(2, { tag: "document", name: "notes.txt" });

  expect(system.invokeFunction).toHaveBeenCalledWith(
    "index.renameDocumentCommand",
    { oldDocument: "notes.txt" },
  );
});

test("navigator:action Rename on a folder prompts, then renames the prefix and (if headed by a page) the page itself", async () => {
  editor.prompt.mockResolvedValue("Archive");

  await runAction(2, { isFolder: true, name: "Projects", ref: "Projects" });

  expect(system.invokeFunction).toHaveBeenCalledWith(
    "index.renamePrefixCommand",
    {
      oldPrefix: "Projects/",
      newPrefix: "Archive/",
      disableConfirmation: true,
    },
  );
  expect(system.invokeFunction).toHaveBeenCalledWith(
    "index.renamePageCommand",
    { oldPage: "Projects", page: "Archive" },
  );
});

test("navigator:action Delete confirms via editor.confirm inside the handler, then deletes", async () => {
  editor.confirm.mockResolvedValue(true);

  await runAction(3, { tag: "page", name: "Weird", ref: "Weird" });

  expect(editor.confirm).toHaveBeenCalledWith("Delete Weird?");
  expect(space.deletePage).toHaveBeenCalledWith("Weird");
});

test("navigator:action Delete does nothing when declined", async () => {
  editor.confirm.mockResolvedValue(false);

  await runAction(3, { tag: "document", name: "notes.txt" }, "notes.txt");

  expect(space.deleteDocument).not.toHaveBeenCalled();
});

test("navigator:action requireMode rw is blocked in read-only mode, before the action ever runs", async () => {
  system.getMode.mockResolvedValue("ro");

  const result = await runAction(2, { tag: "page", name: "Alpha" });

  expect(system.invokeFunction).not.toHaveBeenCalled();
  expect(editor.flashNotification).toHaveBeenCalledWith(
    "navigator: Rename is unavailable in read-only mode",
    "error",
  );
  expect(result).toBeUndefined();
});

test("navigator:action for an unknown index or view is a no-op", async () => {
  expect(await runAction(99, { name: "x" })).toBeUndefined();
  expect(
    await builtinHandle("std.tags", "action", { index: 1, obj: {} }),
  ).toBeUndefined();
});

test("navigator:move (drag-drop) renames a page through the same moveByRename path", async () => {
  await builtinHandle("std.spaceTree", "move", {
    obj: { tag: "page", name: "Alpha", ref: "Alpha" },
    newName: "Beta",
  });

  expect(system.invokeFunction).toHaveBeenCalledWith(
    "index.renamePageCommand",
    { oldPage: "Alpha", page: "Beta" },
  );
});

test("navigator:move moving a folder renames the prefix, not a single page", async () => {
  await builtinHandle("std.spaceTree", "move", {
    obj: { isFolder: true, name: "Projects" },
    newName: "Archive",
  });

  expect(system.invokeFunction).toHaveBeenCalledWith(
    "index.renamePrefixCommand",
    {
      oldPrefix: "Projects/",
      newPrefix: "Archive/",
      disableConfirmation: true,
    },
  );
  expect(system.invokeFunction).toHaveBeenCalledTimes(1);
});

test("navigator:move is a no-op for a view with no onMove", async () => {
  const result = await builtinHandle("std.tags", "move", {
    obj: {},
    newName: "x",
  });
  expect(result).toBeUndefined();
  expect(system.invokeFunction).not.toHaveBeenCalled();
});

test("navigator:key Space peeks: navigates without closing the panel", async () => {
  const result = await builtinHandle("std.spaceTree", "key", {
    key: " ",
    obj: { name: "Alpha", ref: "Alpha" },
  });
  expect(editor.navigate).toHaveBeenCalledWith("Alpha");
  expect(result).toBeUndefined();
});

test("navigator:create navigates to the phrase", async () => {
  await builtinHandle("std.spaceTree", "create", { phrase: "New Page" });
  expect(editor.navigate).toHaveBeenCalledWith("New Page");
});

test("std.pageHistory lists revisions newest-first with an uncommitted pseudo-entry", async () => {
  editor.getCurrentPath.mockResolvedValue("Projects/Alpha.md");
  space.listRevisions.mockResolvedValue({
    mode: "managed",
    uncommitted: true,
    more: false,
    revisions: [
      {
        rev: "b".repeat(40),
        timestamp: 2000,
        author: "bob",
        message: "edit",
        added: 12,
        removed: 3,
      },
      { rev: "a".repeat(40), timestamp: 1000, author: "alice", message: "add" },
    ],
  });
  const rows = await builtinRows("std.pageHistory");
  expect((rows as any[])[0].obj.name).toBe("@uncommitted");
  expect((rows as any[])[0].primary).toBe("Uncommitted changes");
  expect((rows as any[])[1].obj.rev).toBe("b".repeat(40));
  expect((rows as any[])[1].primary).toBe("bob");
  expect((rows as any[])[1].description).toBeUndefined();
  expect((rows as any[])[1].decorations).toEqual([
    { text: "+12 −3", position: "right" },
    { text: expect.any(String), title: expect.any(String), position: "right" },
  ]);
  expect((rows as any[])[2].decorations).toEqual([
    { text: expect.any(String), title: expect.any(String), position: "right" },
  ]);
  // Rows read relatively ("3 days ago"); the exact stamp is the tooltip.
  const timeDecoration = (rows as any[])[1].decorations[1];
  expect(timeDecoration.text).toMatch(/ago$|^(yesterday|now)$/);
  expect(timeDecoration.title).toMatch(
    /^[A-Za-z]{3} \d{1,2}, \d{4} \d{2}:\d{2}$/,
  );
  expect(space.listRevisions).toHaveBeenCalledWith(
    "Projects/Alpha.md",
    undefined,
  );
});

test("std.pageHistory returns no rows on a non-markdown path", async () => {
  editor.getCurrentPath.mockResolvedValue("image.png");
  expect(await builtinRows("std.pageHistory")).toEqual([]);
});

test("std.pageHistory surfaces an unreachable server as an error, not emptiness", async () => {
  editor.getCurrentPath.mockResolvedValue("note.md");
  space.listRevisions.mockRejectedValue(
    Object.assign(new Error("Revisions request failed: 502"), { status: 502 }),
  );
  const result = await builtinRows("std.pageHistory");
  expect((result as any).error).toMatch(/offline/i);
});

test("std.pageHistory reports a disabled space distinctly from an empty one", async () => {
  editor.getCurrentPath.mockResolvedValue("note.md");
  space.listRevisions.mockResolvedValue({
    mode: "disabled",
    uncommitted: false,
    more: false,
    revisions: [],
  });
  const result = await builtinRows("std.pageHistory");
  expect((result as any).error).toMatch(/off for this space/i);

  space.listRevisions.mockResolvedValue({
    mode: "managed",
    uncommitted: false,
    more: false,
    revisions: [],
  });
  expect(await builtinRows("std.pageHistory")).toEqual([]);
});

test("std.spaceLog surfaces an unreachable server as an error", async () => {
  space.getSpaceLog.mockRejectedValue(
    Object.assign(new Error("Revisions request failed: 502"), { status: 502 }),
  );
  const result = await builtinRows("std.spaceLog");
  expect((result as any).error).toMatch(/offline/i);
});

test("std.spaceLog forwards the typed phrase to the server", async () => {
  space.getSpaceLog.mockResolvedValue({
    mode: "managed",
    more: false,
    uncommitted: [],
    commits: [],
  });
  await builtinRows("std.spaceLog", { phrase: "Claude" });
  expect(space.getSpaceLog).toHaveBeenCalledWith(undefined, "Claude");
});

test("std.spaceLog sends no phrase when the filter is empty", async () => {
  space.getSpaceLog.mockResolvedValue({
    mode: "managed",
    more: false,
    uncommitted: [],
    commits: [],
  });
  await builtinRows("std.spaceLog", { phrase: "" });
  expect(space.getSpaceLog).toHaveBeenCalledWith(undefined, undefined);
});

test("std.pageHistory restore action is rw-gated and calls editor.setText with isolated history", async () => {
  const meta = builtinMeta("std.pageHistory")!;
  expect(meta.actions).toEqual([
    { icon: "rotate-ccw", label: "Restore", hasWhen: true, requireMode: "rw" },
  ]);
  editor.getCurrentPath.mockResolvedValue("note.md");
  space.getRevision.mockResolvedValue("old text");
  await runAction(
    1,
    { name: "a".repeat(40), rev: "a".repeat(40), page: "note.md" },
    undefined,
    "std.pageHistory",
  );
  expect(editor.setText).toHaveBeenCalledWith("old text", true);
});

test("restoring a deletion commit falls back to the parent revision", async () => {
  editor.getCurrentPath.mockResolvedValue("Doomed.md");
  system.getMode.mockResolvedValue("rw");
  editor.getUiOption.mockResolvedValue(false);
  space.getRevision.mockImplementation(
    async (_path: string, _rev: string, parent?: boolean) => {
      if (!parent) {
        throw Object.assign(new Error("Could not load revision: 404"), {
          status: 404,
        });
      }
      return "alpha";
    },
  );

  await builtinHandle("std.pageHistory", "action", {
    index: 1,
    obj: { name: "r", page: "Doomed.md", rev: "a".repeat(40) },
  });

  expect(space.getRevision).toHaveBeenCalledWith(
    "Doomed.md",
    "a".repeat(40),
    true,
  );
  expect(editor.setText).toHaveBeenCalledWith("alpha", true);
});

test("restoring a deletion commit does not retry on a non-404 failure", async () => {
  editor.getCurrentPath.mockResolvedValue("Doomed.md");
  system.getMode.mockResolvedValue("rw");
  editor.getUiOption.mockResolvedValue(false);
  space.getRevision.mockRejectedValue(
    Object.assign(new Error("Could not load revision: 500"), {
      status: 500,
    }),
  );

  await builtinHandle("std.pageHistory", "action", {
    index: 1,
    obj: { name: "r", page: "Doomed.md", rev: "a".repeat(40) },
  });

  // Exactly one call, and never with the parent flag: a bare
  // catch-and-retry would call this twice regardless of status.
  expect(space.getRevision).toHaveBeenCalledTimes(1);
  expect(space.getRevision).not.toHaveBeenCalledWith(
    "Doomed.md",
    "a".repeat(40),
    true,
  );
  expect(editor.flashNotification).toHaveBeenCalledWith(
    expect.stringContaining("500"),
    "error",
  );
  expect(editor.setText).not.toHaveBeenCalled();
});

test("restoring from Space History navigates to the row's page first", async () => {
  editor.getCurrentPath
    .mockResolvedValueOnce("index.md")
    .mockResolvedValue("Other.md");
  system.getMode.mockResolvedValue("rw");
  editor.getUiOption.mockResolvedValue(false);
  space.getRevision.mockResolvedValue("restored body");

  await builtinHandle("std.spaceLog", "action", {
    index: 1,
    obj: { name: "r", rev: "b".repeat(40), file: "Other.md" },
  });

  expect(editor.navigate).toHaveBeenCalledWith({ path: "Other.md" });
  expect(editor.setText).toHaveBeenCalledWith("restored body", true);
});

test("std.spaceLog gives each file an icon reflecting what happened to it", async () => {
  space.getSpaceLog.mockResolvedValue({
    mode: "managed",
    more: false,
    uncommitted: [{ path: "draft.md", status: "added" }],
    commits: [
      {
        rev: "e".repeat(40),
        timestamp: 3000,
        author: "alice",
        message: "a bit of everything",
        added: 4,
        removed: 2,
        files: [
          { path: "fresh.md", status: "added" },
          { path: "keep.md", status: "modified" },
          { path: "gone.md", status: "deleted" },
          { path: "new.md", status: "renamed" },
        ],
      },
    ],
  });
  const state = await rowState(
    "std.spaceLog",
    ((await builtinRows("std.spaceLog")) as any[]).map((r) => r.obj),
  );
  const icons = (state as any[]).map((s) => s.icon);
  // [0] uncommitted pseudo-row, [1] its file, [2] the commit, [3..] its files
  expect(icons).toEqual([
    "edit-3",
    "file-plus",
    "git-commit",
    "file-plus",
    "file-text",
    "file-minus",
    "corner-up-right",
  ]);
});

test("std.spaceLog nests touched files under their commit", async () => {
  space.getSpaceLog.mockResolvedValue({
    mode: "managed",
    more: false,
    commits: [
      {
        rev: "c".repeat(40),
        timestamp: 3000,
        author: "alice",
        message: "add stuff",
        added: 20,
        removed: 5,
        files: [
          { path: "index.md", status: "modified" },
          { path: "Projects/Alpha.md", status: "modified" },
        ],
      },
    ],
  });
  const rows = await builtinRows("std.spaceLog");
  expect((rows as any[])[0].obj.name).toBe("c".repeat(40));
  expect((rows as any[])[0].primary).toBe("add stuff");
  expect((rows as any[])[0].description).toBeUndefined();
  expect((rows as any[])[0].decorations).toEqual([
    { text: "alice", position: "right" },
    { text: "+20 −5", position: "right" },
    { text: expect.any(String), title: expect.any(String), position: "right" },
  ]);
  expect((rows as any[])[1].obj.name).toBe(`${"c".repeat(40)}/index.md`);
  expect((rows as any[])[1].primary).toBe("index.md");
  expect((rows as any[])[1].decorations).toBeUndefined();
  expect((rows as any[])[2].obj.name).toBe(
    `${"c".repeat(40)}/Projects∕Alpha.md`,
  );
});

test("std.spaceLog labels commits by message, with the author as a decoration", async () => {
  space.getSpaceLog.mockResolvedValue({
    mode: "managed",
    more: false,
    uncommitted: [],
    commits: [
      {
        rev: "c".repeat(40),
        timestamp: 3000,
        author: "Claude Code",
        message: "Update 3 pages, create 1",
        files: [],
        added: 20,
        removed: 4,
      },
      {
        rev: "d".repeat(40),
        timestamp: 2000,
        author: "alice",
        message: "",
        files: [],
        added: 1,
        removed: 0,
      },
    ],
  });
  const rows = (await builtinRows("std.spaceLog")) as any[];
  expect(rows[0].primary).toBe("Update 3 pages, create 1");
  expect(rows[0].decorations.map((d: any) => d.text)).toContain("Claude Code");
  expect(rows[1].primary).toBe("alice");
});

test("std.pageHistory select previews a color-coded diff by default", async () => {
  space.getRevisionDiff.mockResolvedValue(
    "@@ -1,2 +1,2 @@\n-old line < b\n+new line\n context\n",
  );
  const obj = {
    name: "a".repeat(40),
    rev: "a".repeat(40),
    page: "note.md",
    author: "alice",
    message: "add stuff",
    timestamp: 2000,
    added: 12,
    removed: 3,
  };

  const selectResult = await builtinHandle("std.pageHistory", "select", {
    obj,
  });

  expect(space.getRevisionDiff).toHaveBeenCalledWith("note.md", "a".repeat(40));
  // The diff is enough on its own: the full content isn't fetched up front.
  expect(space.getRevision).not.toHaveBeenCalled();
  const preview = currentPreview()!;
  // Header: page @ short-rev — author · time · diff; message on its own line.
  expect(preview.header).toContain("note.md @ aaaaaaaa");
  expect(preview.header).toContain("alice");
  expect(preview.header).toContain("+12 −3");
  expect(preview.message).toBe("add stuff");
  expect(preview.path).toBe("note.md");
  expect(preview.rev).toBe("a".repeat(40));
  // Each line classed by its leading character; a context line gets none, so
  // it renders without a class attribute rather than an empty one.
  expect(preview.diff).toEqual([
    { text: "@@ -1,2 +1,2 @@", cssClass: "sb-revision-diff-hunk" },
    { text: "-old line < b", cssClass: "sb-revision-diff-del" },
    { text: "+new line", cssClass: "sb-revision-diff-add" },
    { text: " context", cssClass: undefined },
  ]);
  // A click open takes focus, so Escape works without clicking in first.
  expect(preview.focus).toBe(true);
  expect(selectResult).toBe(false);
});

test("std.pageHistory's preview offers Restore, and not in read-only mode", async () => {
  space.getRevisionDiff.mockResolvedValue("@@ -1 +1 @@\n-old\n+new\n");
  const obj = { name: "a".repeat(40), rev: "a".repeat(40), page: "note.md" };

  await builtinHandle("std.pageHistory", "select", { obj });
  expect(currentPreview()!.canRestore).toBe(true);

  system.getMode.mockResolvedValue("ro");
  await builtinHandle("std.pageHistory", "select", { obj });
  const preview = currentPreview()!;
  expect(preview.canRestore).toBe(false);
  // The rest of the preview is unaffected.
  expect(preview.diff).toHaveLength(3);
});

test("std.pageHistory opens a distinctly identified preview each time, so a stale one can't win after reopening", async () => {
  space.getRevisionDiff.mockResolvedValue("@@ -1 +1 @@\n-old\n+new\n");
  const obj = { name: "a".repeat(40), rev: "a".repeat(40), page: "note.md" };

  await builtinHandle("std.pageHistory", "select", { obj });
  const first = currentPreview()!.token;
  await builtinHandle("std.pageHistory", "select", { obj });
  const second = currentPreview()!.token;

  // The component keys off this, so a reopen remounts rather than inheriting
  // the previous preview's in-flight content fetch.
  expect(first).toBeTruthy();
  expect(second).not.toBe(first);
});

test("std.pageHistory keeps the toggle and shows a placeholder when the diff endpoint 404s (e.g. a merge commit)", async () => {
  space.getRevisionDiff.mockRejectedValue(
    Object.assign(new Error("Could not load revision diff: 404"), {
      status: 404,
    }),
  );
  const obj = { name: "a".repeat(40), rev: "a".repeat(40), page: "note.md" };

  const selectResult = await builtinHandle("std.pageHistory", "select", {
    obj,
  });

  expect(space.getRevision).not.toHaveBeenCalled();
  const preview = currentPreview()!;
  expect(preview.diff).toEqual([{ text: "No diff for this commit." }]);
  // Unlike a transport-error fallback, Content stays reachable: the revision
  // is still there to read, there is just nothing to color in the Diff pane.
  expect(preview.rev).toBe("a".repeat(40));
  expect(selectResult).toBe(false);
});

test("std.pageHistory drops the git file header before the first hunk, so --- /+++ aren't misread as content changes", async () => {
  space.getRevisionDiff.mockResolvedValue(
    [
      "diff --git a/Projects/Alpha.md b/Projects/Alpha.md",
      "index 6f1b650..d63555a 100644",
      "--- a/Projects/Alpha.md",
      "+++ b/Projects/Alpha.md",
      "@@ -1,7 +1,7 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
  );
  const obj = { name: "a".repeat(40), rev: "a".repeat(40), page: "note.md" };

  await builtinHandle("std.pageHistory", "select", { obj });

  const diff = currentPreview()!.diff!;
  expect(diff.map((l) => l.text)).toEqual(["@@ -1,7 +1,7 @@", "-old", "+new"]);
});

test("std.pageHistory renders the raw diff unstyled when it has no hunk at all (pure rename/mode change)", async () => {
  const raw =
    "diff --git a/old.md b/new.md\nsimilarity index 100%\nrename from old.md\nrename to new.md\n";
  space.getRevisionDiff.mockResolvedValue(raw);
  const obj = { name: "a".repeat(40), rev: "a".repeat(40), page: "note.md" };

  await builtinHandle("std.pageHistory", "select", { obj });

  expect(currentPreview()!.diff).toEqual([{ text: raw }]);
});

test("std.pageHistory falls back to the content view, with no toggle, when the diff endpoint errors", async () => {
  space.getRevisionDiff.mockRejectedValue(
    new Error("unrecognized query param 'format'"),
  );
  const obj = { name: "a".repeat(40), rev: "a".repeat(40), page: "note.md" };

  const selectResult = await builtinHandle("std.pageHistory", "select", {
    obj,
  });

  // No diff at all: the preview opens straight on the content pane, with
  // nothing to toggle to on an older server.
  expect(currentPreview()!.diff).toBeUndefined();
  expect(selectResult).toBe(false);
});

test("std.pageHistory's Space-key peek previews without stealing focus from the dock", async () => {
  space.getRevisionDiff.mockResolvedValue("@@ -1 +1 @@\n-old\n+new\n");
  const obj = { name: "a".repeat(40), rev: "a".repeat(40), page: "note.md" };

  const keyResult = await builtinHandle("std.pageHistory", "key", {
    key: " ",
    obj,
  });

  // Unlike `select`, a peek must not move focus into the panel -- doing so
  // would break arrow-key navigation in the dock.
  expect(currentPreview()!.focus).toBe(false);
  expect(keyResult).toBe(false);
});

test("Page History has no phrase filter; Space History searches at the source", () => {
  // One page's revisions are all worth scanning, so filtering them is noise.
  expect(builtinMeta("std.pageHistory")!.noFilter).toBe(true);
  expect(builtinMeta("std.pageHistory")!.filterFields).toBeUndefined();
  // The space-wide log hands the phrase to the server, which searches commit
  // messages and authors -- client-side ranking never runs, so weighting
  // fields here would be dead config and the placeholder must not promise it.
  expect(builtinMeta("std.spaceLog")!.noFilter).toBeUndefined();
  expect(builtinMeta("std.spaceLog")!.search).toBe("source");
  expect(builtinMeta("std.spaceLog")!.filterFields).toBeUndefined();
  expect(builtinMeta("std.spaceLog")!.placeholder).toBe(
    "Search commit message or author",
  );
});

test("std.spaceLog heads the log with an uncommitted pseudo-commit", async () => {
  space.getSpaceLog.mockResolvedValue({
    mode: "managed",
    more: false,
    uncommitted: [
      { path: "index.md", status: "modified" },
      { path: "Projects/Alpha.md", status: "added" },
    ],
    commits: [
      {
        rev: "c".repeat(40),
        timestamp: 1000,
        author: "alice",
        message: "add stuff",
        added: 1,
        removed: 0,
        files: [{ path: "index.md", status: "modified" }],
      },
    ],
  });

  const rows = (await builtinRows("std.spaceLog")) as any[];

  // Ahead of every real commit, reading as what it is and carrying no chips.
  expect(rows[0].primary).toBe("Uncommitted changes");
  expect(rows[0].decorations).toBeUndefined();
  expect(rows[0].obj.rev).toBe("@uncommitted");
  // Expanding to the files it covers, exactly like a real commit row.
  expect(rows[1].primary).toBe("index.md");
  expect(rows[2].primary).toBe("Projects/Alpha.md");
  expect(rows[3].primary).toBe("add stuff");

  // Selecting one previews the working-tree change -- no revision to ask for,
  // and nothing to restore.
  space.getRevisionDiff.mockResolvedValue("@@ -1 +1 @@\n-old\n+new\n");
  const result = await builtinHandle("std.spaceLog", "select", {
    obj: rows[1].obj,
  });

  expect(space.getRevisionDiff).toHaveBeenCalledWith("index.md");
  const preview = currentPreview()!;
  expect(preview.header).toBe("index.md — uncommitted");
  expect(preview.canRestore).toBe(false);
  // No revision means no full-content pane to toggle to either.
  expect(preview.rev).toBeUndefined();
  expect(result).toBe(false);
});

test("std.spaceLog previews a page child row and expands a bare commit row", async () => {
  space.getRevisionDiff.mockResolvedValue("@@ -1 +1 @@\n-old\n+new\n");
  const fileResult = await builtinHandle("std.spaceLog", "select", {
    obj: {
      name: `${"c".repeat(40)}/Projects∕Alpha.md`,
      rev: "c".repeat(40),
      file: "Projects/Alpha.md",
      author: "alice",
      message: "add stuff",
      timestamp: 2000,
    },
  });
  // The same modal Page History opens, for the file the row names.
  expect(space.getRevisionDiff).toHaveBeenCalledWith(
    "Projects/Alpha.md",
    "c".repeat(40),
  );
  expect(currentPreview()!.header).toContain("Projects/Alpha.md @ cccccccc");
  expect(currentPreview()!.header).toContain("alice");
  expect(editor.navigate).not.toHaveBeenCalled();
  expect(fileResult).toBe(false);

  // An attachment has no diff worth showing and nothing text-restorable.
  closePreview();
  const assetResult = await builtinHandle("std.spaceLog", "select", {
    obj: {
      name: `${"c".repeat(40)}/logo.png`,
      rev: "c".repeat(40),
      file: "logo.png",
    },
  });
  expect(assetResult).toBe(false);
  expect(currentPreview()).toBeUndefined();

  editor.navigate.mockClear();
  const commitResult = await builtinHandle("std.spaceLog", "select", {
    obj: { name: "c".repeat(40), rev: "c".repeat(40) },
  });
  expect(editor.navigate).not.toHaveBeenCalled();
  // Not `false`: the panel opens the row up rather than just staying put.
  expect(commitResult).toBe(EXPAND_ROW);
});

test("std.pageHistory offers Load more and appends the next page", async () => {
  editor.getCurrentPath.mockResolvedValue("note.md");
  space.listRevisions.mockResolvedValueOnce({
    mode: "managed",
    uncommitted: false,
    more: true,
    revisions: [
      { rev: "a".repeat(40), timestamp: 3000, author: "alice", message: "m3" },
    ],
  });
  let rows = (await builtinRows("std.pageHistory")) as any[];
  expect(rows.at(-1).obj.name).toBe("@more");
  expect(rows.at(-1).primary).toBe("Load more…");

  space.listRevisions.mockResolvedValueOnce({
    mode: "managed",
    uncommitted: false,
    more: false,
    revisions: [
      { rev: "b".repeat(40), timestamp: 2000, author: "bob", message: "m2" },
    ],
  });
  await builtinHandle("std.pageHistory", "select", {
    obj: { name: "@more", page: "note.md" },
  });
  expect(space.listRevisions).toHaveBeenLastCalledWith(
    "note.md",
    "a".repeat(40),
  );

  rows = (await builtinRows("std.pageHistory")) as any[];
  expect(rows.map((r) => r.obj.rev)).toEqual(["a".repeat(40), "b".repeat(40)]);
  expect(rows.some((r) => r.obj.name === "@more")).toBe(false);
});

test("switching page resets the page-history accumulator", async () => {
  editor.getCurrentPath.mockResolvedValue("note.md");
  space.listRevisions.mockResolvedValue({
    mode: "managed",
    uncommitted: false,
    more: false,
    revisions: [
      { rev: "a".repeat(40), timestamp: 3000, author: "alice", message: "m" },
    ],
  });
  await builtinRows("std.pageHistory");
  editor.getCurrentPath.mockResolvedValue("other.md");
  const rows = (await builtinRows("std.pageHistory")) as any[];
  expect(rows).toHaveLength(1);
  expect(space.listRevisions).toHaveBeenLastCalledWith("other.md", undefined);
});

test("selecting Load more twice before the first fetch lands does not duplicate rows", async () => {
  editor.getCurrentPath.mockResolvedValue("note.md");
  space.listRevisions.mockResolvedValueOnce({
    mode: "managed",
    uncommitted: false,
    more: true,
    revisions: [
      { rev: "a".repeat(40), timestamp: 3000, author: "alice", message: "m3" },
    ],
  });
  await builtinRows("std.pageHistory");

  let resolveSecondPage: (value: unknown) => void;
  const secondPage = new Promise((resolve) => {
    resolveSecondPage = resolve;
  });
  space.listRevisions.mockReturnValueOnce(secondPage);

  const firstSelect = builtinHandle("std.pageHistory", "select", {
    obj: { name: "@more", page: "note.md" },
  });
  const secondSelect = builtinHandle("std.pageHistory", "select", {
    obj: { name: "@more", page: "note.md" },
  });
  resolveSecondPage!({
    mode: "managed",
    uncommitted: false,
    more: false,
    revisions: [
      { rev: "b".repeat(40), timestamp: 2000, author: "bob", message: "m2" },
    ],
  });
  await Promise.all([firstSelect, secondSelect]);

  // One fetch for the fresh load, one for the (single) extension -- the
  // second, overlapping select must not have kicked off its own fetch.
  expect(space.listRevisions).toHaveBeenCalledTimes(2);
  // The no-op select must not dispatch a refresh either -- a spurious
  // dispatch would re-run `rows()` while the real extension is still in
  // flight, flashing the panel back to a fresh page 1.
  expect(events.dispatchEvent).toHaveBeenCalledTimes(1);
  const rows = (await builtinRows("std.pageHistory")) as any[];
  expect(rows.map((r) => r.obj.rev)).toEqual(["a".repeat(40), "b".repeat(40)]);
});

test("std.spaceLog offers Load more and appends the next page, keyed on the cursor commit", async () => {
  space.getSpaceLog.mockResolvedValueOnce({
    mode: "managed",
    more: true,
    uncommitted: [],
    commits: [
      {
        rev: "c".repeat(40),
        timestamp: 3000,
        author: "alice",
        message: "m3",
        files: [{ path: "note.md", status: "modified" }],
      },
    ],
  });
  let rows = (await builtinRows("std.spaceLog")) as any[];
  expect(rows.at(-1).obj.name).toBe("@more");
  expect(rows.at(-1).primary).toBe("Load more…");

  space.getSpaceLog.mockResolvedValueOnce({
    mode: "managed",
    more: false,
    uncommitted: [],
    commits: [
      {
        rev: "d".repeat(40),
        timestamp: 2000,
        author: "bob",
        message: "m2",
        files: [],
      },
    ],
  });
  await builtinHandle("std.spaceLog", "select", {
    obj: { name: "@more" },
  });
  expect(space.getSpaceLog).toHaveBeenLastCalledWith("c".repeat(40), undefined);

  rows = (await builtinRows("std.spaceLog")) as any[];
  expect(rows.map((r) => r.obj.rev)).toEqual([
    "c".repeat(40),
    "c".repeat(40),
    "d".repeat(40),
  ]);
  expect(rows.some((r) => r.obj.name === "@more")).toBe(false);
});

test("typing a new search resets the space-log accumulator", async () => {
  space.getSpaceLog.mockResolvedValue({
    mode: "managed",
    more: false,
    uncommitted: [],
    commits: [
      {
        rev: "c".repeat(40),
        timestamp: 3000,
        author: "alice",
        message: "m",
        files: [],
      },
    ],
  });
  await builtinRows("std.spaceLog", { phrase: "foo" });
  const rows = (await builtinRows("std.spaceLog", { phrase: "bar" })) as any[];
  expect(rows).toHaveLength(1);
  expect(space.getSpaceLog).toHaveBeenLastCalledWith(undefined, "bar");
});
