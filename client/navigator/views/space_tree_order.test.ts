import { TREE_ORDER_PAGE } from "@silverbulletmd/silverbullet/lib/tree_order";
import { beforeEach, expect, test, vi } from "vitest";

const space = {
  readPage: vi.fn<(name: string) => Promise<string>>(),
  writePage: vi.fn<(name: string, text: string) => Promise<unknown>>(),
  // Writes check what exists against the file list, the same set of names
  // as the listing in these tests.
  listPages: vi.fn(async () => (await spaceContents()) ?? []),
  listDocuments: vi.fn(async () => []),
};
const config = { get: vi.fn() };
const editor = {
  getCurrentPage: vi.fn<() => Promise<string>>(),
  save: vi.fn<() => Promise<void>>(),
  reloadPage: vi.fn<() => Promise<void>>(),
};
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  space,
  config,
  editor,
}));
const spaceContents = vi.fn<() => Promise<Record<string, unknown>[]>>();
vi.mock("./pages.ts", () => ({ spaceContents }));

const collate = (a: string, b: string) => a.localeCompare(b);
const names = (objs: { name: string }[]) => objs.map((o) => o.name);
const objs = (...n: string[]) => n.map((name) => ({ name }));

// The cache is module state; reload the module so every test starts clean.
async function load() {
  vi.resetModules();
  return await import("./space_tree_order.ts");
}

beforeEach(() => {
  space.readPage.mockReset();
  space.readPage.mockResolvedValue("* [[B]]\n* [[A]]\n");
  space.writePage.mockReset();
  config.get.mockResolvedValue({});
  spaceContents.mockReset();
  editor.getCurrentPage.mockReset();
  editor.getCurrentPage.mockResolvedValue("index");
  editor.save.mockReset();
  editor.reloadPage.mockReset();
});

test("no order page sorts alphabetically", async () => {
  const { sortByTreeOrder } = await load();
  const sorted = sortByTreeOrder(
    objs("Zeta", "Alpha", "Projects/B", "Projects/A"),
    new Map(),
    collate,
  );
  expect(names(sorted)).toEqual(["Alpha", "Projects/A", "Projects/B", "Zeta"]);
});

test("saved order applies and new pages go first", async () => {
  const { sortByTreeOrder } = await load();
  const sorted = sortByTreeOrder(
    objs("Inbox", "New", "Projects", "Projects/A"),
    new Map([["", ["Projects", "Inbox"]]]),
    collate,
  );
  expect(names(sorted)).toEqual(["New", "Projects", "Projects/A", "Inbox"]);
});

test("implicit folders sort by their own name", async () => {
  const { sortByTreeOrder } = await load();
  const sorted = sortByTreeOrder(
    objs("A/x", "B/y"),
    new Map([["", ["B", "A"]]]),
    collate,
  );
  expect(names(sorted)).toEqual(["B/y", "A/x"]);
});

test("absent order page gives an empty order without reading", async () => {
  const { loadTreeOrder } = await load();
  const order = await loadTreeOrder([{ name: "Other" }]);
  expect(order.size).toBe(0);
  expect(space.readPage).not.toHaveBeenCalled();
});

test("re-reads only when lastModified changes", async () => {
  const { loadTreeOrder } = await load();
  const page = "Library/Space Tree Structure";
  const first = await loadTreeOrder([{ name: page, lastModified: 1 }]);
  await loadTreeOrder([{ name: page, lastModified: 1 }]);
  expect(space.readPage).toHaveBeenCalledTimes(1);
  expect(first.get("")).toEqual(["B", "A"]);
  await loadTreeOrder([{ name: page, lastModified: 2 }]);
  expect(space.readPage).toHaveBeenCalledTimes(2);
});

test("a failing read yields an empty order", async () => {
  const { loadTreeOrder } = await load();
  space.readPage.mockRejectedValue(new Error("gone"));
  const order = await loadTreeOrder([
    { name: "Library/Space Tree Structure", lastModified: 1 },
  ]);
  expect(order.size).toBe(0);
});

