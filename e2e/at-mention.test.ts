import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForSaveAndReadFromServer,
} from "./fixtures.ts";
import { runCommandViaPalette } from "./navigator-ui.ts";

test.use({
  spaceFiles: {
    "Library/Recipients.md": [
      "```space-lua",
      'recipient.define { name = "sales", description = "Sales team" }',
      "```",
      "",
    ].join("\n"),
    "Handoff.md": [
      "---",
      "recipients:",
      "- sales",
      "---",
      "",
      "The whole page is for Sales.",
      "",
    ].join("\n"),
    "Notes.md": [
      "Talked to @sales about the launch.",
      "",
      "* [ ] Review the doc @sales",
      "* [x] Old task @sales",
      "",
      "Ping @Ops for approval.",
      "",
      "Ship the deck to @Design and @Docs today.",
      "",
    ].join("\n"),
  },
});

/** Where the space knows who you are, the inbox opens on your own mentions;
 * a test that wants everyone's says so explicitly. */
async function showAllRecipients(page: any) {
  const dropdown = page.locator(".sb-nav-root-rhs select.sb-nav-dropdown");
  await dropdown.selectOption({ label: "All Recipients" });
  return dropdown;
}

test("clicking a mention opens the filtered Mention Inbox, never navigating or taking focus", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");

  const mention = page
    .locator("a.sb-at-mention", { hasText: "@sales" })
    .first();
  await expect(mention).toBeVisible({ timeout: 10_000 });
  await mention.click();

  // A recipient is a name, not a place: the editor stays put.
  await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Notes",
  );

  const inbox = page.locator(".sb-nav-root-rhs");
  await expect(inbox.locator(".sb-nav-title")).toHaveText("Mention Inbox");
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  await expect(dropdown.locator("option:checked")).toHaveText("sales");
  await expect(
    inbox.locator(".sb-nav-row", {
      hasText: "Talked to @sales about the launch.",
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Ping @Ops for approval." }),
  ).toHaveCount(0);

  // The panel opened without stealing focus: the editor keeps it.
  await expect(page.locator("#sb-editor .cm-content")).toBeFocused();
});

test("a hand-picked filter is remembered across a reopen", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await runCommandViaPalette(page, "Navigate: Mentions");

  const inbox = page.locator(".sb-nav-root-rhs");
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  // This deployment has no accounts, so nobody is "you" and nothing is
  // filtered by default.
  await expect(dropdown.locator("option:checked")).toHaveText("All Recipients");

  await expect(dropdown.locator("option", { hasText: "sales" })).toHaveCount(
    1,
    {
      timeout: 20_000,
    },
  );
  await dropdown.selectOption({ label: "sales" });
  await expect(dropdown.locator("option:checked")).toHaveText("sales");

  // Genuinely close it and open it again. `Navigate: Mentions` only ever
  // opens (`openCommand`), so invoking it twice would re-open an already-open
  // panel and assert nothing — Escape is what closes it.
  await page.keyboard.press("Escape");
  await expect(inbox).toHaveCount(0);
  await runCommandViaPalette(page, "Navigate: Mentions");
  await expect(inbox).toHaveCount(1);

  await expect(dropdown.locator("option:checked")).toHaveText("sales");
});

test("a defined recipient completes with its description", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await page.locator(".cm-content").click();
  await page.keyboard.press(
    `${process.platform === "darwin" ? "Meta" : "Control"}+End`,
  );
  await page.keyboard.type("\n\nPing @sal");

  const completion = page.locator(".cm-tooltip-autocomplete");
  await expect(completion).toBeVisible({ timeout: 10_000 });
  await expect(completion).toContainText("sales");
  await expect(completion).toContainText("Sales team");
});

test("two mentions in one paragraph filter and list independently", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");

  // @Design and @Docs share one paragraph, so their Mention Inbox rows share
  // a snippet. Each must still be its own row: equal tree paths would
  // collapse them onto one node, and the dropdown's per-row masks would drop
  // the losing mention under every filter (the panel showed up empty).
  const designMention = page.locator("a.sb-at-mention", { hasText: "Design" });
  await expect(designMention).toBeVisible({ timeout: 10_000 });
  await designMention.click();

  const inbox = page.locator(".sb-nav-root-rhs");
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  await expect(dropdown.locator("option:checked")).toHaveText("Design");
  const sharedRow = inbox.locator(".sb-nav-row", {
    hasText: "Ship the deck to @Design and @Docs today.",
  });
  await expect(sharedRow).toHaveCount(1, { timeout: 20_000 });

  await dropdown.selectOption({ label: "Docs" });
  await expect(sharedRow).toHaveCount(1);

  await dropdown.selectOption({ label: "All Recipients" });
  await expect(sharedRow).toHaveCount(2);
});

