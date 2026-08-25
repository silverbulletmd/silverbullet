import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

test.use({
  spaceFiles: {
    "index.md": "Welcome",
    // `Notes` exists only in a subfolder, so a bare link must find it.
    "bla/Notes.md": "The one and only Notes page",
    // `Twin` exists in two subfolders and nowhere at the root, which is the
    // ambiguous case a rewrite can actually resolve.
    "one/Twin.md": "Twin in one",
    "two/Twin.md": "Twin in two",
    // `api/Auth` exists only under `docs/`, so a qualified link written
    // against a narrower root must find it by path suffix.
    "docs/api/Auth.md": "The auth page under docs",
    "Start.md": [
      "Bare link: [[Notes]]",
      "",
      "Qualified link: [[bla/Notes]]",
      "",
      "Suffix link: [[api/Auth]]",
      "",
      "Ambiguous link: [[Twin]]",
      "",
      "Broken link: [[NoSuchPageAnywhere]]",
      "",
    ].join("\n"),
    "Embeds.md": ["Embedded: ![[Notes]]", ""].join("\n"),
  },
});

test("a bare link resolves to a page in a subfolder", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Start");

  const bare = page.locator(".sb-wiki-link", { hasText: "Notes" }).first();
  await expect(bare).toBeVisible();
  await expect(bare).not.toHaveClass(/sb-wiki-link-missing/);

  await bare.click();
  await expect(page.locator("#sb-editor")).toContainText(
    "The one and only Notes page",
  );
});

test("a link to a page that does not exist is still marked missing", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Start");
  await expect(
    page.locator(".sb-wiki-link-missing", { hasText: "NoSuchPageAnywhere" }),
  ).toBeVisible();
});

test("an ambiguous link is flagged, and picking a page navigates without rewriting", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Start");

  const ambiguous = page.locator(".sb-wiki-link-ambiguous").first();
  await expect(ambiguous).toBeVisible();

  await ambiguous.click();

  // The picker offers both candidates; choosing one navigates to it.
  const filter = page.locator(".sb-modal-box input");
  await expect(filter).toBeVisible();
  await filter.fill("two/Twin");
  // Enter picks whatever the list currently holds, so wait for it to narrow —
  // otherwise the keystroke can beat the re-render and select the top of the
  // unfiltered list.
  const options = page.locator(".sb-modal-box .sb-option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("two/Twin");
  await page.keyboard.press("Enter");

  // Picking navigates to the chosen page...
  await expect(page.locator("#sb-editor")).toContainText("Twin in two");

  // ...but the link it was followed from keeps its text: following a link is
  // reading, and reading does not edit the document. The ambiguity stays.
  const source = await (await fetch(`${sbServer.url}/.fs/Start.md`)).text();
  expect(source).toContain("[[Twin]]");
  expect(source).not.toContain("[[two/Twin]]");
});

test("a qualified link resolves by path suffix, as at a wider space root", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Start");

  // `shortWikiLinks` renders the link as its bare name, so a resolved suffix
  // link reads "Auth"; only a missing one would still read "api/Auth".
  const suffix = page.locator(".sb-wiki-link", { hasText: "Auth" }).first();
  await expect(suffix).toBeVisible();
  await expect(suffix).not.toHaveClass(/sb-wiki-link-missing/);
  await expect(suffix).not.toHaveClass(/sb-wiki-link-ambiguous/);

  await suffix.click();
  await expect(page.locator("#sb-editor")).toContainText(
    "The auth page under docs",
  );
});

test("a bare transclusion embeds the page a bare link would open", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Embeds");

  await expect(page.locator(".sb-inline-content")).toContainText(
    "The one and only Notes page",
  );
});