test("primed order wins until the page changes", async () => {
  const { loadTreeOrder, primeTreeOrder, cachedTreeOrder } = await load();
  const page = "Library/Space Tree Structure";
  await loadTreeOrder([{ name: page, lastModified: 1 }]);
  const x = new Map([["", ["Z"]]]);
  primeTreeOrder(x);
  expect(cachedTreeOrder()).toBe(x);
  expect(await loadTreeOrder([{ name: page, lastModified: 1 }])).toBe(x);
  const fresh = await loadTreeOrder([{ name: page, lastModified: 2 }]);
  expect(fresh).not.toBe(x);
  expect(fresh.get("")).toEqual(["B", "A"]);
});

test("a primed order survives a listing that lacks the page", async () => {
  const { loadTreeOrder, primeTreeOrder } = await load();
  const x = new Map([["", ["Z"]]]);
  primeTreeOrder(x);
  expect(await loadTreeOrder([{ name: "Other" }])).toBe(x);
  expect(space.readPage).not.toHaveBeenCalled();
  const fresh = await loadTreeOrder([
    { name: "Library/Space Tree Structure", lastModified: 5 },
  ]);
  expect(space.readPage).toHaveBeenCalledTimes(1);
  expect(fresh.get("")).toEqual(["B", "A"]);
  // Once on-disk state wins, an absent page means an empty order again.
  expect((await loadTreeOrder([{ name: "Other" }])).size).toBe(0);
});

const ORDER_PAGE = "Library/Space Tree Structure";
const EXPLANATION =
  "The order of the space tree. Drag rows in the tree to change it, or edit this list.";
const pages = (...n: string[]) => n.map((name) => ({ name, tag: "page" }));
const orderPage = { name: ORDER_PAGE, tag: "page", lastModified: 1 };
function written(): string {
  expect(space.writePage).toHaveBeenCalledTimes(1);
  const [name, text] = space.writePage.mock.calls[0];
  expect(name).toBe(ORDER_PAGE);
  return text;
}

test("reorderSibling writes the folder's full order", async () => {
  const { reorderSibling, cachedTreeOrder } = await load();
  spaceContents.mockResolvedValue(pages("A", "B", "C"));
  space.readPage.mockRejectedValue(new Error("not found"));
  await reorderSibling({
    folder: "",
    name: "C",
    anchor: "A",
    position: "before",
  });
  const text = written();
  expect(text.startsWith(`${EXPLANATION}\n\n`)).toBe(true);
  expect(text).toContain("* C\n* A\n* B");
  // Shown at once, before the listing catches up with the write.
  expect(cachedTreeOrder().get("")).toEqual(["C", "A", "B"]);
});

test("siblings hidden by a segment keep their place", async () => {
  const { reorderSibling } = await load();
  spaceContents.mockResolvedValue([
    { name: "a.png", tag: "document" },
    ...pages("B", "C"),
    orderPage,
  ]);
  space.readPage.mockResolvedValue("* [[C]]\n* [[a.png]]\n* [[B]]\n");
  await reorderSibling({
    folder: "",
    name: "B",
    anchor: "C",
    position: "before",
  });
  // `Library` (the order page's own folder) is a sibling too, unlisted so far.
  expect(written()).toContain("* B\n* C\n* a.png\n");
});

test("implicit folders are siblings and keep their place", async () => {
  const { reorderSibling } = await load();
  spaceContents.mockResolvedValue(pages("A", "B", "Projects/x"));
  space.readPage.mockRejectedValue(new Error("not found"));
  await reorderSibling({
    folder: "",
    name: "Projects",
    anchor: "A",
    position: "before",
  });
  expect(written()).toContain("* Projects\n* A\n* B\n");
});