test("mention inbox lists open mentions, and offers no link action", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await runCommandViaPalette(page, "Navigate: Mentions");

  const inbox = page.locator(".sb-nav-root-rhs");
  await expect(inbox.locator(".sb-nav-title")).toHaveText("Mention Inbox");
  const dropdown = await showAllRecipients(page);

  const paragraphRow = inbox.locator(".sb-nav-row", {
    hasText: "Talked to @sales about the launch.",
  });
  const taskRow = inbox.locator(".sb-nav-row", {
    hasText: "Review the doc @sales",
  });
  const opsRow = inbox.locator(".sb-nav-row", {
    hasText: "Ping @Ops for approval.",
  });
  await expect(paragraphRow).toBeVisible({ timeout: 20_000 });
  await expect(taskRow).toBeVisible();
  await expect(opsRow).toBeVisible();
  // A done task is not an open mention.
  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Old task @sales" }),
  ).toHaveCount(0);
  // The task's list marker is redundant next to the row's own check-square
  // icon, so it's stripped from the displayed snippet.
  await expect(taskRow).not.toContainText("[ ]");

  // The dropdown unions defined recipients with names only ever mentioned.
  await expect(
    dropdown.locator("option", { hasText: "All Recipients" }),
  ).toHaveCount(1);
  await expect(dropdown.locator("option", { hasText: "sales" })).toHaveCount(1);
  await expect(dropdown.locator("option", { hasText: "Ops" })).toHaveCount(1);

  await dropdown.selectOption({ label: "sales" });
  await expect(paragraphRow).toBeVisible();
  await expect(taskRow).toBeVisible();
  await expect(opsRow).toHaveCount(0);
  await dropdown.selectOption({ label: "All Recipients" });
  await expect(opsRow).toBeVisible();

  // The Mention Inbox is filterless (`filter = false`): the input is hidden,
  // yet the panel's keyboard navigation keeps working off it.
  await expect(inbox.locator("input.sb-nav-input")).not.toBeVisible();
  const selected = inbox.locator(".sb-nav-selected");
  const before = await selected.getAttribute("data-path");
  await page.keyboard.press("ArrowDown");
  await expect(selected).not.toHaveAttribute("data-path", before!);

  // Recipients have no page, so there is nothing to resolve a mention into.
  await paragraphRow.hover();
  await expect(
    paragraphRow.locator(".sb-row-action[aria-label='Resolve to link']"),
  ).toHaveCount(0);
  await expect(
    paragraphRow.locator(".sb-row-action[aria-label='Remove mention']"),
  ).toBeVisible();
});

test("remove mention deletes the mention without leaving a double space", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await runCommandViaPalette(page, "Navigate: Mentions");
  await showAllRecipients(page);

  const inbox = page.locator(".sb-nav-root-rhs");
  const paragraphRow = inbox.locator(".sb-nav-row", {
    hasText: "Talked to @sales about the launch.",
  });
  await expect(paragraphRow).toBeVisible({ timeout: 20_000 });
  await paragraphRow.hover();
  await paragraphRow
    .locator(".sb-row-action[aria-label='Remove mention']")
    .click();

  const text = await waitForSaveAndReadFromServer(page, sbServer, "Notes.md");
  expect(text).toContain("Talked to about the launch.");
  expect(text).not.toContain("Talked to @sales");
  expect(text).not.toContain("  about");
});

test("delete task/item/paragraph removes the whole host line after confirming", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await runCommandViaPalette(page, "Navigate: Mentions");
  await showAllRecipients(page);

  const inbox = page.locator(".sb-nav-root-rhs");
  const taskRow = inbox.locator(".sb-nav-row", {
    hasText: "Review the doc @sales",
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
  expect(text).toContain("* [x] Old task @sales");
});

test("a frontmatter-declared recipient is listed without mention actions", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await runCommandViaPalette(page, "Navigate: Mentions");

  const inbox = page.locator(".sb-nav-root-rhs");
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  // Handoff.md never says "@sales" in its body: the declaration alone puts
  // it in the inbox, grouped with the inline mentions, and the row is shown
  // by the page's opening line rather than by the name.
  await expect(dropdown.locator("option", { hasText: "sales" })).toHaveCount(
    1,
    { timeout: 20_000 },
  );
  await dropdown.selectOption({ label: "sales" });
  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Talked to @sales" }),
  ).toBeVisible({ timeout: 20_000 });
  const declaredRow = inbox.locator(".sb-nav-row", {
    hasText: "The whole page is for Sales.",
  });
  await expect(declaredRow).toBeVisible();
  // Which recipient it names rides along as a chip: two declarations on one
  // page share the opening line and would otherwise read as the same row.
  await expect(declaredRow.locator(".sb-nav-chip")).toHaveText("@sales");

  // It addresses the whole page, so there is no `@name` span to rewrite and
  // neither mention action is offered.
  await declaredRow.hover();
  for (const label of ["Remove mention", "Delete task/item/paragraph"]) {
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
