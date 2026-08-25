import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

// The whole point of this file: exercise link resolution over real sync, with
// the service worker running, rather than the direct-HTTP path every other
// link test uses.
test.use({
  disableServiceWorker: false,
  spaceFiles: {
    "index.md": "Welcome",
    "bla/Notes.md": "Synced from the start",
    "Home.md": "Present: [[Notes]]\n\nNot yet: [[LaterPage]]\n",
  },
});

test("a bare link resolves after a fresh space sync", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Home");

  const relationsTo = (target: string) =>
    page.evaluate(async (name) => {
      const rel = await (globalThis as any).client.queryLuaObjects(
        "relation",
        {},
      );
      return rel.filter((r: any) => r.to === name).length;
    }, target);

  // The link target arrived with the sync, so the bare link must find it.
  await expect
    .poll(() => relationsTo("bla/Notes"), { timeout: 60_000 })
    .toBe(1);
});

test("a page that syncs in later fixes up links that pointed nowhere", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Home");

  const aspiringNames = () =>
    page.evaluate(async () => {
      const asp = await (globalThis as any).client.queryLuaObjects(
        "aspiring-page",
        {},
      );
      return asp.map((a: any) => a.name);
    });
  const relationsTo = (target: string) =>
    page.evaluate(async (name) => {
      const rel = await (globalThis as any).client.queryLuaObjects(
        "relation",
        {},
      );
      return rel.filter((r: any) => r.to === name).length;
    }, target);

  await expect.poll(aspiringNames, { timeout: 60_000 }).toContain("LaterPage");

  // Land the missing page on the server; sync brings it to the client.
  const resp = await fetch(`${sbServer.url}/.fs/deep/LaterPage.md`, {
    method: "PUT",
    body: "Arrived late",
  });
  expect(resp.ok).toBe(true);

  // Nothing rewrote Home, so only explicit invalidation can fix its link.
  await expect
    .poll(() => relationsTo("deep/LaterPage"), { timeout: 60_000 })
    .toBe(1);
  await expect
    .poll(aspiringNames, { timeout: 60_000 })
    .not.toContain("LaterPage");
});
