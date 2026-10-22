import { createHash } from "node:crypto";
import { beforeEach, describe, expect, test } from "vitest";
import { ShareWorld, SPACE } from "./share_world_test_util.ts";

const ROOT = "test://other/blog";
const A = `${ROOT}/Blog/A.md`;
const B = `${ROOT}/Blog/B.md`;
// The members' frontmatter, published as is
const FM = "---\ntags: pub\n---\n";
const OUT_A = `${FM}See Blog/B and Private.\n`;
const OUT_B = `${FM}Back to A.\n`;

describe("Share Collections.md", () => {
  let w: ShareWorld;

  // Errors as strings: Lua error objects don't survive vitest's reporting
  const call = (fn: string, ...args: unknown[]) =>
    w.h.call(fn, ...args).catch((e) => `THREW ${e.message}`) as Promise<any>;
  // Empty Lua tables come back as {}, not []
  const lists = (r: any, keys: string[]) =>
    typeof r === "string"
      ? r
      : {
          ...r,
          ...Object.fromEntries(keys.map((k) => [k, Object.values(r[k])])),
        };
  const publish = async () =>
    lists(await call("share.publishCollection", "blog"), [
      "written",
      "unchanged",
      "removed",
      "failed",
    ]);
  const check = async () =>
    lists(await call("share.checkCollection", "blog"), ["removed"]);

  const configure = (extra = "") =>
    w.luaConfig(
      "share.collections",
      `{
        blog = {
          pages = function() return index.contentPages("pub") end,
          uri = "${ROOT}",
          ${extra}
        },
      }`,
    );

  beforeEach(async () => {
    w = await ShareWorld.create();
    w.pages.set(
      "Blog/A",
      "---\ntags: pub\n---\nSee [[Blog/B]] and [[Private]].\n",
    );
    w.pages.set("Blog/B", "---\ntags: pub\n---\nBack to [[Blog/A|A]].\n");
    w.pages.set("Private", "Secret\n");
    await configure();
  });

  test("members are written under the root with links between them", async () => {
    expect(await publish()).toEqual({
      written: ["Blog/A", "Blog/B"],
      unchanged: [],
      removed: [],
      failed: [],
    });
    expect(w.other.get(A)).toBe(OUT_A);
    expect(w.other.get(B)).toBe(OUT_B);
    // Nothing kept on the device, no frontmatter added to members
    expect(w.store.size).toBe(1); // just the credential
    expect(w.pages.get("Blog/A")).toBe(
      "---\ntags: pub\n---\nSee [[Blog/B]] and [[Private]].\n",
    );
  });

  test("links to members go through the target with both URIs", async () => {
    const links: unknown[] = [];
    w.h.services.push({
      selector: "share:target:test://other/blog*",
      match: {},
      run: async () => ({
        kind: "test",
        defaults: { links: true },
        link: (l: Record<string, unknown>) => {
          links.push(l);
          return `<${l.toUri}>`;
        },
      }),
      id: "test-target",
    });
    await publish();
    expect(w.other.get(A)).toBe(
      `---\ntags: pub\n---\nSee <${B}> and Private.\n`,
    );
    expect(links[0]).toMatchObject({ page: "Blog/B", fromUri: A, toUri: B });
  });

  test("path maps members", async () => {
    await configure(`path = function(p) return p.name:gsub("^Blog/", "") end,`);
    expect(await call("share.collection", "blog")).toEqual({
      name: "blog",
      root: ROOT,
      mode: "push",
      members: [
        { page: "Blog/A", path: "A", uri: `${ROOT}/A.md` },
        { page: "Blog/B", path: "B", uri: `${ROOT}/B.md` },
      ],
    });
    await publish();
    expect([...w.other.keys()].sort()).toEqual([
      `${ROOT}/A.md`,
      `${ROOT}/B.md`,
    ]);
  });

  test("pages may be given by name", async () => {
    await w.luaConfig(
      "share.collections",
      `{blog = {pages = function() return {"Blog/A"} end, uri = "${ROOT}"}}`,
    );
    expect(await publish()).toMatchObject({ written: ["Blog/A"] });
    expect(w.other.get(A)).toBe(OUT_A);
  });

  test("a member the remote already has is not written again", async () => {
    // Listed without a hash: each member is read to compare
    await publish();
    expect(await publish()).toEqual({
      written: [],
      unchanged: ["Blog/A", "Blog/B"],
      removed: [],
      failed: [],
    });
  });

  test("a member edited on the remote is written again", async () => {
    await publish();
    w.other.set(A, "overwritten remotely");
    expect(await publish()).toMatchObject({
      written: ["Blog/A"],
      unchanged: ["Blog/B"],
    });
    expect(w.other.get(A)).toBe(OUT_A);
  });

  test("a member whose remote can't be read is written all the same", async () => {
    await publish();
    w.h.services.push({
      selector: `net.readURI:${A}`,
      match: { priority: 1 },
      run: async () => {
        throw new Error("no read");
      },
      id: "failing-read",
    });
    expect(await publish()).toMatchObject({
      written: ["Blog/A"],
      unchanged: ["Blog/B"],
    });
  });

  test("a changed member is written, and one the listing lacks", async () => {
    await publish();
    w.pages.set("Blog/A", "---\ntags: pub\n---\nNew\n");
    w.other.delete(B);
    expect(await publish()).toMatchObject({
      written: ["Blog/A", "Blog/B"],
      unchanged: [],
    });
    expect(w.other.get(A)).toBe(`${FM}New\n`);
    expect(w.other.get(B)).toBe(OUT_B);
  });

  test("a listed hash decides whether to write, without reading", async () => {
    const hashes = new Map<string, string>();
    w.h.services.unshift({
      selector: "net.listURI:test://other/*",
      match: { priority: 1 },
      run: async () =>
        [...w.other.keys()].map((uri) => ({ uri, hash: hashes.get(uri) })),
      id: "hashed-list",
    });
    let reads = 0;
    w.h.services.unshift({
      selector: "net.readURI:test://other/*",
      match: { priority: 1 },
      run: async () => {
        reads++;
        return null;
      },
      id: "counting-read",
    });
    w.other.set(A, OUT_A);
    w.other.set(B, "stale");
    hashes.set(A, await call("share.gitBlobSha", OUT_A));
    hashes.set(B, await call("share.gitBlobSha", "stale"));
    expect(await publish()).toMatchObject({
      written: ["Blog/B"],
      unchanged: ["Blog/A"],
    });
    expect(w.other.get(B)).toBe(OUT_B);
    expect(reads).toBe(0);
  });

  test("files that were never members are offered unchecked", async () => {
    const old = `${ROOT}/Old.md`;
    w.other.set(old, "old");
    w.pickManyAnswer = [];
    expect(await publish()).toMatchObject({ removed: [] });
    expect(w.other.get(old)).toBe("old");
    expect(w.pickManys).toEqual([
      {
        title: `Remove from ${ROOT}?`,
        message: "These files are no longer in the collection.",
        items: [{ id: old, label: "Old.md" }],
        confirmLabel: "Remove",
      },
    ]);

    w.pickManyAnswer = [old];
    expect(await publish()).toMatchObject({ removed: [old] });
    expect(w.other.has(old)).toBe(false);
  });

  test("cancelling the removal list deletes nothing", async () => {
    w.other.set(`${ROOT}/Old.md`, "old");
    expect(await publish()).toMatchObject({ written: ["Blog/A", "Blog/B"] });
    expect(w.other.has(`${ROOT}/Old.md`)).toBe(true);
  });

  test("a target that can't list is written per changed member", async () => {
    w.otherListable = false;
    w.other.set(`${ROOT}/Old.md`, "old");
    expect(await publish()).toMatchObject({ written: ["Blog/A", "Blog/B"] });
    expect(await publish()).toMatchObject({ written: [] });
    expect(w.pickManys).toEqual([]);
  });

  test("a batch service gets all writes and deletes in one call", async () => {
    const batches: any[] = [];
    w.h.services.push({
      selector: "share:writeBatch:test://other/*",
      match: {},
      run: async (data) => {
        batches.push(data);
      },
      id: "test-batch",
    });
    w.other.set(`${ROOT}/Old.md`, "old");
    w.pickManyAnswer = [`${ROOT}/Old.md`];
    expect(await publish()).toEqual({
      written: ["Blog/A", "Blog/B"],
      unchanged: [],
      removed: [`${ROOT}/Old.md`],
      failed: [],
    });
    expect(batches).toEqual([
      {
        root: ROOT,
        writes: [
          { uri: A, content: OUT_A },
          { uri: B, content: OUT_B },
        ],
        deletes: [`${ROOT}/Old.md`],
      },
    ]);
    // The batch did the writing
    expect(w.other.has(A)).toBe(false);
  });

  test("a failed batch writes nothing", async () => {
    w.h.services.push({
      selector: "share:writeBatch:test://other/*",
      match: {},
      run: async () => {
        throw new Error("rejected");
      },
      id: "test-batch",
    });
    const result = await publish();
    expect(result.written).toEqual([]);
    expect(result.failed.map((f: any) => f.page)).toEqual(["Blog/A", "Blog/B"]);
    expect(result.failed[0].error).toContain("rejected");
    expect(w.other.size).toBe(0);
  });

  test("a cancelled batch writes nothing", async () => {
    w.h.services.push({
      selector: "share:writeBatch:test://other/*",
      match: {},
      run: async () => ({ cancelled: true }),
      id: "cancelled-batch",
    });
    w.other.set(`${ROOT}/Old.md`, "old");
    w.pickManyAnswer = [`${ROOT}/Old.md`];
    const result = await publish();
    expect(result).toEqual({
      written: [],
      unchanged: [],
      removed: [],
      failed: [],
      cancelled: true,
    });
    expect(w.other.has(A)).toBe(false);
    expect(w.other.has(`${ROOT}/Old.md`)).toBe(true);

    await call("share.notifyPublished", "blog", true, {
      ...result,
    });
    expect(w.notifications).toEqual([["Publish of blog cancelled", undefined]]);
  });

  test("a failed write leaves the other members written", async () => {
    w.h.services.push({
      selector: `net.writeURI:${A}`,
      match: { priority: 1 },
      run: async () => {
        throw new Error("no write");
      },
      id: "failing-write",
    });
    const result = await publish();
    expect(result.written).toEqual(["Blog/B"]);
    expect(result.failed).toMatchObject([{ page: "Blog/A", uri: A }]);
    expect(result.failed[0].error).toContain("no write");
    expect(w.other.get(B)).toBe(OUT_B);
  });

  test("a root with a trailing slash matches the listing", async () => {
    await w.luaConfig(
      "share.collections",
      `{blog = {pages = function() return index.contentPages("pub") end, uri = "${ROOT}/"}}`,
    );
    await publish();
    expect([...w.other.keys()].sort()).toEqual([A, B]);
    expect(await publish()).toMatchObject({
      written: [],
      unchanged: ["Blog/A", "Blog/B"],
    });
    expect(w.pickManys).toEqual([]);
    expect(await check()).toMatchObject({ removed: [] });
  });

  test("a failing listing writes nothing and reaches the caller", async () => {
    w.h.services.unshift({
      selector: "net.listURI:test://other/*",
      match: { priority: 1 },
      run: async () => {
        throw new Error("listing down");
      },
      id: "failing-list",
    });
    expect(await publish()).toMatch(/^THREW .*listing down/);
    expect(await check()).toMatch(/^THREW .*listing down/);
    expect(w.other.size).toBe(0);
  });

  test("a publish lets the listing sign in, a check doesn't", async () => {
    const options: unknown[] = [];
    w.h.services.unshift({
      selector: "net.listURI:test://other/*",
      match: { priority: 1 },
      run: async (data) => {
        options.push((data as { signIn?: boolean }).signIn ?? null);
        return [];
      },
      id: "recording-list",
    });
    await publish();
    await check();
    expect(options).toEqual([true, null]);
  });

  test("a failing path function is reported for the collection", async () => {
    await configure(`path = function(p) error("bad path") end,`);
    expect(await publish()).toMatch(/^THREW Collection blog: .*bad path/);
    expect(w.other.size).toBe(0);
  });

  test("a pages function returning nothing has no members", async () => {
    await w.luaConfig(
      "share.collections",
      `{blog = {pages = function() return nil end, uri = "${ROOT}"}}`,
    );
    expect(
      Object.values((await call("share.collection", "blog")).members),
    ).toEqual([]);
  });

  test("a page listed twice is one member", async () => {
    await w.luaConfig(
      "share.collections",
      `{blog = {pages = function() return {"Blog/A", "Blog/A"} end, uri = "${ROOT}"}}`,
    );
    expect(await call("share.collection", "blog")).toMatchObject({
      members: [{ page: "Blog/A", path: "Blog/A", uri: A }],
    });
    expect(await publish()).toMatchObject({ written: ["Blog/A"] });
  });

  test("two members on one path is an error", async () => {
    await configure(`path = function(p) return "same" end,`);
    expect(await publish()).toBe(
      "THREW Collection blog: Blog/A and Blog/B both go to same",
    );
    expect(w.other.size).toBe(0);
  });

  test("a failing pages function writes nothing", async () => {
    await w.luaConfig(
      "share.collections",
      `{blog = {pages = function() error("index down") end, uri = "${ROOT}"}}`,
    );
    const result = await publish();
    expect(result).toMatch(/^THREW Collection blog: .*index down/);
    expect(w.other.size).toBe(0);
  });

  test("mode other than push is refused", async () => {
    await configure(`mode = "sync",`);
    expect(await publish()).toBe("THREW Collection blog: mode must be push");
  });

  test("an unknown collection is an error", async () => {
    expect(await call("share.publishCollection", "nope")).toBe(
      "THREW Unknown collection: nope",
    );
  });

  test("collections lists the configured names, sorted", async () => {
    await w.luaConfig(
      "share.collections",
      `{zine = {pages = function() return {} end, uri = "${ROOT}"},
        blog = {pages = function() return {} end, uri = "${ROOT}"}}`,
    );
    expect(await call("share.collections")).toEqual(["blog", "zine"]);
  });

  test("a stale file name with a % is labelled as it is", async () => {
    expect(
      await call(
        "share.collectionLabel",
        "https://gist.github.com/me/abc",
        "https://gist.github.com/me/abc/50% off.md",
      ),
    ).toBe("50% off.md");
  });

  test("changed collections are those with a member differing or missing", async () => {
    // Never published: every member is missing
    expect(await call("share.changedCollections")).toEqual(["blog"]);
    await publish();
    expect(await call("share.changedCollections")).toEqual({});
    // A new member
    w.pages.set("Blog/C", "---\ntags: pub\n---\nC\n");
    expect(await call("share.changedCollections")).toEqual(["blog"]);
    await run("Share: All Changed");
    expect(w.other.get(`${ROOT}/Blog/C.md`)).toBe(`${FM}C\n`);
    expect(await call("share.changedCollections")).toEqual({});
    // A member edited on the remote
    w.other.set(A, "changed remotely\n");
    expect(await call("share.changedCollections")).toEqual(["blog"]);
  });

  test("a collection whose check fails isn't changed", async () => {
    await w.luaConfig(
      "share.collections",
      `{blog = {pages = function() error("index down") end, uri = "${ROOT}"}}`,
    );
    expect(await call("share.changedCollections")).toEqual({});
  });

  test("check reports members and removed files", async () => {
    w.pages.set("Blog/C", "---\ntags: pub\n---\nC\n");
    await publish();
    w.other.set(A, "changed remotely\n");
    w.other.delete(`${ROOT}/Blog/C.md`);
    w.other.set(`${ROOT}/Extra.md`, "extra");
    w.pages.set("Blog/B", "---\ntags: pub\n---\nChanged\n");
    expect(await check()).toEqual({
      members: {
        "Blog/A": { uri: A, state: "differs" },
        "Blog/B": { uri: B, state: "differs" },
        "Blog/C": { uri: `${ROOT}/Blog/C.md`, state: "missing" },
      },
      removed: [`${ROOT}/Extra.md`],
    });
    await publish();
    expect((await check()).members["Blog/A"].state).toBe("upToDate");
  });

  test("check reads each member when the target can't list", async () => {
    await publish();
    w.otherListable = false;
    w.other.delete(B);
    expect(await check()).toEqual({
      members: {
        "Blog/A": { uri: A, state: "upToDate" },
        "Blog/B": { uri: B, state: "missing" },
      },
      removed: [],
    });
  });

  test("check compares listed hashes without reading", async () => {
    w.h.services.unshift({
      selector: "net.listURI:test://other/*",
      match: { priority: 1 },
      run: async () => [
        { uri: A, hash: "0000" },
        {
          uri: B,
          hash: await call("share.gitBlobSha", OUT_B),
        },
      ],
      id: "hashed-list",
    });
    expect(await check()).toEqual({
      members: {
        "Blog/A": { uri: A, state: "differs" },
        "Blog/B": { uri: B, state: "upToDate" },
      },
      removed: [],
    });
  });

  const run = (name: string) =>
    (async () => w.h.commands.get(name)!())().catch(
      (e) => `THREW ${e.message}`,
    );

  test("Share: Collection publishes the picked collection", async () => {
    w.collectionPick = "blog";
    await run("Share: Collection");
    expect(w.other.get(A)).toBe(OUT_A);
    expect(w.other.get(B)).toBe(OUT_B);
    w.other.set(`${ROOT}/Old.md`, "old");
    w.pickManyAnswer = [`${ROOT}/Old.md`];
    await run("Share: Collection");
    expect(w.notifications).toEqual([
      ["Published blog: 2 written, 0 unchanged", undefined],
      ["Published blog: 0 written, 2 unchanged, 1 removed", undefined],
    ]);
  });

  test("Share: Collection reports failures as errors", async () => {
    w.collectionPick = "blog";
    w.h.services.push({
      selector: "share:writeBatch:test://other/*",
      match: {},
      run: async () => {
        throw new Error("rejected");
      },
      id: "failing-batch",
    });
    await run("Share: Collection");
    expect(w.notifications[0]).toEqual([
      "Published blog: 0 written, 0 unchanged",
      undefined,
    ]);
    expect(w.notifications[1][0]).toMatch(/^Blog\/A: .*rejected/);
    expect(w.notifications[1][1]).toBe("error");

    await configure(`mode = "sync",`);
    await run("Share: Collection");
    expect(w.notifications[2]).toEqual([
      "Error: Collection blog: mode must be push",
      "error",
    ]);
  });

  test("Share: Collection reports a failing pages function", async () => {
    w.collectionPick = "blog";
    await w.luaConfig(
      "share.collections",
      `{blog = {pages = function() error("index down") end, uri = "${ROOT}"}}`,
    );
    await run("Share: Collection");
    expect(w.other.size).toBe(0);
    expect(w.notifications).toHaveLength(1);
    expect(w.notifications[0][0]).toMatch(
      /^Error: Collection blog: .*index down/,
    );
    expect(w.notifications[0][1]).toBe("error");
  });

  test("Share: All Changed leaves out a collection whose check fails", async () => {
    await publish();
    w.pages.set("Blog/A", "---\ntags: pub\n---\nNew\n");
    w.h.services.unshift({
      selector: "net.listURI:test://other/*",
      match: { priority: 5 },
      run: async () => {
        throw new Error("listing down");
      },
      id: "failing-list",
    });
    await run("Share: All Changed");
    expect(w.notifications).toEqual([["Nothing to share", undefined]]);
  });

  test("Share: Collection does nothing when cancelled", async () => {
    await run("Share: Collection");
    expect(w.other.size).toBe(0);
    expect(w.notifications).toEqual([]);
  });

  test("Share: Collection without collections says so", async () => {
    w.cfg["share.collections"] = undefined;
    await run("Share: Collection");
    expect(w.notifications).toEqual([["No collections configured", "error"]]);
  });

  test("Share: All Changed reports a collection's failure", async () => {
    await publish();
    w.pages.set("Blog/A", "---\ntags: pub\n---\nNew\n");
    w.other.clear();
    w.otherListable = false;
    w.h.services.push({
      selector: "share:writeBatch:test://other/*",
      match: {},
      run: async () => {
        throw new Error("rejected");
      },
      id: "failing-batch",
    });
    await run("Share: All Changed");
    expect(w.notifications[0]).toEqual(["Shared 0 of 1", undefined]);
    expect(w.notifications[1][0]).toMatch(/^blog: Blog\/A: .*rejected/);
    expect(w.notifications[1][1]).toBe("error");
  });

  test("Share: All Changed counts a cancelled collection as neither shared nor failed", async () => {
    await publish();
    w.pages.set("Blog/A", "---\ntags: pub\n---\nNew\n");
    w.h.services.push({
      selector: "share:writeBatch:test://other/*",
      match: {},
      run: async () => ({ cancelled: true }),
      id: "cancelled-batch",
    });
    await run("Share: All Changed");
    expect(w.notifications).toEqual([["Shared 0 of 1", undefined]]);
  });

  test("Share: All Changed publishes changed collections only", async () => {
    await w.luaConfig(
      "share.collections",
      `{
        blog = {
          pages = function() return index.contentPages("pub") end,
          uri = "${ROOT}",
        },
        notes = {pages = function() return {"Private"} end, uri = "test://other/notes"},
      }`,
    );
    for (const name of ["blog", "notes"]) {
      await call("share.publishCollection", name);
    }
    // A publish of notes would offer this for removal
    w.other.set("test://other/notes/Extra.md", "extra");
    w.pages.set("Blog/A", "---\ntags: pub\n---\nNew\n");
    await w.setup("A\n", "B\n", "A\n", { mode: "push" });
    await run("Share: All Changed");
    expect(w.other.get(A)).toBe(`${FM}New\n`);
    expect(w.remote.get("Page")!.text).toBe("B\n");
    expect(w.pickManys).toEqual([]);
    // The page and the blog collection
    expect(w.notifications).toEqual([["Shared 2 of 2", undefined]]);
  });

  test("a page in a collection and shared on its own is shared both ways", async () => {
    const solo = "test://other/solo/A.md";
    w.pages.set(
      "Blog/A",
      `---\ntags: pub\nshare.uri: "${solo}"\nshare.mode: push\n---\nSee [[Blog/B]] and [[Private]].\n`,
    );
    await publish();
    expect(await call("share.sharePage", "Blog/A")).toBe(true);
    expect(w.other.get(A)).toBe(OUT_A);
    // On its own, Blog/B is not a member
    expect(w.other.get(solo)).toBe(OUT_A);
    // Each compares with its own remote
    w.other.set(solo, "something else");
    expect((await check()).members["Blog/A"].state).toBe("upToDate");
    // The collection doesn't touch the page's own share keys
    expect(w.pages.get("Blog/A")).toContain(`share.uri: "${solo}"`);
  });
});

