import { beforeEach, describe, expect, test } from "vitest";
import { ShareWorld } from "./share_world_test_util.ts";

const SHARED_PAGES = "libraries/Library/Std/Infrastructure/Shared Pages.md";

type Row = Record<string, any>;
type Action = {
  label: string;
  requireMode?: string;
  when: (obj: Row) => Promise<boolean>;
  run: (obj: Row) => Promise<unknown>;
};

describe("Shared Pages view", () => {
  let w: ShareWorld;
  let spec: Record<string, any>;

  beforeEach(async () => {
    w = await ShareWorld.create({
      pages: [SHARED_PAGES],
      globals: {
        view: {
          define: (s: Record<string, any>) => {
            spec = s;
          },
        },
      },
    });
    w.pages.set(
      "Repositories/R",
      "---\ntags: meta/repository\nshare:\n  uri: https://h/n/R\n  mode: pull\n---\nR\n",
    );
    w.pages.set(
      "Library/A",
      "---\ntags: meta/library\nshare.uri: https://h/n/Library/A\nshare.mode: pull\n---\nA\n",
    );
  });

  const rows = (): Promise<Row[]> =>
    (async () => spec.source({}))().catch((e) => `THREW ${e.message}`);
  const row = async (page: string) =>
    (await rows()).find((r) => r.page === page)!;
  const action = (label: string): Action =>
    spec.actions.find((a: Action) => a.label === label);
  const run = (label: string, obj: Row) =>
    (async () => action(label).run(obj))().catch((e) => `THREW ${e.message}`);

  test("rows are grouped as Pages, Libraries, Repositories", async () => {
    await w.setup("A\n", "A\n", "A\n", { mode: "push" });
    expect(spec).toMatchObject({
      name: "std.sharedPages",
      title: "Shared Pages",
      command: "Navigate: Shared Pages",
      dock: "rhs",
      supportedDocks: ["rhs", "lhs", "bhs", "modal"],
      refreshOnOpen: true,
      presentation: {
        mode: "tree",
        hierarchy: { field: "name", separator: "\x1f" },
        expandAll: true,
        foldersFirst: false,
      },
    });
    expect((await rows()).map((r) => r.name)).toEqual([
      "Pages\x1fPage",
      "Libraries\x1fLibrary/A",
      "Repositories\x1fRepositories/R",
    ]);
    expect(await row("Library/A")).toMatchObject({
      page: "Library/A",
      uri: "https://h/n/Library/A",
      mode: "pull",
      kind: "library",
    });
  });

  test("status shows the offline state until a check", async () => {
    await w.setup("A\n", "A\n", "B\n", { mode: "sync" });
    const page = await row("Page");
    // Unchanged since its share.hash: no chip
    expect(page.status).toBeUndefined();
    expect(await spec.presentation.row.decorations(page)).toBeUndefined();
    const text = w.pages.get("Page")!;
    w.pages.set("Page", text.replace("A\n", "Z\n"));
    const changed = await row("Page");
    expect(changed.status).toBe("changed here");
    expect(await spec.presentation.row.decorations(changed)).toEqual([
      { text: "changed here", title: "sync · Changed since its last share" },
    ]);
    w.pages.set("Page", text);

    const folder = { name: "Pages", isFolder: true };
    expect(await action("Check").when(folder)).toBe(true);
    expect(await action("Check").when(page)).toBe(false);
    expect(await run("Check", folder)).toBeUndefined();
    const checked = await row("Page");
    expect(checked.status).toBe("remote changed");
    expect(await spec.presentation.row.decorations(checked)).toEqual([
      { text: "remote changed", title: "sync · Only the remote changed" },
    ]);
  });

  test("status chips are short, with the mode and sentence as their title", async () => {
    const statusChip = async () =>
      (await spec.presentation.row.decorations(await row("Page")))?.[0];
    // A sync page without a share.hash
    await w.setup("A\n", "A\n", "B\n", { hash: false });
    expect(await statusChip()).toEqual({
      text: "no record",
      title: "sync · The page has no share.hash to compare with",
    });
    await run("Check", { name: "Pages", isFolder: true });
    expect(await statusChip()).toEqual({
      text: "differs",
      title:
        "sync · Differs from the remote, and there's no share.hash to tell which side changed",
    });
    // Push: no chip until a Check
    await w.setup("A\n", "A\n", "B\n", { mode: "push", hash: false });
    expect(await statusChip()).toBeUndefined();
    await run("Check", { name: "Pages", isFolder: true });
    expect(await statusChip()).toEqual({
      text: "differs",
      title: "push · Differs from the remote; sharing would write it",
    });
    w.remote.delete("Page");
    await run("Check", { name: "Pages", isFolder: true });
    expect(await statusChip()).toEqual({
      text: "missing",
      title: "push · Not on the remote",
    });
    w.store.clear();
    w.requireAuth = true;
    await run("Check", { name: "Pages", isFolder: true });
    const failed = await statusChip();
    expect(failed.text).toBe("check failed");
    expect(failed.title).toMatch(/^push · \S/);
  });

  test("a renamed page shows under its new name", async () => {
    await w.setup("A\n", "A\n", "A\n", { mode: "push" });
    expect((await row("Page")).page).toBe("Page");
    w.pages.set("Renamed", w.pages.get("Page")!);
    w.pages.delete("Page");
    const after = await rows();
    expect(after.map((r) => r.page)).toEqual([
      "Renamed",
      "Library/A",
      "Repositories/R",
    ]);
    expect(after.filter((r) => r.status === "check failed")).toEqual([]);
  });

  test("a Check result is dropped once the page changes", async () => {
    await w.setup("A\n", "A\n", "B\n", { mode: "sync" });
    await run("Check", { name: "Pages", isFolder: true });
    expect((await row("Page")).status).toBe("remote changed");
    w.pages.set("Page", w.pages.get("Page")!.replace("A\n", "C\n"));
    expect((await row("Page")).status).toBe("changed here");
  });

  test("an action on a page forgets its Check result", async () => {
    await w.setup("A\n", "A\n", "B\n", { mode: "sync" });
    await run("Check", { name: "Pages", isFolder: true });
    expect((await row("Page")).status).toBe("remote changed");
    await run("Copy Link", await row("Page"));
    expect((await row("Page")).status).toBeUndefined();
  });

  test("every row has a kind, and group folders are folders", async () => {
    await w.setup("A\n", "A\n", "A\n", { mode: "push" });
    expect((await rows()).map((r) => r.kind)).toEqual([
      "page",
      "library",
      "repository",
    ]);
    const group = { name: "Libraries", isFolder: true };
    expect(await spec.presentation.row.icon(group)).toBe("folder");
    expect(await spec.presentation.row.decorations(group)).toBeUndefined();
    expect(await action("Update").when(group)).toBe(false);
    expect(await spec.presentation.row.icon(await row("Page"))).toBe("share-2");
  });

  describe("collections", () => {
    const ROOT = "test://other/blog";
    const BLOG = "Collections\x1fblog";
    const named = async (name: string) =>
      (await rows()).find((r) => r.name === name)!;

    beforeEach(async () => {
      w.pages.set("Blog/A", "---\ntags: pub\n---\nA\n");
      w.pages.set("Blog/B", "---\ntags: pub\n---\nB\n");
      await w.luaConfig(
        "share.collections",
        `{blog = {
          pages = function() return index.contentPages("pub") end,
          uri = "${ROOT}",
        }}`,
      );
    });

    test("a collection lists its members after Pages", async () => {
      await w.setup("A\n", "A\n", "A\n", { mode: "push" });
      expect((await rows()).map((r) => r.name)).toEqual([
        "Pages\x1fPage",
        BLOG,
        `${BLOG}\x1fBlog/A`,
        `${BLOG}\x1fBlog/B`,
        "Libraries\x1fLibrary/A",
        "Repositories\x1fRepositories/R",
      ]);
      const folder = { ...(await named(BLOG)), isFolder: true };
      expect(await spec.presentation.row.label(folder)).toBe("blog");
      expect(await spec.presentation.row.decorations(folder)).toEqual([
        { text: "2 pages" },
        { text: ROOT },
      ]);
      const member = await named(`${BLOG}\x1fBlog/A`);
      // No chip until a Check
      expect(member).toMatchObject({
        page: "Blog/A",
        uri: `${ROOT}/Blog/A.md`,
      });
      expect(member.status).toBeUndefined();
      expect(await spec.presentation.row.decorations(member)).toBeUndefined();
      expect(await action("Open Remote").when(member)).toBe(true);
      expect(await action("Copy Link").when(member)).toBe(true);
      expect(await action("Share").when(member)).toBe(false);
      expect(await action("Check").when(member)).toBe(false);
      expect(await action("Share Collection").when(folder)).toBe(true);
      expect(await action("Check").when(folder)).toBe(true);
      expect(
        await action("Share Collection").when({
          name: "Pages",
          isFolder: true,
        }),
      ).toBe(false);
    });

    test("Share Collection publishes and Check shows removed files", async () => {
      const folder = { ...(await named(BLOG)), isFolder: true };
      expect(await run("Share Collection", folder)).toBeUndefined();
      expect(w.notifications).toEqual([
        ["Published blog: 2 written, 0 unchanged", undefined],
      ]);
      expect((await named(`${BLOG}\x1fBlog/A`)).status).toBeUndefined();
      w.other.set(`${ROOT}/Old%20Post.md`, "old");
      w.other.set(`${ROOT}/Blog/B.md`, "edited remotely");
      expect(await run("Check", folder)).toBeUndefined();
      expect((await named(`${BLOG}\x1fBlog/A`)).status).toBe("up to date");
      expect(await named(`${BLOG}\x1fBlog/B`)).toMatchObject({
        status: "differs",
        statusTitle: "push · Differs from the remote; sharing would write it",
      });
      const removed = await named(`${BLOG}\x1f\x1e${ROOT}/Old%20Post.md`);
      expect(removed).toMatchObject({
        uri: `${ROOT}/Old%20Post.md`,
        status: "removed",
      });
      expect(await spec.presentation.row.decorations(removed)).toEqual([
        {
          text: "removed",
          title: "push · On the remote, but no longer in the collection",
        },
      ]);
      expect(await spec.presentation.row.label(removed)).toBe("Old Post.md");
      expect(await spec.presentation.row.icon(removed)).toBe("file-minus");
      expect(await spec.presentation.row.icon(folder)).toBe("folder");
      // Checking the whole group checks every collection
      w.other.delete(`${ROOT}/Old%20Post.md`);
      await run("Check", { name: "Collections", isFolder: true });
      expect(
        await named(`${BLOG}\x1f\x1e${ROOT}/Old%20Post.md`),
      ).toBeUndefined();
      // Copying a member's link keeps its Check result
      await run("Copy Link", await named(`${BLOG}\x1fBlog/B`));
      expect((await named(`${BLOG}\x1fBlog/B`)).status).toBe("differs");
      // A changed member drops its Check result
      w.pages.set("Blog/A", "---\ntags: pub\n---\nNew\n");
      expect((await named(`${BLOG}\x1fBlog/A`)).status).toBeUndefined();
      // Sharing the collection drops its Check results
      await run("Share Collection", folder);
      expect((await named(`${BLOG}\x1fBlog/B`)).status).toBeUndefined();
    });

    test("a check whose listing fails shows the error on every member", async () => {
      const folder = { ...(await named(BLOG)), isFolder: true };
      w.h.services.unshift({
        selector: "net.listURI:test://other/*",
        match: { priority: 5 },
        run: async () => {
          throw new Error("Not signed in");
        },
        id: "failing-list",
      });
      for (const target of [folder, { name: "Collections", isFolder: true }]) {
        expect(await run("Check", target)).toBeUndefined();
        for (const page of ["Blog/A", "Blog/B"]) {
          const member = await named(`${BLOG}\x1f${page}`);
          expect(member.status).toBe("check failed");
          expect(member.statusTitle).toMatch(/^push · .*Not signed in/);
        }
      }
    });

    test("member rows transform nothing until a Check", async () => {
      let transforms = 0;
      w.h.services.push({
        id: "counter",
        selector: "share:transform",
        match: { name: "counter" },
        run: async () => {
          transforms++;
        },
      } as never);
      await w.luaConfig(
        "share.collections",
        `{blog = {
          pages = function()
            __pagesCalls = (__pagesCalls or 0) + 1
            return index.contentPages("pub")
          end,
          uri = "${ROOT}",
        }}`,
      );
      await rows();
      expect(transforms).toBe(0);
      expect(w.h.env.get("__pagesCalls")).toBe(1);
      await run("Check", { ...(await named(BLOG)), isFolder: true });
      expect(transforms).toBe(2);
    });

    test("a collection without members can still be checked and shared", async () => {
      await w.luaConfig(
        "share.collections",
        `{blog = {pages = function() return {} end, uri = "${ROOT}"}}`,
      );
      // Without children, the tree doesn't mark the row as a folder
      const folder = await named(BLOG);
      expect(folder.count).toBe(0);
      expect(await action("Check").when(folder)).toBe(true);
      expect(await action("Share Collection").when(folder)).toBe(true);
      w.other.set(`${ROOT}/Old.md`, "old");
      w.pickManyAnswer = [`${ROOT}/Old.md`];
      expect(await run("Share Collection", folder)).toBeUndefined();
      expect(w.other.has(`${ROOT}/Old.md`)).toBe(false);
    });

    test("a collection whose pages fail shows the error", async () => {
      await w.luaConfig(
        "share.collections",
        `{blog = {pages = function() error("index down") end, uri = "${ROOT}"}}`,
      );
      const names = (await rows()).map((r) => r.name);
      expect(names).toContain(BLOG);
      const error = (await rows()).find((r) =>
        r.name.startsWith(`${BLOG}\x1f`),
      )!;
      expect(await spec.presentation.row.label(error)).toMatch(
        /^Collection blog: .*index down/,
      );
      expect(error.kind).toBe("error");
      expect(await spec.presentation.row.icon(error)).toBe("alert-triangle");
      const header = (await rows()).find((r) => r.name === BLOG)!;
      expect(header.kind).toBe("collection");
      expect(await spec.presentation.row.decorations(header)).toBeUndefined();
      expect(await action("Check").when(header)).toBe(true);
      expect(await action("Check").when(error)).toBe(false);
    });
  });

  test("libraries update through the Workbench", async () => {
    const library = await row("Library/A");
    expect(await action("Update").when(library)).toBe(true);
    expect(await action("Share").when(library)).toBe(false);
    expect(await run("Update", library)).toBeUndefined();
    expect(await run("Open in Libraries tab", library)).toBeUndefined();
    expect(w.invokedCommands).toEqual([
      ["Library: Update", [{ name: "Library/A" }]],
      ["Workbench: Libraries", null],
    ]);
  });

  test("page rows share, open and copy their remote", async () => {
    await w.setup("A\n", "B\n", "A\n", { mode: "push" });
    const page = await row("Page");
    expect(await action("Update").when(page)).toBe(false);
    expect(await run("Share", page)).toBeUndefined();
    expect(w.remote.get("Page")!.text).toBe("B\n");
    await run("Open Remote", page);
    await run("Copy Link", page);
    expect(w.openedUrls).toEqual(["https://h/n/Page"]);
    expect(w.clipboard).toEqual(["https://h/n/Page"]);
    await spec.onSelect(page);
    await spec.onSelect({ name: "Pages", isFolder: true });
    expect(w.navigations).toEqual(["Page"]);
  });

  test("actions that write are hidden in read-only spaces", () => {
    const readOnly = ["Open Remote", "Copy Link", "Open in Libraries tab"];
    for (const a of spec.actions as Action[]) {
      expect([a.label, a.requireMode ?? null]).toEqual([
        a.label,
        readOnly.includes(a.label) ? null : "rw",
      ]);
    }
    expect((spec.actions as Action[]).map((a) => a.label).sort()).toEqual(
      [
        "Check",
        "Share",
        "Share Collection",
        "Open Remote",
        "Copy Link",
        "Update",
        "Open in Libraries tab",
      ].sort(),
    );
  });
});
