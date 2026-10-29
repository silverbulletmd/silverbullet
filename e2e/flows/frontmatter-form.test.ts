import type { Page } from "@playwright/test";
import { navFrame, navInput } from "../fixtures/actions.ts";
import {
  expect,
  gotoSilverBulletPage,
  mod,
  type SBServer,
  test,
} from "../fixtures/core.ts";

const tagsConfig = `# Tags
\`\`\`space-lua
tag.define {
  name = "person",
  schema = {
    type = "object",
    properties = {
      role = schema.enum { "Designer", "Engineer", "Manager" },
      email = schema.string(),
    },
  },
}

tag.define {
  name = "project",
  schema = {
    type = "object",
    properties = {
      status = schema.enum { "planned", "active", "done" },
      owner = schema.ref("person"),
      members = schema.array(schema.ref("person")),
      budget = schema.number(),
      due = schema.date(),
      public = schema.boolean(),
    },
  },
}

identity.define { name = "alice" }
\`\`\`
`;

const apollo = `---
tags: project
status: planned
owner: "[[Person/Alice]]"
budget: 10000
due: 2027-01-15
public: true
references:
  - First
  - Second
rating: "4"
---
Apollo body text.
`;

const longText =
  "A deliberately long description that has to wrap over several lines in the form rather than being clipped at the edge of a single-line field";

const spaceFiles = {
  "index.md": "Welcome",
  "CONFIG.md": tagsConfig,
  "Person/Alice.md": "---\ntags: person\nrole: Engineer\n---\nAlice",
  "Person/Bob.md": "---\ntags: person\nrole: Designer\n---\nBob",
  "Projects/Apollo.md": apollo,
  "Glossary.md": "---\ntags: glossary\n---\nTerms",
  "Notes/Long.md": `---\ndescription: ${longText}\n---\nBody`,
  "Notes/Flags.md": "---\nnote: plain text\ndone: true\n---\nFlags body.\n",
  "Notes/Linked.md":
    '---\nnote: "see [[Person/Alice]] soon"\nsummary: plain words\nrefs:\n  - First\n---\nLinked body.\n',
};

function docText(page: Page): Promise<string> {
  return page.evaluate(() =>
    (globalThis as any).client.editorView.state.doc.toString(),
  );
}

function form(page: Page) {
  return page.locator(".sb-frontmatter-preview .sb-fm-form");
}

function row(page: Page, key: string) {
  return form(page).locator(`.sb-fm-row[data-key="${key}"]`);
}

// After an undo or redo from the form, focus is in the editor; a real
// transaction afterwards must not bring a stale form back
async function settleInBody(page: Page, bodyText: string) {
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.locator(".cm-line", { hasText: bodyText }).click();
  await page.waitForTimeout(300);
}

function rowMenu(page: Page, key: string) {
  return row(page, key).locator(".sb-in-menu");
}

function rowMenuItem(page: Page, key: string, label: string) {
  return rowMenu(page, key).locator(".sb-in-option", { hasText: label });
}

async function openRowMenu(page: Page, key: string) {
  await row(page, key).locator(".sb-fm-key").hover();
  await row(page, key).locator(".sb-in-more").click();
  await expect(rowMenu(page, key)).toBeVisible();
}

function dropdown(page: Page, key: string) {
  return row(page, key).locator(".sb-in-dropdown:not([hidden])");
}

async function openApollo(page: Page, server: SBServer) {
  await gotoSilverBulletPage(page, server, "Projects/Apollo");
  await expect(row(page, "budget").locator("input")).toHaveValue("10000");
}

async function pickInFilterBox(page: Page, phrase: string, rowText: string) {
  await expect(navInput(page)).toBeVisible();
  await navInput(page).fill(phrase);
  await expect(
    navFrame(page).locator(".sb-nav-row .sb-nav-primary").first(),
  ).toHaveText(rowText);
  await page.keyboard.press("Enter");
  await expect(page.locator(".sb-modal")).toBeHidden();
}

