import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForSaveAndReadFromServer,
} from "./fixtures.ts";
import { runCommandViaPalette } from "./navigator-ui.ts";

test.use({
  spaceFiles: {
    "People/Pete Smith.md": [
      "---",
      "tags: recipient",
      "aliases:",
      "- pete",
      "---",
      "",
      "Pete's page.",
      "",
    ].join("\n"),
    "Handoff.md": [
      "---",
      "recipients:",
      "- pete",
      "---",
      "",
      "The whole page is for Pete.",
      "",
    ].join("\n"),
    "Notes.md": [
      "Talked to @PeteSmith about the launch.",
      "",
      "* [ ] Review the doc @PeteSmith",
      "* [x] Old task @PeteSmith",
      "",
      "Ping @Sales for approval.",
      "",
      "Also pinged @pete about it.",
      "",
      "Ship the deck to @Ops and @Design today.",
      "",
    ].join("\n"),
  },
});

test("a page-backed mention navigates and opens the Mention Inbox filtered, without taking focus", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");

  const mention = page.locator("a.sb-at-mention").first();
  await expect(mention).toHaveText("@PeteSmith");
  await mention.click();

  // Page-backed: the click navigates to the recipient's page...
  await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
    "People/Pete Smith",
  );

  // ...and additionally opens the Mention Inbox filtered on that recipient.
  const inbox = page.locator(".sb-nav-root-rhs");
  await expect(inbox.locator(".sb-nav-title")).toHaveText("Mention Inbox");
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  await expect(dropdown.locator("option:checked")).toHaveText("PeteSmith");
  await expect(
    inbox.locator(".sb-nav-row", {
      hasText: "Talked to @PeteSmith about the launch.",
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Ping @Sales for approval." }),
  ).toHaveCount(0);

  // The panel opened without stealing focus: the editor keeps it.
  await expect(page.locator("#sb-editor .cm-content")).toBeFocused();
});

test("a pageless mention opens the filtered Mention Inbox without navigating or taking focus", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");

  // @Sales has no page anywhere: a pageless recipient.
  const salesMention = page.locator("a.sb-at-mention", { hasText: "Sales" });
  await expect(salesMention).toBeVisible({ timeout: 10_000 });
  await salesMention.click();

  // No page to navigate to: the editor stays on Notes...
  await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Notes",
  );

  // ...while the Mention Inbox opens filtered on the pageless recipient.
  const inbox = page.locator(".sb-nav-root-rhs");
  await expect(inbox.locator(".sb-nav-title")).toHaveText("Mention Inbox");
  const salesRow = inbox.locator(".sb-nav-row", {
    hasText: "Ping @Sales for approval.",
  });
  await expect(salesRow).toBeVisible({ timeout: 20_000 });
  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Talked to @PeteSmith" }),
  ).toHaveCount(0);
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  await expect(dropdown.locator("option:checked")).toHaveText("Sales");

  // The editor keeps focus.
  await expect(page.locator("#sb-editor .cm-content")).toBeFocused();

  // A pageless mention has nothing to resolve into a link, but the other
  // actions remain.
  await salesRow.hover();
  await expect(
    salesRow.locator(".sb-row-action[aria-label='Resolve to link']"),
  ).toHaveCount(0);
  await expect(
    salesRow.locator(".sb-row-action[aria-label='Remove mention']"),
  ).toBeVisible();
});

test("every spelling of one recipient filters as that one person", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");

  // @pete is an alias of People/Pete Smith: clicking it navigates to the
  // same page @PeteSmith does...
  // Anchored regex: a plain "pete" would also match the @PeteSmith pills.
  const aliasMention = page.locator("a.sb-at-mention", { hasText: /^@pete$/ });
  await expect(aliasMention).toBeVisible({ timeout: 10_000 });
  await aliasMention.click();
  await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
    "People/Pete Smith",
  );

  // ...and the inbox opens filtered on the person, not on the spelling, so
  // mentions written either way are listed together.
  const inbox = page.locator(".sb-nav-root-rhs");
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  await expect(dropdown.locator("option:checked")).toHaveText("PeteSmith");
  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Also pinged @pete about it." }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    inbox.locator(".sb-nav-row", {
      hasText: "Talked to @PeteSmith about the launch.",
    }),
  ).toBeVisible();
  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Ping @Sales for approval." }),
  ).toHaveCount(0);
});