test("reorderSibling in a subfolder only takes that folder's children", async () => {
  const { reorderSibling, cachedTreeOrder } = await load();
  spaceContents.mockResolvedValue(
    pages("Projects", "Projects/a", "Projects/b", "Projects/b/deep", "Other"),
  );
  space.readPage.mockRejectedValue(new Error("not found"));
  await reorderSibling({
    folder: "Projects",
    name: "a",
    anchor: "b",
    position: "after",
  });
  expect(cachedTreeOrder().get("Projects")).toEqual(["b", "a"]);
  expect(cachedTreeOrder().has("")).toBe(false);
});

test("saveFolderOrder(null) drops a folder", async () => {
  const { saveFolderOrder } = await load();
  spaceContents.mockResolvedValue([
    ...pages("A", "Projects", "Projects/x", "Projects/y"),
    orderPage,
  ]);
  space.readPage.mockResolvedValue(
    "* [[Projects]]\n  * [[Projects/y]]\n  * [[Projects/x]]\n* [[A]]\n",
  );
  await saveFolderOrder("Projects", null);
  const text = written();
  expect(text).not.toContain("Projects/");
  expect(text).toContain("* Projects\n* A\n");
});

test("an existing preamble is kept", async () => {
  const { saveFolderOrder } = await load();
  spaceContents.mockResolvedValue([...pages("A", "B"), orderPage]);
  space.readPage.mockResolvedValue("My notes\n\n* [[A]]\n");
  await saveFolderOrder("", ["B", "A"]);
  expect(written()).toBe("My notes\n\n* B\n* A\n");
});

test("an existing page without a list keeps its text", async () => {
  const { saveFolderOrder } = await load();
  spaceContents.mockResolvedValue([...pages("A", "B"), orderPage]);
  space.readPage.mockResolvedValue("Just prose");
  await saveFolderOrder("", ["B", "A"]);
  expect(written()).toBe("Just prose\n\n* B\n* A\n");
});

test("a nested-only order survives the written page and leaves its folder unpinned", async () => {
  const { saveFolderOrder, loadTreeOrder, sortByTreeOrder } = await load();
  const all = pages("Alpha", "Order/A", "Order/B", "Zeta");
  spaceContents.mockResolvedValue(all);
  space.readPage.mockRejectedValue(new Error("not found"));
  await saveFolderOrder("Order", ["B", "A"]);
  const text = written();
  // Re-read from the written text, not the primed cache.
  space.readPage.mockReset();
  space.readPage.mockResolvedValue(text);
  const order = await loadTreeOrder([
    ...all,
    { ...orderPage, lastModified: 2 },
  ]);
  expect(space.readPage).toHaveBeenCalledTimes(1);
  expect(order.get("Order")).toEqual(["B", "A"]);
  expect(order.has("")).toBe(false);
  expect(names(sortByTreeOrder(all, order, collate))).toEqual([
    "Alpha",
    "Order/B",
    "Order/A",
    "Zeta",
  ]);
});

test("loadTreeOrder resolves bare and wrong-case links against the space", async () => {
  const { loadTreeOrder } = await load();
  space.readPage.mockResolvedValue(
    "* [[inbox]]\n* [[Projects]]\n  * [[Beta]]\n",
  );
  const order = await loadTreeOrder([
    ...pages("Inbox", "Projects", "Projects/Beta", "Projects/Alpha"),
    orderPage,
  ]);
  expect(order.get("")).toEqual(["Inbox", "Projects"]);
  expect(order.get("Projects")).toEqual(["Beta"]);
});

test("an ambiguous bare link stays literal", async () => {
  const { loadTreeOrder } = await load();
  space.readPage.mockResolvedValue("* [[Notes]]\n");
  const order = await loadTreeOrder([
    ...pages("Projects/Notes", "Archive/Notes"),
    orderPage,
  ]);
  expect(order.get("")).toEqual(["Notes"]);
});

