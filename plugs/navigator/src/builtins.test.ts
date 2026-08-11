import { beforeEach, expect, test, vi } from "vitest";

/**
 * The pre-index branch, which is the only conditional the cold-boot window
 * actually turns on — and the one thing about that window the e2e harness
 * cannot reach (`gotoSilverBulletPage` waits for widgets-ready, which waits
 * for index completion, so a client can never be observed *before* it).
 */

const index = {
  isAvailable: vi.fn<() => Promise<boolean>>(),
  queryLuaObjects: vi.fn<(tag: string, query: unknown) => Promise<unknown[]>>(),
};
const space = {
  listPages: vi.fn<() => Promise<unknown[]>>(),
  listDocuments: vi.fn<() => Promise<unknown[]>>(),
  deletePage: vi.fn<(name: string) => Promise<void>>(),
  deleteDocument: vi.fn<(name: string) => Promise<void>>(),
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
};
const markdown = {
  parseMarkdown: vi.fn<(text: string) => Promise<unknown>>(),
};
const config = { get: vi.fn() };
const system = {
  getMode: vi.fn<() => Promise<string>>(),
  invokeFunction: vi.fn<(name: string, ...args: unknown[]) => Promise<unknown>>(),
};
const open = vi.fn<(name: string, opts?: unknown) => Promise<boolean>>();

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  index,
  space,
  config,
  editor,
  markdown,
  system,
}));
// Imported by builtins.ts only so a handler can reopen a view; unused here,
// and pulling in the real module would drag the whole panel plug along.
vi.mock("./navigator.ts", () => ({ open }));

const { builtin, builtinMeta, spaceContents, pageHeaders, validateKeymaps } =
  await import("./builtins.ts");

