import type { Page } from "@playwright/test";
import {
  clickRevealedMenu,
  docText,
  navFrame,
  navInput,
} from "../fixtures/actions.ts";
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

const spaceFiles = {
  "index.md": "Welcome",
  "Library/Config.md": tagsConfig,
  "Person/Alice.md": "---\ntags: person\nrole: Engineer\n---\nAlice",
  "Person/Bob.md": "---\ntags: person\nrole: Designer\n---\nBob",
  "Projects/Apollo.md": apollo,
  "Glossary.md": "---\ntags: glossary\n---\nTerms",
  "Notes/Linked.md":
    '---\nnote: "see [[Person/Alice]] soon"\nsummary: plain words\nrefs:\n  - First\n---\nLinked body.\n',
};

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
    await clickRevealedMenu(
      preview.locator('button[data-button="menu"]').first(),
    );
    await sbPage.getByRole("menuitem", { name: "Delete" }).click();
    await expect.poll(() => docText(sbPage)).toBe("Apollo body text.\n");
    await expect(preview).toHaveCount(0);
    await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toBe(apollo);
    await expect(row(sbPage, "budget").locator("input")).toHaveValue("10000");
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
});

test.describe("frontmatter form opt-out", () => {
  test.use({
    spaceFiles: {
      ...spaceFiles,
      "Library/Config.md": `${tagsConfig}
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