test("two mentions in one paragraph filter and list independently", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");

  // @Ops and @Design share one paragraph, so their Mention Inbox rows share a
  // snippet. Each must still be its own row: equal tree paths would collapse
  // them onto one node, and the dropdown's per-row masks would drop the
  // losing mention under every filter (the panel showed up empty).
  const opsMention = page.locator("a.sb-at-mention", { hasText: "Ops" });
  await expect(opsMention).toBeVisible({ timeout: 10_000 });
  await opsMention.click();

  const inbox = page.locator(".sb-nav-root-rhs");
  await expect(inbox.locator(".sb-nav-title")).toHaveText("Mention Inbox");
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  await expect(dropdown.locator("option:checked")).toHaveText("Ops");
  const sharedRow = inbox.locator(".sb-nav-row", {
    hasText: "Ship the deck to @Ops and @Design today.",
  });
  await expect(sharedRow).toHaveCount(1, { timeout: 20_000 });

  // The other mention in the same paragraph filters on its own too.
  await dropdown.selectOption({ label: "Design" });
  await expect(sharedRow).toHaveCount(1);

  // And under All Recipients both mentions list, one row each.
  await dropdown.selectOption({ label: "All Recipients" });
  await expect(sharedRow).toHaveCount(2);
});

test("mention inbox lists open mentions and resolve rewrites", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await runCommandViaPalette(page, "Navigate: Mentions");

  const inbox = page.locator(".sb-nav-root-rhs");
  await expect(inbox.locator(".sb-nav-title")).toHaveText("Mention Inbox");

  const paragraphRow = inbox.locator(".sb-nav-row", {
    hasText: "Talked to @PeteSmith about the launch.",
  });
  const taskRow = inbox.locator(".sb-nav-row", {
    hasText: "Review the doc @PeteSmith",
  });
  const salesRow = inbox.locator(".sb-nav-row", {
    hasText: "Ping @Sales for approval.",
  });
  const aliasRow = inbox.locator(".sb-nav-row", {
    hasText: "Also pinged @pete about it.",
  });
  await expect(paragraphRow).toBeVisible({ timeout: 20_000 });
  await expect(taskRow).toBeVisible();
  await expect(salesRow).toBeVisible();
  await expect(aliasRow).toBeVisible();
  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Old task @PeteSmith" }),
  ).toHaveCount(0);
  // The task's list marker is redundant next to the row's own check-square
  // icon, so it's stripped from the displayed snippet.
  await expect(taskRow).not.toContainText("[ ]");

  // The dropdown unions page-backed recipients with pageless ones.
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  await expect(
    dropdown.locator("option", { hasText: "All Recipients" }),
  ).toHaveCount(1);
  await expect(dropdown.locator("option", { hasText: "Sales" })).toHaveCount(1);
  // One entry per person, not per spelling: @pete and @PeteSmith are the
  // same recipient, so "pete" is not offered separately.
  await expect(
    dropdown.locator("option", { hasText: "PeteSmith" }),
  ).toHaveCount(1);
  await expect(dropdown.locator("option", { hasText: /^pete$/ })).toHaveCount(
    0,
  );
  // Filtering on the person lists every spelling's mentions. Reaching these
  // page-backed assertions without any reindex is what proves the mention
  // no longer depends on which page the index queue processed first.
  await dropdown.selectOption({ label: "PeteSmith" });
  await expect(paragraphRow).toBeVisible();
  await expect(taskRow).toBeVisible();
  await expect(aliasRow).toBeVisible();
  await expect(salesRow).toHaveCount(0);
  await dropdown.selectOption({ label: "All Recipients" });
  await expect(salesRow).toBeVisible();

  // The Mention Inbox is filterless (`filter = false`): the input is hidden, yet the
  // panel's keyboard navigation keeps working off it.
  await expect(inbox.locator("input.sb-nav-input")).not.toBeVisible();
  const selected = inbox.locator(".sb-nav-selected");
  const before = await selected.getAttribute("data-path");
  await page.keyboard.press("ArrowDown");
  await expect(selected).not.toHaveAttribute("data-path", before!);

  const folderRow = inbox.locator(".sb-nav-row.sb-nav-folder", {
    hasText: "Notes",
  });
  await folderRow.hover();
  await expect(
    folderRow.locator(".sb-row-action[aria-label='Resolve to link']"),
  ).toHaveCount(0);

  await paragraphRow.hover();
  await expect(
    paragraphRow.locator(".sb-row-action[aria-label='Resolve to link']"),
  ).toBeVisible();
  await paragraphRow
    .locator(".sb-row-action[aria-label='Resolve to link']")
    .click();

  // Notes.md is the page open in the editor, so resolveAtMention rewrites
  // it via an editor dispatch, which goes through the normal
  // sb-unsaved/sb-saved save cycle.
  const text = await waitForSaveAndReadFromServer(page, sbServer, "Notes.md");
  expect(text).toContain("[[People/Pete Smith|PeteSmith]]");
  expect(text).not.toContain("Talked to @PeteSmith");
});