beforeEach(() => {
  vi.clearAllMocks();
  system.getMode.mockResolvedValue("rw");
  editor.getUiOption.mockResolvedValue(false);
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

  const result = await builtin({
    event: "navigator:select",
    // The tag round-trip: picked from a picker, so it hands the slot back.
    data: { name: "std.tags", obj: { name: "work" }, from: "std.pages" },
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

  const result = await builtin({
    event: "navigator:select",
    data: { name: "std.tags", obj: { name: "work" }, from: "std.pages" },
  });

  // `false` is the documented "I took the panel over, don't close it".
  expect(result).toBe(false);
  expect(editor.flashNotification).not.toHaveBeenCalled();
});

// --- std.toc / std.tocModal -------------------------------------------------

function builtinRows(name: string) {
  return builtin({ event: "navigator:rows", data: { name } });
}

/** A leaf-text-only `ParseTree` fixture, matching what `markdown.parseMarkdown`
 * hands back: leaf nodes carry `text`, container nodes only `children`. */
function heading(level: number, from: number, ...labelParts: string[]) {
  return {
    type: `ATXHeading${level}`,
    from,
    to: from + 1,
    // First child is the "# " mark, dropped by `pageHeaders` before reading
    // the rest -- a bare placeholder is enough, its text is never read.
    children: [
      { text: `${"#".repeat(level)} ` },
      ...labelParts.map((text) => ({ text })),
    ],
  };
}

test("pageHeaders reads ATX headings, drops the mark, and strips wiki-link brackets", async () => {
  markdown.parseMarkdown.mockResolvedValue({
    children: [
      heading(1, 0, "Intro"),
      {
        type: "Paragraph",
        from: 10,
        to: 20,
        children: [{ text: "body text" }],
      },
      // Each inline child is trimmed *before* concatenation, matching
      // widgets.tocHeaders exactly (Widgets.md) -- including that this drops
      // the whitespace either side of an inline element like this link.
      heading(2, 30, "See ", "[[Some Page]]", " too"),
    ],
  });

  const headers = await pageHeaders("ignored -- parseMarkdown is mocked");

  expect(headers).toEqual([
    { name: "Intro", pos: 0, level: 1 },
    { name: "SeeSome Pagetoo", pos: 30, level: 2 },
  ]);
});

test("pageHeaders drops a heading that renders to an empty label", async () => {
  markdown.parseMarkdown.mockResolvedValue({
    children: [heading(1, 0)],
  });

  expect(await pageHeaders("x")).toEqual([]);
});

test("std.toc nests rows by ancestor level and substitutes a literal '/' in the path", async () => {
  editor.getCurrentPath.mockResolvedValue("Projects/Alpha.md");
  editor.getCurrentPage.mockResolvedValue("Projects/Alpha");
  editor.getText.mockResolvedValue("ignored");
  markdown.parseMarkdown.mockResolvedValue({
    children: [
      heading(1, 0, "Intro"),
      // H3 directly under H1: nests under Intro without inventing an H2.
      heading(3, 10, "Details"),
      heading(1, 20, "A/B"),
    ],
  });

  const rows = await builtinRows("std.toc");

  expect(rows).toEqual([
    {
      obj: expect.objectContaining({
        name: "Intro",
        page: "Projects/Alpha",
        pos: 0,
      }),
      primary: "Intro",
      label: "Intro",
      description: undefined,
      decorations: undefined,
      cssClass: "sb-nav-noband",
    },
    {
      obj: expect.objectContaining({ name: "Intro/Details", pos: 10 }),
      primary: "Details",
      label: "Details",
      description: undefined,
      decorations: undefined,
      cssClass: "sb-nav-noband",
    },
    {
      // The literal "/" in the header text is not a path separator.
      obj: expect.objectContaining({ name: "A∕B", pos: 20 }),
      primary: "A/B",
      label: "A/B",
      description: undefined,
      decorations: undefined,
      cssClass: "sb-nav-noband",
    },
  ]);
});

test("std.toc is empty off a page (not a .md path)", async () => {
  editor.getCurrentPath.mockResolvedValue("assets/logo.png");

  expect(await builtinRows("std.toc")).toEqual([]);
  expect(markdown.parseMarkdown).not.toHaveBeenCalled();
});

test("std.toc's meta carries a Space keymap entry; std.tocModal's doesn't", async () => {
  expect(builtinMeta("std.toc")!.keys).toEqual([" "]);
  expect(builtinMeta("std.tocModal")!.keys).toBeUndefined();
  // Neither view icons its rows -- unlike std.spaceTree, an outline is one
  // kind of thing -- so neither should reserve indentation for one.
  expect(builtinMeta("std.toc")!.hasRowIcon).toBe(false);
  expect(builtinMeta("std.tocModal")!.hasRowIcon).toBe(false);
});

test("navigator:key runs std.toc's Space entry: jump without closing the panel", async () => {
  const result = await builtin({
    event: "navigator:key",
    data: {
      name: "std.toc",
      key: " ",
      obj: { page: "Projects/Alpha", pos: 42 },
    },
  });

  expect(editor.navigate).toHaveBeenCalledWith({
    path: "Projects/Alpha.md",
    details: { type: "position", pos: 42 },
  });
  // A keymap entry has nothing analogous to onSelect's false-keeps-open
  // contract -- the panel's own keydown handler decides that, not the return
  // value -- so this is just "ran without throwing".
  expect(result).toBeUndefined();
});

test("navigator:key is a no-op for a view (or key) with no keymap entry", async () => {
  expect(
    await builtin({
      event: "navigator:key",
      data: { name: "std.tocModal", key: " ", obj: {} },
    }),
  ).toBeUndefined();
  expect(
    await builtin({
      event: "navigator:key",
      data: { name: "std.toc", key: "x", obj: {} },
    }),
  ).toBeUndefined();
  expect(editor.navigate).not.toHaveBeenCalled();
});

test("a throwing keymap handler is flashed, not left as a rejection", async () => {
  editor.navigate.mockRejectedValueOnce(new Error("no such page"));

  const result = await builtin({
    event: "navigator:key",
    data: { name: "std.toc", key: " ", obj: { page: "Gone", pos: 0 } },
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

test("validateKeymaps accepts the real registry (std.toc's Space included)", () => {
  expect(() =>
    validateKeymaps({
      "std.toc": { keymap: { " ": () => {} } },
      "std.tocModal": {},
    }),
  ).not.toThrow();
});

// --- std.spaceTree -----------------------------------------------------

function rowState(name: string, objs: unknown[]) {
  return builtin({ event: "navigator:rowState", data: { name, objs } });
}

function runAction(index: number, obj: unknown, primary?: string) {
  return builtin({
    event: "navigator:action",
    data: { name: "std.spaceTree", index, obj, primary },
  });
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
      confirm: undefined,
      hasWhen: true,
      requireMode: "rw",
    },
    {
      icon: "edit-3",
      label: "Rename",
      confirm: undefined,
      hasWhen: false,
      requireMode: "rw",
    },
    {
      icon: "trash-2",
      label: "Delete",
      confirm: "Delete %s?",
      hasWhen: true,
      requireMode: "rw",
    },
  ]);
  expect(meta.segments!.map((s) => s.label)).toEqual([
    "All",
    "Pages",
    "Meta",
    "Docs",
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

  expect(editor.prompt).toHaveBeenCalledWith(
    "New page name:",
    "Projects/",
  );
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
    { oldPrefix: "Projects/", newPrefix: "Archive/", disableConfirmation: true },
  );
  expect(system.invokeFunction).toHaveBeenCalledWith(
    "index.renamePageCommand",
    { oldPage: "Projects", page: "Archive" },
  );
});

test("navigator:action Delete requires confirmation, %s substituted with a function replacer", async () => {
  editor.confirm.mockResolvedValue(true);

  // A row primary containing replacement-pattern syntax ($&, $1, ...): a
  // naive String.replace(pattern, primary) would read these as capture
  // references instead of literal text. The function-replacer form must not.
  await runAction(3, { tag: "page", name: "Weird", ref: "Weird" }, "$&");

  expect(editor.confirm).toHaveBeenCalledWith("Delete $&?");
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
    await builtin({
      event: "navigator:action",
      data: { name: "std.toc", index: 1, obj: {} },
    }),
  ).toBeUndefined();
});

test("navigator:move (drag-drop) renames a page through the same moveByRename path", async () => {
  await builtin({
    event: "navigator:move",
    data: {
      name: "std.spaceTree",
      obj: { tag: "page", name: "Alpha", ref: "Alpha" },
      newName: "Beta",
    },
  });

  expect(system.invokeFunction).toHaveBeenCalledWith(
    "index.renamePageCommand",
    { oldPage: "Alpha", page: "Beta" },
  );
});

test("navigator:move moving a folder renames the prefix, not a single page", async () => {
  await builtin({
    event: "navigator:move",
    data: {
      name: "std.spaceTree",
      obj: { isFolder: true, name: "Projects" },
      newName: "Archive",
    },
  });

  expect(system.invokeFunction).toHaveBeenCalledWith(
    "index.renamePrefixCommand",
    { oldPrefix: "Projects/", newPrefix: "Archive/", disableConfirmation: true },
  );
  expect(system.invokeFunction).toHaveBeenCalledTimes(1);
});

test("navigator:move is a no-op for a view with no onMove", async () => {
  const result = await builtin({
    event: "navigator:move",
    data: { name: "std.toc", obj: {}, newName: "x" },
  });
  expect(result).toBeUndefined();
  expect(system.invokeFunction).not.toHaveBeenCalled();
});

test("navigator:key Space peeks: navigates without closing the panel", async () => {
  const result = await builtin({
    event: "navigator:key",
    data: {
      name: "std.spaceTree",
      key: " ",
      obj: { name: "Alpha", ref: "Alpha" },
    },
  });
  expect(editor.navigate).toHaveBeenCalledWith("Alpha");
  expect(result).toBeUndefined();
});

test("navigator:create navigates to the phrase, matching Lua's create = true default", async () => {
  await builtin({
    event: "navigator:create",
    data: { name: "std.spaceTree", phrase: "New Page" },
  });
  expect(editor.navigate).toHaveBeenCalledWith("New Page");
});