test("a CRLF order page keeps its other folders when one is saved", async () => {
  const { saveFolderOrder } = await load();
  spaceContents.mockResolvedValue([
    ...pages("A", "B", "Projects", "Projects/x", "Projects/y"),
    orderPage,
  ]);
  space.readPage.mockResolvedValue(
    "Notes\r\n\r\n* [[Projects]]\r\n  * [[Projects/y]]\r\n  * [[Projects/x]]\r\n* [[A]]\r\n",
  );
  await saveFolderOrder("", ["A", "Projects", "B"]);
  expect(written()).toBe("Notes\n\n* A\n* Projects\n  * y\n  * x\n* B\n");
});

test("a failed read is not cached: the next load retries", async () => {
  const { loadTreeOrder } = await load();
  space.readPage.mockRejectedValueOnce(new Error("flaky"));
  const listing = [orderPage];
  expect((await loadTreeOrder(listing)).size).toBe(0);
  const order = await loadTreeOrder(listing);
  expect(space.readPage).toHaveBeenCalledTimes(2);
  expect(order.get("")).toEqual(["B", "A"]);
});

test("saveFolderOrder refuses to write over a listed page it cannot read", async () => {
  const { saveFolderOrder, cachedTreeOrder } = await load();
  spaceContents.mockResolvedValue([...pages("A", "B"), orderPage]);
  space.readPage.mockRejectedValue(new Error("flaky"));
  await expect(saveFolderOrder("", ["B", "A"])).rejects.toThrow();
  expect(space.writePage).not.toHaveBeenCalled();
  expect(cachedTreeOrder().size).toBe(0);
});

test("a failed write restores the previous order and rethrows", async () => {
  const { saveFolderOrder, loadTreeOrder, cachedTreeOrder } = await load();
  const listing = [...pages("A", "B"), orderPage];
  spaceContents.mockResolvedValue(listing);
  const before = await loadTreeOrder(listing);
  space.writePage.mockRejectedValue(new Error("disk full"));
  await expect(saveFolderOrder("", ["A", "B"])).rejects.toThrow("disk full");
  expect(cachedTreeOrder()).toBe(before);
  // Not primed: an unlisted page now means an empty order again.
  expect((await loadTreeOrder([])).size).toBe(0);
});

test("an open order page is saved before a reorder and reloaded after it", async () => {
  const m = await load();
  const calls: string[] = [];
  editor.getCurrentPage.mockResolvedValue(TREE_ORDER_PAGE);
  editor.save.mockImplementation(async () => {
    calls.push("save");
  });
  space.readPage.mockImplementation(async () => {
    calls.push("read");
    return "* [[A]]\n* [[B]]\n";
  });
  space.writePage.mockImplementation(async () => {
    calls.push("write");
  });
  editor.reloadPage.mockImplementation(async () => {
    calls.push("reload");
  });
  spaceContents.mockResolvedValue([
    { name: "A" },
    { name: "B" },
    { name: TREE_ORDER_PAGE, lastModified: 1 },
  ]);
  await m.saveFolderOrder("", ["B", "A"]);
  expect(calls[0]).toBe("save");
  expect(calls.at(-2)).toBe("write");
  expect(calls.at(-1)).toBe("reload");
});

test("a closed order page is not reloaded", async () => {
  const m = await load();
  spaceContents.mockResolvedValue([{ name: "A" }, { name: "B" }]);
  space.readPage.mockRejectedValue(new Error("not found"));
  await m.saveFolderOrder("", ["B", "A"]);
  expect(editor.save).not.toHaveBeenCalled();
  expect(editor.reloadPage).not.toHaveBeenCalled();
});