test.describe("frontmatter form", () => {
  test.use({ spaceFiles });

  test("edits a number and keeps focus across Tab", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    await row(sbPage, "budget").locator("input").fill("20000");
    await sbPage.keyboard.press("Tab");
    await expect.poll(() => docText(sbPage)).toContain("budget: 20000\n");
    await expect(row(sbPage, "due").locator("input.sb-in-date")).toBeFocused();
  });

  test("toggles a boolean and picks a ref", async ({ sbPage, sbServer }) => {
    await openApollo(sbPage, sbServer);
    await row(sbPage, "public").locator("input[type=checkbox]").uncheck();
    await expect.poll(() => docText(sbPage)).toContain("public: false\n");

    // A pick replaces the chip in place
    await row(sbPage, "owner").locator(".sb-in-chip-input").fill("Bob");
    await expect(dropdown(sbPage, "owner")).toBeVisible();
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toContain('owner: "[[Person/Bob]]"\n');
    expect(await docText(sbPage)).toContain(
      'status: planned\nowner: "[[Person/Bob]]"\n',
    );
    await expect(row(sbPage, "owner").locator(".sb-in-chip-label")).toHaveText(
      "Person/Bob",
    );
  });

  test("a date shows as YYYY-MM-DD and is written quoted", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    const due = row(sbPage, "due").locator("input.sb-in-date");
    await expect(due).toHaveValue("2027-01-15");
    // A real date input sits over the calendar icon (iOS opens its wheel on a tap)
    const picker = row(sbPage, "due").locator(
      ".sb-in-date-button input[type=date]",
    );
    await expect(picker).toHaveValue("2027-01-15");
    await expect(picker).toHaveAttribute("aria-label", "Pick a date");
    await expect(picker).not.toHaveAttribute("aria-hidden", /.*/);
    await expect(
      row(sbPage, "due").locator(".sb-in-date-button"),
    ).toBeVisible();

    // Not a calendar date: marked invalid, nothing written
    await due.fill("2026-13-40");
    await sbPage.keyboard.press("Enter");
    await expect(due).toHaveClass(/sb-in-invalid/);
    await expect(due).toHaveAttribute("title", "There is no month 13");
    // So that picking the previous date again still fires a change
    await expect(row(sbPage, "due").locator(".sb-in-date-picker")).toHaveValue(
      "",
    );
    expect(await docText(sbPage)).toContain("due: 2027-01-15\n");

    await due.fill("2026-12-15");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toContain('budget: 10000\ndue: "2026-12-15"\npublic: true\n');
    await expect(due).not.toHaveClass(/sb-in-invalid/);
    await expect(picker).toHaveValue("2026-12-15");
  });

  test("undo restores the exact previous YAML", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    await row(sbPage, "budget").locator("input").fill("25000");
    await sbPage.keyboard.press("Enter");
    await expect.poll(() => docText(sbPage)).toContain("budget: 25000\n");

    await sbPage.locator(".cm-line", { hasText: "Apollo body text." }).click();
    await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toBe(apollo);
    // The form shows the restored value, also after another transaction
    await sbPage.locator(".cm-line", { hasText: "Apollo body text." }).click();
    await sbPage.waitForTimeout(300);
    await expect(row(sbPage, "budget").locator("input")).toHaveValue("10000");
  });

  test("Delete in the widget menu removes the frontmatter; undo restores it", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    const preview = sbPage.locator(".sb-frontmatter-preview");
    await preview.hover();
    await preview.locator('button[data-button="menu"]').first().click();
    await sbPage.getByRole("menuitem", { name: "Delete" }).click();
    await expect.poll(() => docText(sbPage)).toBe("Apollo body text.\n");
    await expect(preview).toHaveCount(0);
    await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toBe(apollo);
    await expect(row(sbPage, "budget").locator("input")).toHaveValue("10000");
  });

  test("undo with focus still in the form restores a removed chip", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    const owner = row(sbPage, "owner");
    await owner.locator(".sb-in-chip-input").focus();
    await owner.locator(".sb-in-chip .sb-in-x").click();
    await expect.poll(() => docText(sbPage)).not.toContain("owner:");
    await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toBe(apollo);
    await settleInBody(sbPage, "Apollo body text.");
    await expect(owner.locator(".sb-in-chip-label")).toHaveText("Person/Alice");
  });

  test("undo and redo with focus on a checkbox", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    const checkbox = row(sbPage, "public").locator("input[type=checkbox]");
    await checkbox.uncheck();
    await expect(checkbox).toBeFocused();
    await expect.poll(() => docText(sbPage)).toContain("public: false\n");
    await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toBe(apollo);
    await settleInBody(sbPage, "Apollo body text.");
    await expect(
      row(sbPage, "public").locator("input[type=checkbox]"),
    ).toBeChecked();

    // Redo from inside the form too
    await row(sbPage, "public").locator("input[type=checkbox]").focus();
    await sbPage.keyboard.press(`${mod}+Shift+z`);
    await expect.poll(() => docText(sbPage)).toContain("public: false\n");
    await settleInBody(sbPage, "Apollo body text.");
    await expect(
      row(sbPage, "public").locator("input[type=checkbox]"),
    ).not.toBeChecked();
  });

  test("undo from the form on a page without a schema", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Flags");
    const box = row(sbPage, "done").locator("input[type=checkbox]");
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect(box).toBeFocused();
    await expect.poll(() => docText(sbPage)).toContain("done: false\n");
    await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toContain("done: true\n");
    await settleInBody(sbPage, "Flags body.");
    await expect(
      row(sbPage, "done").locator("input[type=checkbox]"),
    ).toBeChecked();
    await expect(row(sbPage, "note").locator("textarea")).not.toBeFocused();
  });

  test("each form edit is one undo step", async ({ sbPage, sbServer }) => {
    await openApollo(sbPage, sbServer);
    // A list reorder, then a date, in quick succession
    const second = row(sbPage, "references").locator(".sb-in-list-item").nth(1);
    await second.hover();
    await second.locator(".sb-in-more").click();
    await second.locator(".sb-in-option", { hasText: "Move up" }).click();
    await expect
      .poll(() => docText(sbPage))
      .toContain("references:\n  - Second\n  - First\n");
    const due = row(sbPage, "due").locator("input.sb-in-date");
    await due.fill("2026-12-15");
    await sbPage.keyboard.press("Enter");
    await expect.poll(() => docText(sbPage)).toContain('due: "2026-12-15"\n');

    await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toContain("due: 2027-01-15\n");
    expect(await docText(sbPage)).toContain("  - Second\n  - First\n");
    await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toBe(apollo);
  });

  test("the row menu shows the type and converts a custom attribute", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    await openRowMenu(sbPage, "rating");
    await expect(
      rowMenu(sbPage, "rating").locator(".sb-in-menu-header"),
    ).toHaveText("string");
    await rowMenuItem(sbPage, "rating", "Change type…").click();
    await pickInFilterBox(sbPage, "number", "number");
    await expect.poll(() => docText(sbPage)).toContain("rating: 4\n");
    await expect(row(sbPage, "rating").locator("input")).toHaveAttribute(
      "type",
      "number",
    );
    await openRowMenu(sbPage, "rating");
    await expect(
      rowMenu(sbPage, "rating").locator(".sb-in-menu-header"),
    ).toHaveText("number");
    // A schema row shows its type, but can't change it
    await openRowMenu(sbPage, "owner");
    await expect(
      rowMenu(sbPage, "owner").locator(".sb-in-menu-header"),
    ).toHaveText("ref → #person");
    await expect(rowMenuItem(sbPage, "owner", "Change type…")).toHaveCount(0);
  });

  test("the row menu moves and deletes attributes", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    await openRowMenu(sbPage, "budget");
    await rowMenuItem(sbPage, "budget", "Move down").click();
    await expect
      .poll(() => docText(sbPage))
      .toBe(
        apollo.replace(
          "budget: 10000\ndue: 2027-01-15\n",
          "due: 2027-01-15\nbudget: 10000\n",
        ),
      );
    // The form follows the new order
    await expect(form(sbPage).locator(".sb-fm-row").nth(4)).toHaveAttribute(
      "data-key",
      "budget",
    );

    await openRowMenu(sbPage, "public");
    await rowMenuItem(sbPage, "public", "Delete").click();
    await expect.poll(() => docText(sbPage)).not.toContain("public:");
    expect(await docText(sbPage)).toContain("budget: 10000\nreferences:");
  });

  test("the row menu opens from the keyboard", async ({ sbPage, sbServer }) => {
    await openApollo(sbPage, sbServer);
    const button = row(sbPage, "status").locator(".sb-in-more");
    await button.focus();
    await sbPage.keyboard.press("Enter");
    const menu = rowMenu(sbPage, "status");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".sb-in-option.sb-in-selected")).toHaveText(
      "Move up",
    );
    await sbPage.keyboard.press("ArrowDown");
    await expect(menu.locator(".sb-in-option.sb-in-selected")).toHaveText(
      "Move down",
    );
    await sbPage.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(await docText(sbPage)).toBe(apollo);

    // Shift+F10 in a field opens its row's menu, focus on the first item
    await row(sbPage, "budget").locator("input").focus();
    await sbPage.keyboard.press("Shift+F10");
    const budgetMenu = rowMenu(sbPage, "budget");
    await expect(budgetMenu).toBeVisible();
    await expect(
      budgetMenu.locator(".sb-in-option", { hasText: "Move up" }),
    ).toBeFocused();
    await sbPage.keyboard.press("ArrowDown");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toContain("due: 2027-01-15\nbudget: 10000\n");
  });

  test("adds a new attribute by typing its name and picking Add", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    await form(sbPage).locator(".sb-fm-add-attr").click();
    await expect(navInput(sbPage)).toBeVisible();
    await navInput(sbPage).fill("codename");
    // The typed name is offered second, after the best match
    const added = navFrame(sbPage).locator(".sb-nav-row", {
      hasText: "codename",
    });
    await expect(added).toContainText("Add");
    await sbPage.keyboard.press("ArrowDown");
    await sbPage.keyboard.press("Enter");
    await pickInFilterBox(sbPage, "string", "string");

    const input = row(sbPage, "codename").locator("textarea");
    await expect(input).toBeFocused();
    await sbPage.keyboard.type("Moonshot");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toContain('rating: "4"\ncodename: Moonshot\n---\n');
  });

  for (const { type, field, value, written, separator = " " } of [
    {
      type: "string",
      field: "textarea",
      value: "Moonshot",
      written: "Moonshot",
    },
    { type: "number", field: "input", value: "7", written: "7" },
    {
      type: "date",
      field: "input.sb-in-date",
      value: "2027-03-01",
      written: '"2027-03-01"',
    },
    {
      type: "string[]",
      field: "textarea",
      value: "Alpha",
      written: "\n  - Alpha",
      separator: "",
    },
  ]) {
    test(`adds a ${type} attribute right after an edit committed with focus kept`, async ({
      sbPage,
      sbServer,
    }) => {
      await openApollo(sbPage, sbServer);
      // Enter commits and keeps focus, so the form is out of date until it's
      // left; opening the picker leaves it
      const budget = row(sbPage, "budget").locator("input");
      await budget.fill("12000");
      await sbPage.keyboard.press("Enter");
      await expect.poll(() => docText(sbPage)).toContain("budget: 12000\n");
      await expect(budget).toBeFocused();

      await form(sbPage).locator(".sb-fm-add-attr").click();
      await expect(navInput(sbPage)).toBeVisible();
      await navInput(sbPage).fill("codename");
      await sbPage.keyboard.press("Shift+Enter");
      await pickInFilterBox(sbPage, type, type);

      const input = row(sbPage, "codename").locator(field).first();
      await expect(input).toBeFocused();
      await input.fill(value);
      await sbPage.keyboard.press("Enter");
      await expect
        .poll(() => docText(sbPage))
        .toContain(`rating: "4"\ncodename:${separator}${written}\n`);
    });
  }

  test("Shift-Enter adds exactly the typed name", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    await form(sbPage).locator(".sb-fm-add-attr").click();
    await expect(navInput(sbPage)).toBeVisible();
    // "own" fuzzily matches owner and others; Shift-Enter still takes the text
    await navInput(sbPage).fill("own");
    await sbPage.keyboard.press("Shift+Enter");
    await pickInFilterBox(sbPage, "number", "number");
    const input = row(sbPage, "own").locator("input");
    await expect(input).toBeFocused();
    await input.fill("3");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toContain('rating: "4"\nown: 3\n---\n');
  });

  test("read-only page shows disabled inputs and writes nothing", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(
      sbPage,
      sbServer,
      "Library/Std/Widgets/Object Form",
    );
    const value = row(sbPage, "description").locator(".sb-in-plain");
    await expect(value).toContainText("frontmatter");
    await expect(
      form(sbPage).locator("input, textarea, select, .sb-in-x"),
    ).toHaveCount(0);
    await expect(form(sbPage).locator(".sb-in-more")).toHaveCount(0);
    await expect(form(sbPage).locator(".sb-fm-add-attr")).toHaveCount(0);
  });

  test("tags complete, accept new names and keep a space-separated string", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    const input = row(sbPage, "tags").locator(".sb-in-chip-input");
    await input.click();
    await sbPage.keyboard.type("glo");
    await expect(dropdown(sbPage, "tags")).toContainText("#glossary");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toContain("---\ntags: project glossary\nstatus");

    await sbPage.keyboard.type("launch");
    await sbPage.keyboard.press(" ");
    await expect
      .poll(() => docText(sbPage))
      .toContain("---\ntags: project glossary launch\nstatus");

    await row(sbPage, "tags")
      .locator(".sb-in-chip", { hasText: "#project" })
      .locator(".sb-in-x")
      .click();
    await expect
      .poll(() => docText(sbPage))
      .toContain("---\ntags: glossary launch\nstatus");
  });

  test("adds a recipient through completion", async ({ sbPage, sbServer }) => {
    await openApollo(sbPage, sbServer);
    await form(sbPage).locator(".sb-fm-add-attr").click();
    await pickInFilterBox(sbPage, "recipients", "recipients");
    const input = row(sbPage, "recipients").locator(".sb-in-chip-input");
    await expect(input).toBeFocused();
    await sbPage.keyboard.type("ali");
    await expect(dropdown(sbPage, "recipients")).toContainText("@alice");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toContain('rating: "4"\nrecipients: alice\n---\n');
  });

  test("edits a string list one item per line", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    const references = row(sbPage, "references");
    const items = references.locator(".sb-in-list-item");
    await expect(items).toHaveCount(2);

    await references.locator(".sb-in-add").click();
    await sbPage.keyboard.type("Third");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toContain("references:\n  - First\n  - Second\n  - Third\nrating");

    // Move Third up with its menu
    const third = items.nth(2);
    await third.hover();
    await third.locator(".sb-in-more").click();
    await third.locator(".sb-in-option", { hasText: "Move up" }).click();
    await expect
      .poll(() => docText(sbPage))
      .toContain("references:\n  - First\n  - Third\n  - Second\nrating");

    const first = items.nth(0);
    await first.hover();
    await first.locator(".sb-in-more").click();
    await first.locator(".sb-in-option", { hasText: "Remove" }).click();
    await expect
      .poll(() => docText(sbPage))
      .toContain("references:\n  - Third\n  - Second\nrating");
  });

  test("a long string wraps, and Enter commits it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Long");
    const field = row(sbPage, "description").locator("textarea");
    await expect(field).toHaveValue(longText);
    const lineHeight = await field.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).lineHeight),
    );
    const height = (await field.boundingBox())!.height;
    expect(height).toBeGreaterThan(lineHeight * 1.5);

    await field.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    await sbPage.keyboard.type(" today");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toContain(`description: ${longText} today\n---`);
  });

  test("Shift-Enter inserts a newline in a text field and in a list item", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Long");
    const field = row(sbPage, "description").locator("textarea");
    await field.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    await sbPage.keyboard.type(" one");
    await sbPage.keyboard.press("Shift+Enter");
    await sbPage.keyboard.type("two");
    await expect(field).toHaveValue(`${longText} one\ntwo`);
    // Not committed yet: Shift-Enter doesn't write
    expect(await docText(sbPage)).toContain(`description: ${longText}\n---`);
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toMatch(/description: ".* one\\ntwo"\n---/);

    await openApollo(sbPage, sbServer);
    const references = row(sbPage, "references");
    const items = references.locator(".sb-in-list-item");
    await references.locator(".sb-in-add").click();
    await sbPage.keyboard.type("Third");
    await sbPage.keyboard.press("Shift+Enter");
    await sbPage.keyboard.type("more");
    await expect(items).toHaveCount(3);
    await expect(items.nth(2).locator("textarea")).toHaveValue("Third\nmore");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toContain(
        'references:\n  - First\n  - Second\n  - "Third\\nmore"\nrating',
      );
  });

  test("an outside edit while focused shows up after blur", async ({
    sbPage,
    sbServer,
  }) => {
    await openApollo(sbPage, sbServer);
    const budget = row(sbPage, "budget").locator("input");
    await budget.fill("30000");
    await expect(budget).toBeFocused();
    await sbPage.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      const from = view.state.doc.toString().indexOf("planned");
      view.dispatch({ changes: { from, to: from + 7, insert: "active" } });
    });
    // The form keeps its DOM while focused, so the select still shows the old value
    await expect(row(sbPage, "status").locator("select")).toHaveValue(
      "planned",
    );

    await sbPage.locator(".cm-line", { hasText: "Apollo body text." }).click();
    await expect.poll(() => docText(sbPage)).toContain("budget: 30000\n");
    expect(await docText(sbPage)).toContain("status: active\n");
    await expect(row(sbPage, "status").locator("select")).toHaveValue("active");
    await expect(budget).toHaveValue("30000");
  });
});

