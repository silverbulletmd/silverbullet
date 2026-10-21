import { beforeEach, describe, expect, test } from "vitest";
import { ShareWorld } from "./share_world_test_util.ts";

// Served by the non-SilverBullet test transport
const URI = "test://other/Library/Widgets.md";
const REMOTE_V1 =
  "---\nname: Library/Widgets\ntags: meta/library\nfiles:\n- widgets.plug.js\n---\nBody one\n";
const REMOTE_V2 = REMOTE_V1.replace("Body one", "Body two");
const PAGE = "Library/Widgets";

describe("share.install", () => {
  let w: ShareWorld;

  beforeEach(async () => {
    w = await ShareWorld.create();
  });

  const install = (opts: Record<string, unknown> = {}) =>
    w.h
      .call("share.install", URI, opts)
      .catch((e: Error) => `THREW ${e.message}`);

  /** PAGE as installed from `remote`, optionally edited since */
  async function installed(
    remote: string,
    { hash = false, edit = false } = {},
  ) {
    const m: Record<string, string> = { uri: URI, mode: "pull" };
    let text = (await w.h.call("share.setFrontmatter", m, remote)) as string;
    if (hash) {
      const legacy = await w.h.call("share.legacyHash", remote);
      text = (await w.h.call("index.patchFrontmatter", text, [
        { op: "set-key", path: "share.hash", value: legacy },
      ])) as string;
    }
    if (edit) text = text.replace("Body one", "Body one, edited locally");
    w.pages.set(PAGE, text);
  }

  test("installs under the remote's name, as a pull, and records the base", async () => {
    w.other.set(URI, REMOTE_V1);
    expect(await install()).toEqual({
      page: PAGE,
      files: ["widgets.plug.js"],
      changed: true,
    });
    const text = w.pages.get(PAGE)!;
    expect(text).toContain(URI);
    expect(text).toContain("mode: pull");
    expect(text).toContain("Body one");
    expect(w.store.get(`share.base:${URI}`)).toBe(REMOTE_V1);
    expect(w.store.get(`share.baseV2:${URI}`)).toBe(true);
  });

  test("a remote without a name needs a page", async () => {
    w.other.set(URI, "No frontmatter\n");
    expect(await install()).toBe(
      "THREW Library frontmatter missing required 'name'",
    );
    expect(await install({ page: "Repositories/R" })).toMatchObject({
      page: "Repositories/R",
      changed: true,
    });
    expect(w.pages.get("Repositories/R")).toContain("No frontmatter");
  });

  test("never overwrites an existing page on a first install", async () => {
    w.other.set(URI, REMOTE_V1);
    w.pages.set(PAGE, "mine\n");
    expect(await install()).toBe(`THREW Page already exists: ${PAGE}`);
    expect(w.pages.get(PAGE)).toBe("mine\n");
  });

  test("a missing remote is an error", async () => {
    expect(await install()).toBe(`THREW Could not fetch ${URI}`);
  });

  describe("updating an installed page", () => {
    const update = (force = false) => install({ installed: PAGE, force });

    test("an identical remote is a no-op", async () => {
      await installed(REMOTE_V1);
      w.other.set(URI, REMOTE_V1);
      const before = w.pages.get(PAGE);
      expect(await update()).toMatchObject({ changed: false });
      expect(w.pages.get(PAGE)).toBe(before);
      expect(w.store.size).toBe(1); // just the credential
    });

    test("a legacy share.hash does not block the no-op", async () => {
      await installed(REMOTE_V1, { hash: true });
      w.other.set(URI, REMOTE_V1);
      expect(await update()).toMatchObject({ changed: false });
    });

    test("a changed remote is written without a hash and sets the base", async () => {
      await installed(REMOTE_V1, { hash: true });
      w.other.set(URI, REMOTE_V2);
      expect(await update()).toMatchObject({ page: PAGE, changed: true });
      const text = w.pages.get(PAGE)!;
      expect(text).toContain("Body two");
      expect(text).not.toContain("share.hash");
      expect(w.store.get(`share.base:${URI}`)).toBe(REMOTE_V2);
    });

    test("force rewrites even when identical", async () => {
      await installed(REMOTE_V1, { edit: true });
      w.other.set(URI, REMOTE_V1);
      w.store.set(`share.base:${URI}`, REMOTE_V1);
      expect(await update(true)).toMatchObject({ changed: true });
      expect(w.pages.get(PAGE)).not.toContain("edited locally");
    });

    test("local edits stay while the remote is unchanged since install", async () => {
      await installed(REMOTE_V1, { edit: true });
      w.other.set(URI, REMOTE_V1);
      w.store.set(`share.base:${URI}`, REMOTE_V1);
      expect(await update()).toMatchObject({ changed: false });
      expect(w.pages.get(PAGE)).toContain("edited locally");
    });

    test("local edits stay with only a legacy hash and no base", async () => {
      await installed(REMOTE_V1, { hash: true, edit: true });
      w.other.set(URI, REMOTE_V1);
      expect(await update()).toMatchObject({ changed: false });
      expect(w.pages.get(PAGE)).toContain("edited locally");
    });

    test("local edits are replaced when the remote changed, once confirmed", async () => {
      await installed(REMOTE_V1, { edit: true });
      w.other.set(URI, REMOTE_V2);
      w.store.set(`share.base:${URI}`, REMOTE_V1);
      w.confirmAnswer = false;
      expect(await update()).toMatchObject({ changed: false });
      expect(w.pages.get(PAGE)).toContain("edited locally");
      w.confirmAnswer = true;
      expect(await update()).toMatchObject({ changed: true });
      expect(w.pages.get(PAGE)).toContain("Body two");
      expect(w.confirms).toEqual([
        `You changed ${PAGE} locally. Overwrite it with the version from ${URI}?`,
        `You changed ${PAGE} locally. Overwrite it with the version from ${URI}?`,
      ]);
    });

    test("without a base or hash the remote wins without asking", async () => {
      await installed(REMOTE_V1, { edit: true });
      w.other.set(URI, REMOTE_V2);
      expect(await update()).toMatchObject({ changed: true });
      expect(w.confirms).toEqual([]);
    });

    test("an installed page that already is the remote is left alone, whatever the base", async () => {
      // Updated on another device and synced in; this device's base is older
      await installed(REMOTE_V2);
      w.store.set(`share.base:${URI}`, REMOTE_V1);
      w.other.set(URI, REMOTE_V2);
      const before = w.pages.get(PAGE);
      expect(await update()).toMatchObject({ changed: false });
      expect(w.pages.get(PAGE)).toBe(before);
    });

    test("a base from before another device installed it is not used", async () => {
      // This device's base is V1, but the page's hash says V2 was installed since
      await installed(REMOTE_V2, { hash: true, edit: true });
      w.store.set(`share.base:${URI}`, REMOTE_V1);
      w.other.set(URI, REMOTE_V2);
      expect(await update()).toMatchObject({ changed: false });
    });

    test("install then update with an unchanged remote is a no-op", async () => {
      w.other.set(URI, REMOTE_V1);
      await install();
      expect(await update()).toMatchObject({ changed: false });
    });
  });
});