test("remove mention deletes the mention without leaving a double space", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await runCommandViaPalette(page, "Navigate: Mentions");

  const inbox = page.locator(".sb-nav-root-rhs");
  const paragraphRow = inbox.locator(".sb-nav-row", {
    hasText: "Talked to @PeteSmith about the launch.",
  });
  await expect(paragraphRow).toBeVisible({ timeout: 20_000 });
  await paragraphRow.hover();
  await paragraphRow
    .locator(".sb-row-action[aria-label='Remove mention']")
    .click();

  const text = await waitForSaveAndReadFromServer(page, sbServer, "Notes.md");
  expect(text).toContain("Talked to about the launch.");
  expect(text).not.toContain("Talked to @PeteSmith");
  expect(text).not.toContain("  about");
});

test("delete task/item/paragraph removes the whole host line after confirming", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await runCommandViaPalette(page, "Navigate: Mentions");

  const inbox = page.locator(".sb-nav-root-rhs");
  const taskRow = inbox.locator(".sb-nav-row", {
    hasText: "Review the doc @PeteSmith",
  });
  await expect(taskRow).toBeVisible({ timeout: 20_000 });
  await taskRow.hover();
  await taskRow
    .locator(".sb-row-action[aria-label='Delete task/item/paragraph']")
    .click();

  const prompt = page.locator(".sb-prompt");
  await expect(prompt).toContainText(
    "Delete the entire task/item/paragraph containing this mention?",
  );
  await prompt.locator("button", { hasText: "Ok" }).click();

  const text = await waitForSaveAndReadFromServer(page, sbServer, "Notes.md");
  expect(text).not.toContain("Review the doc");
  // Only the one line goes: its sibling task stays.
  expect(text).toContain("* [x] Old task @PeteSmith");
});

test("a frontmatter-declared recipient is listed without mention actions", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await runCommandViaPalette(page, "Navigate: Mentions");

  const inbox = page.locator(".sb-nav-root-rhs");
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Talked to @PeteSmith" }),
  ).toBeVisible({ timeout: 20_000 });

  // Handoff.md never says "@pete" in its body: the declaration alone puts it
  // in the inbox, grouped with Pete's inline mentions.
  await dropdown.selectOption({ label: "PeteSmith" });
  const declaredRow = inbox.locator(".sb-nav-row", { hasText: /^@pete$/ });
  await expect(declaredRow).toBeVisible();

  // It addresses the whole page, so there is no `@nickname` span to rewrite
  // and none of the three mention actions are offered.
  await declaredRow.hover();
  for (const label of [
    "Resolve to link",
    "Remove mention",
    "Delete task/item/paragraph",
  ]) {
    await expect(
      declaredRow.locator(`.sb-row-action[aria-label='${label}']`),
    ).toHaveCount(0);
  }

  // Selecting it opens the declaring page.
  await declaredRow.click();
  await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Handoff",
  );
});