// A collection on a real provider: what memberUri builds must be what
// net.listURI lists, or every member reads as missing and is offered for
// removal. Members have paths with a space and a "/".
describe("Share Collections.md on providers", () => {
  let w: ShareWorld;

  const call = (fn: string, ...args: unknown[]) =>
    w.h.call(fn, ...args).catch((e) => `THREW ${e.message}`) as Promise<any>;
  const values = (r: any, keys: string[]) =>
    typeof r === "string"
      ? r
      : {
          ...r,
          ...Object.fromEntries(keys.map((k) => [k, Object.values(r[k])])),
        };
  const publish = async () =>
    values(await call("share.publishCollection", "blog"), [
      "written",
      "unchanged",
      "removed",
      "failed",
    ]);
  const check = async () =>
    values(await call("share.checkCollection", "blog"), ["removed"]);
  const listed = async (root: string) =>
    (Object.values(await call("net.listURI", root)) as any[])
      .map((e) => e.uri)
      .sort();

  const setup = async (root: string, github = false) => {
    w = await ShareWorld.create({ github });
    w.pages.set("Blog/A", "---\ntags: pub\n---\nA\n");
    w.pages.set("Blog/My Notes/C D", "---\ntags: pub\n---\nC\n");
    await w.luaConfig(
      "share.collections",
      `{blog = {
        pages = function() return index.contentPages("pub") end,
        uri = "${root}",
        path = function(p) return p.name:gsub("^Blog/", "") end,
      }}`,
    );
  };

  describe("SilverBullet space", () => {
    const ROOT = `${SPACE}/Blog`;
    const MEMBERS = [`${ROOT}/A`, `${ROOT}/My%20Notes/C%20D`];

    beforeEach(() => setup(ROOT));

    test("published members are listed as their own URIs", async () => {
      expect(await publish()).toMatchObject({
        written: ["Blog/A", "Blog/My Notes/C D"],
        failed: [],
      });
      expect(
        w.fetches.filter((f) => f.opts?.method === "PUT").map((f) => f.url),
      ).toEqual([
        `${SPACE}/.fs/Blog/A.md`,
        `${SPACE}/.fs/Blog/My%20Notes/C%20D.md`,
      ]);
      w.setRemote("Other", "outside the root");
      w.setRemote("Blogroll", "a sibling, not under Blog/");
      expect(await listed(ROOT)).toEqual(MEMBERS);
      expect(await publish()).toMatchObject({
        written: [],
        unchanged: ["Blog/A", "Blog/My Notes/C D"],
      });
      expect(w.pickManys).toEqual([]);
      expect(await check()).toEqual({
        members: {
          "Blog/A": { uri: MEMBERS[0], state: "upToDate" },
          "Blog/My Notes/C D": { uri: MEMBERS[1], state: "upToDate" },
        },
        removed: [],
      });
    });

    test("a ticked extra page is deleted", async () => {
      await publish();
      w.setRemote("Blog/Old Page", "old");
      w.pickManyAnswer = [`${ROOT}/Old%20Page`];
      expect(await publish()).toMatchObject({
        removed: [`${ROOT}/Old%20Page`],
        failed: [],
      });
      expect(w.pickManys[0].items).toEqual([
        { id: `${ROOT}/Old%20Page`, label: "Old Page" },
      ]);
      expect(w.remote.has("Blog/Old Page")).toBe(false);
      expect(w.fetches.find((f) => f.opts?.method === "DELETE")?.url).toBe(
        `${SPACE}/.fs/Blog/Old%20Page.md`,
      );
    });

    describe("not connected from this device", () => {
      beforeEach(() => {
        w.store.delete("credentials");
        w.pages.set(
          "Blog/A",
          "---\ntags: pub\n---\nSee [[Blog/My Notes/C D]].\n",
        );
        // Published from another device
        w.setRemote("Blog/A", "A from elsewhere");
      });

      test("the first publish connects, then writes as a connected one", async () => {
        expect(await publish()).toMatchObject({
          written: ["Blog/A", "Blog/My Notes/C D"],
          failed: [],
        });
        expect(w.confirms).toEqual([`Connect to ${SPACE}?`]);
        expect(
          w.fetches.filter((f) => f.opts?.method === "PUT").map((f) => f.url),
        ).toEqual([
          `${SPACE}/.fs/Blog/A.md`,
          `${SPACE}/.fs/Blog/My%20Notes/C%20D.md`,
        ]);
        expect(w.remote.get("Blog/A")!.text).toContain(
          "See [[Blog/My Notes/C D]].",
        );
        expect(w.pickManys).toEqual([]);
        expect(await check()).toMatchObject({ removed: [] });
      });

      test("a check doesn't connect, and offers no removals", async () => {
        expect(await check()).toMatchObject({ removed: [] });
        expect(w.confirms).toEqual([]);
        expect(w.deviceFlows).toEqual([]);
      });
    });
  });

  describe("SilverBullet space root", () => {
    const MEMBERS = [`${SPACE}/A`, `${SPACE}/My%20Notes/C%20D`];

    for (const root of [SPACE, `${SPACE}/`]) {
      test(`members of ${root} are pages of the space`, async () => {
        await setup(root);
        w.pages.set(
          "Blog/A",
          "---\ntags: pub\n---\nSee [[Blog/My Notes/C D]].\n",
        );
        expect(await call("share.collection", "blog")).toMatchObject({
          root: SPACE,
          members: [{ uri: MEMBERS[0] }, { uri: MEMBERS[1] }],
        });
        expect(await publish()).toMatchObject({
          written: ["Blog/A", "Blog/My Notes/C D"],
          failed: [],
        });
        expect(
          w.fetches.filter((f) => f.opts?.method === "PUT").map((f) => f.url),
        ).toEqual([`${SPACE}/.fs/A.md`, `${SPACE}/.fs/My%20Notes/C%20D.md`]);
        expect(w.remote.get("A")!.text).toContain("See [[My Notes/C D]].");
        // A whole space is never listed: its other pages aren't the
        // collection's to remove
        expect(
          Object.values(
            (await call("service.discover", `net.listURI:${SPACE}`, {
              uri: SPACE,
            })) ?? {},
          ),
        ).toEqual([]);
        w.setRemote("Other Page", "not a member");
        expect(await publish()).toMatchObject({
          written: [],
          unchanged: ["Blog/A", "Blog/My Notes/C D"],
        });
        expect(w.pickManys).toEqual([]);
        expect(await check()).toEqual({
          members: {
            "Blog/A": { uri: MEMBERS[0], state: "upToDate" },
            "Blog/My Notes/C D": { uri: MEMBERS[1], state: "upToDate" },
          },
          removed: [],
        });
      });
    }
  });

  describe("GitHub", () => {
    const ROOT = "github:me/repo@main/docs";
    const API = "https://api.github.com/repos/me/repo/";
    const MEMBERS = [`${ROOT}/A.md`, `${ROOT}/My%20Notes/C%20D.md`];
    const blobSha = (text: string) =>
      createHash("sha1")
        .update(`blob ${Buffer.byteLength(text)}\0${text}`)
        .digest("hex");
    // Repo path -> content
    let repo: Map<string, string>;
    let commits: number;

    beforeEach(async () => {
      await setup(ROOT, true);
      w.cfg["github.token"] = "pat";
      w.cfg["github.name"] = "Jo";
      w.cfg["github.email"] = "jo@example.com";
      repo = new Map([
        ["README.md", "outside the root"],
        ["docs/logo.png", "not Markdown"],
      ]);
      commits = 0;
      let pending: Array<{ path: string; sha?: null; content?: string }> = [];
      w.fetchHandler = (url, opts) => {
        if (!url.startsWith(API)) return undefined;
        const path = url.slice(API.length);
        const method = opts?.method ?? "GET";
        if (path === "git/trees/main:docs?recursive=1") {
          return {
            status: 200,
            body: {
              tree: [
                { path: "My Notes", type: "tree", sha: "t" },
                ...[...repo]
                  .filter(([p]) => p.startsWith("docs/"))
                  .map(([p, text]) => ({
                    path: p.slice("docs/".length),
                    type: "blob",
                    sha: blobSha(text),
                  })),
              ],
              truncated: false,
            },
          };
        }
        if (path === "git/ref/heads/main") {
          return { status: 200, body: { object: { sha: `head${commits}` } } };
        }
        if (path === `git/commits/head${commits}`) {
          return { status: 200, body: { tree: { sha: "base" } } };
        }
        if (path === "git/trees" && method === "POST") {
          pending = JSON.parse(opts.body).tree;
          return { status: 201, body: { sha: "tree" } };
        }
        if (path === "git/commits" && method === "POST") {
          return { status: 201, body: { sha: "commit" } };
        }
        if (path === "git/refs/heads/main" && method === "PATCH") {
          for (const e of pending) {
            if (e.sha === null) repo.delete(e.path);
            else repo.set(e.path, e.content!);
          }
          commits++;
          return { status: 200, body: {} };
        }
        return { status: 404 };
      };
    });

    test("published members are listed as their own URIs", async () => {
      expect(await publish()).toMatchObject({
        written: ["Blog/A", "Blog/My Notes/C D"],
        failed: [],
      });
      expect(commits).toBe(1);
      expect([...repo.keys()].sort()).toEqual([
        "README.md",
        "docs/A.md",
        "docs/My Notes/C D.md",
        "docs/logo.png",
      ]);
      expect(await listed(ROOT)).toEqual(MEMBERS);
      expect(await publish()).toMatchObject({
        written: [],
        unchanged: ["Blog/A", "Blog/My Notes/C D"],
      });
      expect(commits).toBe(1);
      expect(w.pickManys).toEqual([]);
      expect(await check()).toEqual({
        members: {
          "Blog/A": { uri: MEMBERS[0], state: "upToDate" },
          "Blog/My Notes/C D": { uri: MEMBERS[1], state: "upToDate" },
        },
        removed: [],
      });
    });

    test("a member whose blob SHA matches the tree is not written", async () => {
      await publish();
      repo.set("docs/A.md", "changed elsewhere");
      expect(await publish()).toMatchObject({
        written: ["Blog/A"],
        unchanged: ["Blog/My Notes/C D"],
      });
      expect(commits).toBe(2);
    });

    test("writes and a ticked removal are one commit", async () => {
      repo.set("docs/Old Page.md", "old");
      w.pickManyAnswer = [`${ROOT}/Old%20Page.md`];
      expect(await publish()).toMatchObject({
        written: ["Blog/A", "Blog/My Notes/C D"],
        removed: [`${ROOT}/Old%20Page.md`],
        failed: [],
      });
      expect(commits).toBe(1);
      expect(repo.has("docs/Old Page.md")).toBe(false);
    });
  });

  describe("Gist", () => {
    const ROOT = "https://gist.github.com/me/abc";
    const API = "https://api.github.com/gists/abc";
    const MEMBERS = [`${ROOT}/A.md`, `${ROOT}/My Notes-C D.md`];
    // File name -> content
    let gist: Map<string, string>;

    beforeEach(async () => {
      await setup(ROOT, true);
      w.cfg["github.token"] = "pat";
      gist = new Map();
      w.fetchHandler = (url, opts) => {
        if (url !== API) return undefined;
        if ((opts?.method ?? "GET") === "GET") {
          return {
            status: 200,
            body: {
              files: Object.fromEntries(
                [...gist].map(([name, content]) => [name, { content }]),
              ),
            },
          };
        }
        const body =
          typeof opts.body === "string" ? JSON.parse(opts.body) : opts.body;
        for (const [name, file] of Object.entries<any>(body.files)) {
          if (file === null) gist.delete(name);
          else gist.set(name, file.content);
        }
        return { status: 200, body: {} };
      };
    });

    test("published members are listed as their own URIs", async () => {
      expect(await publish()).toMatchObject({
        written: ["Blog/A", "Blog/My Notes/C D"],
        failed: [],
      });
      expect([...gist.keys()].sort()).toEqual(["A.md", "My Notes-C D.md"]);
      expect(await listed(ROOT)).toEqual(MEMBERS);
      const patches = () =>
        w.fetches.filter((f) => f.opts?.method === "PATCH").length;
      expect(patches()).toBe(2);
      expect(await publish()).toMatchObject({
        written: [],
        unchanged: ["Blog/A", "Blog/My Notes/C D"],
      });
      expect(patches()).toBe(2);
      expect(w.pickManys).toEqual([]);
      expect(await check()).toEqual({
        members: {
          "Blog/A": { uri: MEMBERS[0], state: "upToDate" },
          "Blog/My Notes/C D": { uri: MEMBERS[1], state: "upToDate" },
        },
        removed: [],
      });
    });

    test("a ticked extra file is removed from the gist", async () => {
      gist.set("Old.md", "old");
      w.pickManyAnswer = [`${ROOT}/Old.md`];
      expect(await publish()).toMatchObject({
        written: ["Blog/A", "Blog/My Notes/C D"],
        removed: [`${ROOT}/Old.md`],
        failed: [],
      });
      expect(w.pickManys[0].items).toEqual([
        { id: `${ROOT}/Old.md`, label: "Old.md" },
      ]);
      expect([...gist.keys()].sort()).toEqual(["A.md", "My Notes-C D.md"]);
    });

    test("two members on one file is an error", async () => {
      w.pages.set("Blog/Post", "---\ntags: pub\n---\nP\n");
      w.pages.set("Blog-Post", "---\ntags: pub\n---\nQ\n");
      await w.luaConfig(
        "share.collections",
        `{blog = {pages = function() return {"Blog/Post", "Blog-Post"} end, uri = "${ROOT}"}}`,
      );
      expect(await publish()).toBe(
        "THREW Collection blog: Blog/Post and Blog-Post both go to Blog-Post",
      );
      expect(gist.size).toBe(0);
    });
  });
});
