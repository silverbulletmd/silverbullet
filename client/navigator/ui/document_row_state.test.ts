import { expect, test, vi } from "vitest";
import type { Row } from "../../../plug-api/ui/tree_types.ts";
import type { ViewMeta } from "../types.ts";
import { createDocumentRowLoader } from "./document_row_state.ts";

const syscall = vi.fn<(name: string, ...args: any[]) => Promise<any>>();

vi.mock("@silverbulletmd/silverbullet/syscall", () => ({
  syscall: (name: string, ...args: any[]) => syscall(name, ...args),
}));

function meta(overrides: Partial<ViewMeta> = {}): ViewMeta {
  return {
    name: "notes",
    title: "Notes",
    mode: "list",
    dock: "page-top",
    hierarchy: { field: "name", separator: "/" },
    foldersFirst: true,
    expandAll: false,
    expansionScope: "page",
    followEditor: false,
    refreshOn: [],
    hasMove: false,
    hasCreate: false,
    refreshOnOpen: false,
    limit: 20,
    search: "client",
    hasRowIcon: false,
    pathCompletion: false,
    hashtagFilter: false,
    ...overrides,
  };
}

test("list rows receive action masks from one rowState batch", async () => {
  const rows: Row[] = [
    { primary: "Alpha", obj: { name: "Alpha" } },
    { primary: "Beta", obj: { name: "Beta" } },
  ];
  const dispatch = vi.fn(async () => [
    { actions: [true, false] },
    { actions: [false, true] },
  ]);
  const load = createDocumentRowLoader(
    dispatch,
    meta({
      actions: [
        { label: "Open", hasWhen: true },
        { label: "Delete", hasWhen: true },
      ],
    }),
  );

  const result = await load(rows);

  expect(dispatch).toHaveBeenCalledExactlyOnceWith("rowState", {
    objs: [{ name: "Alpha" }, { name: "Beta" }],
  });
  expect(result.rowState.byRow?.get(rows[0])?.actions).toEqual([true, false]);
  expect(result.rowState.byRow?.get(rows[1])?.actions).toEqual([false, true]);
  expect(result.actionIcons).toEqual([undefined, undefined]);
});

test("tree batches include synthetic folders and preserve page-folder states by path", async () => {
  const rows: Row[] = [
    { primary: "Leaf", obj: { name: "Shelf/Leaf" } },
    { primary: "Branch", obj: { name: "Shelf/Branch" } },
    { primary: "Child", obj: { name: "Shelf/Branch/Child" } },
  ];
  const dispatch = vi.fn(async () => [
    { actions: [true] },
    { actions: [true] },
    { actions: [false] },
    { actions: [false] },
  ]);
  const load = createDocumentRowLoader(
    dispatch,
    meta({
      mode: "tree",
      actions: [{ label: "Use", hasWhen: true }],
    }),
  );

  const result = await load(rows);

  expect(dispatch).toHaveBeenCalledExactlyOnceWith("rowState", {
    objs: [
      { name: "Shelf", isFolder: true },
      { name: "Shelf/Branch", isFolder: true },
      { name: "Shelf/Branch/Child" },
      { name: "Shelf/Leaf" },
    ],
  });
  expect(result.rowState.byPath?.get("Shelf")?.actions).toEqual([true]);
  expect(result.rowState.byPath?.get("Shelf/Branch")?.actions).toEqual([true]);
  expect(result.rowState.byPath?.get("Shelf/Branch/Child")?.actions).toEqual([
    false,
  ]);
  expect(result.rowState.byRow).toBeUndefined();
  expect(rows[1].obj.isFolder).toBeUndefined();
});

test("a rejected rowState hook leaves conditional actions hidden", async () => {
  const rows: Row[] = [{ primary: "Alpha", obj: { name: "Alpha" } }];
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const load = createDocumentRowLoader(
    async () => {
      throw new Error("unavailable");
    },
    meta({ actions: [{ label: "Remove", hasWhen: true }] }),
  );

  const result = await load(rows);

  expect(result.rowState.byRow?.get(rows[0])?.actions).toEqual([]);
  expect(error).toHaveBeenCalledWith(
    "navigator: row state failed",
    expect.any(Error),
  );
  error.mockRestore();
});

test("views without conditional actions or row icons skip rowState", async () => {
  const dispatch = vi.fn(async () => []);
  const load = createDocumentRowLoader(
    dispatch,
    meta({ actions: [{ label: "Open", hasWhen: false }] }),
  );

  const result = await load([{ primary: "Alpha", obj: { name: "Alpha" } }]);

  expect(dispatch).not.toHaveBeenCalled();
  expect(result.rowState).toEqual({});
  expect(result.actionIcons).toEqual([undefined]);
});

test("action and row Feather names resolve in one cached batch", async () => {
  syscall.mockResolvedValue({
    file: "<svg></svg>",
    trash: "<svg></svg>",
  });
  const rows: Row[] = [{ primary: "Alpha", obj: { name: "Alpha" } }];
  const load = createDocumentRowLoader(
    async () => [{ icon: "feather:file" }],
    meta({
      hasRowIcon: true,
      actions: [
        { label: "Open", icon: "file", hasWhen: false },
        { label: "Delete", icon: "feather:trash", hasWhen: false },
      ],
    }),
  );

  await load(rows);
  await load(rows);

  expect(syscall).toHaveBeenCalledExactlyOnceWith("icon.resolveFeather", [
    "file",
    "trash",
  ]);
});
