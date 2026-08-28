import { expect, gotoSilverBulletPage, mod, test } from "./fixtures.ts";

test.use({
  spaceFiles: {
    "index.md": "Welcome",
    "Zef Hemel.md": "The person page",
    "Mentions.md": "Written by [[Zef Hemel]] and reviewed by [[Zef Hemel]].",
    "Config.md":
      '```space-lua\nconfig.set({"linkWriteFormat"}, "shortest")\n```\n',
  },
});

/**
 * Moving a page into a folder leaves bare links to it untouched — they still
 * resolve by name — so nothing rewrites the linking pages and nothing re-indexes
 * them. Without explicit invalidation the relation index keeps pointing at the
 * old name and every linked mention silently disappears.
 */
test("moving a page into a folder keeps its linked mentions", async ({
  sbPage,
  sbServer,
}) => {
  await gotoSilverBulletPage(sbPage, sbServer, "Mentions");

  const relationsTo = (name: string) =>
    sbPage.evaluate(async (target) => {
      const rel = await (globalThis as any).client.queryLuaObjects(
        "relation",
        {},
      );
      return rel.filter((r: any) => r.to === target).length;
    }, name);

  await expect.poll(() => relationsTo("Zef Hemel")).toBe(2);

  await gotoSilverBulletPage(sbPage, sbServer, "Zef Hemel");
  const nameInput = sbPage.locator("#sb-current-page input.sb-input");
  await nameInput.click();
  await sbPage.keyboard.press(`${mod}+a`);
  await sbPage.keyboard.type("fred/Zef Hemel");
  await sbPage.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (await fetch(`${sbServer.url}/.fs/fred/Zef%20Hemel.md`)).status,
      { timeout: 30_000 },
    )
    .toBe(200);

  // The link text is untouched: a bare name still finds the moved page.
  const mentions = await (
    await fetch(`${sbServer.url}/.fs/Mentions.md`)
  ).text();
  expect(mentions).toContain("[[Zef Hemel]]");

  // ...and the index followed the move, so the mentions are still there.
  await expect
    .poll(() => relationsTo("fred/Zef Hemel"), { timeout: 20_000 })
    .toBe(2);
  await expect.poll(() => relationsTo("Zef Hemel")).toBe(0);
});