test.describe("links in text fields", () => {
  test.use({ spaceFiles });

  const clickBody = (page: Page) =>
    page.locator(".cm-line", { hasText: "Linked body." }).click();

  test("a link in a text value shows as a link that navigates", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Linked");
    const link = row(sbPage, "note").locator("a.sb-in-link");
    await expect(link).toHaveText("Person/Alice");
    await expect(row(sbPage, "note")).toContainText("see Person/Alice soon");
    await link.click();
    await expect
      .poll(() =>
        sbPage.evaluate(() => (globalThis as any).client.currentName()),
      )
      .toBe("Person/Alice");
  });

  test("clicking beside the link edits the text", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Linked");
    await row(sbPage, "note")
      .locator(".sb-in-linktext")
      .click({
        position: { x: 2, y: 5 },
      });
    const field = row(sbPage, "note").locator("textarea");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("see [[Person/Alice]] soon");
  });

  test("typing [[ completes a page in a text field", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Linked");
    const field = row(sbPage, "summary").locator("textarea");
    await field.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    await sbPage.keyboard.type(" [[Person/B");
    await expect(
      row(sbPage, "summary").locator(".sb-in-dropdown"),
    ).toContainText("Person/Bob");
    await sbPage.keyboard.press("Enter");
    await expect(field).toHaveValue("plain words [[Person/Bob]]");
    await clickBody(sbPage);
    await expect
      .poll(() => docText(sbPage))
      .toContain("summary: plain words [[Person/Bob]]\n");
  });

  test("typing [[ completes a page in a list item", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Linked");
    const item = row(sbPage, "refs").locator("textarea").first();
    await item.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    await sbPage.keyboard.type(" [[Person/A");
    await expect(row(sbPage, "refs").locator(".sb-in-dropdown")).toContainText(
      "Person/Alice",
    );
    await sbPage.keyboard.press("Tab");
    await expect(item).toHaveValue("First [[Person/Alice]]");
    await clickBody(sbPage);
    await expect
      .poll(() => docText(sbPage))
      .toContain("refs:\n  - First [[Person/Alice]]\n");
  });
});

test.describe("frontmatter form opt-out", () => {
  test.use({
    spaceFiles: {
      ...spaceFiles,
      "CONFIG.md": `${tagsConfig}
\`\`\`space-lua
config.set("liveEdit", { frontmatter = false })
\`\`\`
`,
    },
  });

  test("turning liveEdit.frontmatter off restores YAML", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Projects/Apollo");
    // Plain YAML, every line shown: there is no folding
    await expect(
      sbPage.locator(".cm-line", { hasText: "budget: 10000" }),
    ).toBeVisible();
    await expect(
      sbPage.locator(".cm-line", { hasText: "- Second" }),
    ).toBeVisible();
    await expect(sbPage.locator(".cm-foldPlaceholder")).toHaveCount(0);
    await expect(sbPage.locator(".sb-fm-form")).toHaveCount(0);
    await expect(sbPage.locator(".sb-frontmatter-preview")).toHaveCount(0);
  });
});