test("a save builds on the page text, not a stale or missing listing", async () => {
  const m = await load();
  // The page is on disk with a root order, but the listing has not caught
  // up with it (index lag): its root order must survive.
  spaceContents.mockResolvedValue([
    { name: "C" },
    { name: "D" },
    { name: "Projects/X" },
    { name: "Projects/Y" },
  ]);
  space.readPage.mockResolvedValue("* [[D]]\n* [[C]]\n");
  await m.saveFolderOrder("Projects", ["Y", "X"]);
  const written = space.writePage.mock.calls[0][1];
  expect(written).toMatch(/\* D\n\* C\n/);
  expect(written).toMatch(/Projects\/Y[\s\S]*Projects\/X/);
});

test("a rename keeps the renamed page's place in the order page", async () => {
  const { followRenames, cachedTreeOrder } = await load();
  spaceContents.mockResolvedValue([...pages("A", "Bee", "C"), orderPage]);
  space.readPage.mockResolvedValue("* [[A]]\n* [[B]] [icon: star]\n* [[C]]\n");
  await followRenames([{ from: "B.md", to: "Bee.md" }]);
  expect(written()).toContain("\n\n* A\n* Bee [icon: star]\n* C\n");
  expect(cachedTreeOrder().get("")).toEqual(["A", "Bee", "C"]);
});

test("a renamed document keeps its extension in the order page", async () => {
  const { followRenames } = await load();
  spaceContents.mockResolvedValue([...pages("A", "b.png"), orderPage]);
  space.readPage.mockResolvedValue("* a.png\n* A\n");
  await followRenames([{ from: "a.png", to: "b.png" }]);
  expect(written()).toContain("\n\n* b.png\n* A\n");
});

test("a rename writes nothing without an order page, or when it is not in it", async () => {
  const { followRenames } = await load();
  spaceContents.mockResolvedValue(pages("A", "Bee"));
  space.readPage.mockRejectedValue(new Error("not found"));
  await followRenames([{ from: "B.md", to: "Bee.md" }]);
  spaceContents.mockResolvedValue([...pages("A", "Bee"), orderPage]);
  space.readPage.mockResolvedValue("* A\n");
  await followRenames([{ from: "B.md", to: "Bee.md" }]);
  expect(space.writePage).not.toHaveBeenCalled();
});

test("an attribute on an unlisted entry lists its folder as shown, so nothing moves", async () => {
  const { setTreeAttribute } = await load();
  spaceContents.mockResolvedValue([...pages("A", "B", "C"), orderPage]);
  space.readPage.mockResolvedValue("Intro\n\n* C\n");
  await setTreeAttribute("B", "icon", "star");
  // Unlisted names come first alphabetically, then the saved order.
  expect(written()).toBe("Intro\n\n* A\n* B [icon: star]\n* Library\n* C\n");
});

test("an attribute on a listed entry keeps its others, and null removes it", async () => {
  const { setTreeAttribute } = await load();
  spaceContents.mockResolvedValue([...pages("A", "P/x"), orderPage]);
  space.readPage.mockResolvedValue("Intro\n\n* P [icon: star]\n  * x\n* A\n");
  await setTreeAttribute("P", "hide", "true");
  expect(written()).toBe(
    "Intro\n\n* P [icon: star] [hide: true]\n  * x\n* A\n",
  );
  space.writePage.mockClear();
  space.readPage.mockResolvedValue("Intro\n\n* P [icon: star]\n  * x\n* A\n");
  await setTreeAttribute("P", "icon", null);
  expect(written()).toBe("Intro\n\n* P\n  * x\n* A\n");
});

test("an attribute on a page the index does not list yet still gets its entry", async () => {
  const { setTreeAttribute } = await load();
  spaceContents.mockResolvedValue([...pages("A"), orderPage]);
  space.listPages.mockResolvedValueOnce([...pages("A", "New"), orderPage]);
  space.readPage.mockResolvedValue("Intro\n\n* A\n");
  await setTreeAttribute("New", "icon", "star");
  expect(written()).toBe("Intro\n\n* Library\n* A\n* New [icon: star]\n");
});
