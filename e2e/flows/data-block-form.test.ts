import type { Page } from "@playwright/test";
import { navFrame, navInput, openWidgetMenu } from "../fixtures/actions.ts";
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
  name = "contact",
  schema = {
    type = "object",
    properties = {
      role = schema.enum { "Designer", "Engineer", "Manager" },
      email = schema.string(),
    },
  },
}
\`\`\`
`;

const contacts = `# Contacts

\`\`\`#contact
name: Alice
role: Engineer
---
name: Bob
email: bob@example.com
\`\`\`

Contacts body text.
`;

const spaceFiles = {
  "index.md": "Welcome",
  "Library/Config.md": tagsConfig,
  "Contacts.md": contacts,
  "Empty.md": "```#contact\n\n```\nAfter.\n",
};

function docText(page: Page): Promise<string> {
  return page.evaluate(() =>
    (globalThis as any).client.editorView.state.doc.toString(),
  );
}

function forms(page: Page) {
  return page.locator(".sb-data-block-preview .sb-fm-form");
}

function row(page: Page, index: number, key: string) {
  return forms(page).nth(index).locator(`.sb-fm-row[data-key="${key}"]`);
}

async function openContacts(page: Page, sbServer: SBServer) {
  await gotoSilverBulletPage(page, sbServer, "Contacts");
  await expect(forms(page)).toHaveCount(2);
}

test.describe("data block form", () => {
  test.use({ spaceFiles });

  test("/data inserts an empty data block with the cursor at its tag", async ({
    sbPage,
    sbServer,
  }) => {
    await openContacts(sbPage, sbServer);
    await sbPage
      .locator(".cm-line", { hasText: "Contacts body text." })
      .click();
    await sbPage.keyboard.press("End");
    await sbPage.keyboard.press("Enter");
    // The Std library's slash templates are defined once its pages are indexed
    await expect
      .poll(() =>
        sbPage.evaluate(() =>
          (
            globalThis as any
          ).client.clientSystem.slashCommandHook.slashCommands.some(
            (c: { name: string }) => c.name === "data",
          ),
        ),
      )
      .toBe(true);
    await sbPage.keyboard.type("/data");
    await sbPage
      .locator(".cm-tooltip-autocomplete li", {
        hasText: "Insert a data block",
      })
      .click();
    // The template inserts asynchronously
    await expect
      .poll(() => docText(sbPage))
      .toContain("Contacts body text.\n```#\n\n```");
    await sbPage.keyboard.type("contact");
    await expect
      .poll(() => docText(sbPage))
      .toContain("Contacts body text.\n```#contact\n\n```");
  });

  test("an empty block is a form; + add item adds the next one", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Empty");
    // The page opens with the cursor in the block, which shows its source
    await sbPage.locator(".cm-line", { hasText: "After." }).click();
    await expect(forms(sbPage)).toHaveCount(1);
    // The tag's schema rows, nothing written yet, and no item to add yet
    await expect(row(sbPage, 0, "email").locator("textarea")).toHaveValue("");
    await expect(forms(sbPage).locator(".sb-fm-add-item")).toHaveCount(0);
    await row(sbPage, 0, "email").locator("textarea").fill("ann@example.com");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toBe("```#contact\nemail: ann@example.com\n```\nAfter.\n");

    const written = "```#contact\nemail: ann@example.com\n```\nAfter.\n";
    await sbPage.locator(".cm-line", { hasText: "After." }).click();
    await forms(sbPage).nth(0).locator(".sb-fm-add-item").click();
    await expect(forms(sbPage)).toHaveCount(2);
    // Only the last item offers another, and only once it has something
    await expect(forms(sbPage).locator(".sb-fm-add-item")).toHaveCount(0);
    await expect(forms(sbPage).nth(1).locator(".sb-fm-add-attr")).toBeFocused();
    // Nothing is written for it yet; leaving it empty drops it
    expect(await docText(sbPage)).toBe(written);
    await sbPage.locator(".cm-line", { hasText: "After." }).click();
    await expect(forms(sbPage)).toHaveCount(1);
    expect(await docText(sbPage)).toBe(written);

    // A picked attribute's value goes in with the --- line
    await forms(sbPage).nth(0).locator(".sb-fm-add-item").click();
    await forms(sbPage).nth(1).locator(".sb-fm-add-attr").click();
    await expect(navInput(sbPage)).toBeVisible();
    await navInput(sbPage).fill("$ref");
    await expect(
      navFrame(sbPage).locator(".sb-nav-row .sb-nav-primary").first(),
    ).toHaveText("$ref");
    await sbPage.keyboard.press("Enter");
    await sbPage.keyboard.type("zef");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toBe(
        "```#contact\nemail: ann@example.com\n---\n$ref: zef\n```\nAfter.\n",
      );
  });

  test("the block's ⋮ deletes an item from its submenu, and the whole block", async ({
    sbPage,
    sbServer,
  }) => {
    await openContacts(sbPage, sbServer);
    const card = sbPage.locator(".sb-data-block-preview");
    // One submenu per item; Move and Delete for the whole block
    await openWidgetMenu(sbPage, card);
    const widgetMenu = sbPage.locator(".sb-widget-menu");
    await expect(
      widgetMenu.first().getByRole("menuitem").filter({ hasText: /\S/ }),
    ).toHaveText(["Move up", "Move down", "Delete", "Item 1", "Item 2"]);
    await widgetMenu.first().getByRole("menuitem", { name: "Item 2" }).click();
    await widgetMenu.nth(1).getByRole("menuitem", { name: "Delete" }).click();
    await expect
      .poll(() => docText(sbPage))
      .toBe(contacts.replace("---\nname: Bob\nemail: bob@example.com\n", ""));
    await expect(forms(sbPage)).toHaveCount(1);
    // One item left: its menu in place, the block's Delete
    await openWidgetMenu(sbPage, card);
    await expect(
      widgetMenu.getByRole("menuitem").filter({ hasText: /\S/ }),
    ).toHaveText([
      "Go to definition",
      "Edit source",
      "Move up",
      "Move down",
      "Delete",
    ]);
    await widgetMenu.getByRole("menuitem", { name: "Delete" }).click();
    await expect
      .poll(() => docText(sbPage))
      .toBe("# Contacts\n\nContacts body text.\n");
    await expect(forms(sbPage)).toHaveCount(0);
  });

  test("+ add attribute offers $ref", async ({ sbPage, sbServer }) => {
    await openContacts(sbPage, sbServer);
    await forms(sbPage)
      .nth(1)
      .locator(".sb-fm-add-attr", { hasText: "add attribute" })
      .click();
    await expect(navInput(sbPage)).toBeVisible();
    await navInput(sbPage).fill("$ref");
    await expect(
      navFrame(sbPage).locator(".sb-nav-row .sb-nav-primary").first(),
    ).toHaveText("$ref");
    await sbPage.keyboard.press("Enter");
    await sbPage.keyboard.type("bob");
    await sbPage.keyboard.press("Enter");
    await expect.poll(() => docText(sbPage)).toContain("$ref: bob\n```");
  });

  test("renders one form per document, with the tag's schema", async ({
    sbPage,
    sbServer,
  }) => {
    await openContacts(sbPage, sbServer);
    await expect(row(sbPage, 0, "name").locator("textarea")).toHaveValue(
      "Alice",
    );
    await expect(row(sbPage, 0, "role").locator("select")).toHaveValue(
      "Engineer",
    );
    await expect(row(sbPage, 1, "email").locator("textarea")).toHaveValue(
      "bob@example.com",
    );
    // The tag's absent property is offered faintly
    await expect(row(sbPage, 1, "role")).toHaveClass(/sb-fm-missing/);
  });

  test("editing the second document writes only that document, and undo restores it", async ({
    sbPage,
    sbServer,
  }) => {
    await openContacts(sbPage, sbServer);
    const email = row(sbPage, 1, "email").locator("textarea");
    await email.fill("bob@example.org");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toBe(contacts.replace("bob@example.com", "bob@example.org"));

    await sbPage
      .locator(".cm-line", { hasText: "Contacts body text." })
      .click();
    await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toBe(contacts);
  });

  test("after an edit shifts the second document, the next edit still finds it", async ({
    sbPage,
    sbServer,
  }) => {
    await openContacts(sbPage, sbServer);
    // Engineer → Manager is one character shorter, so Bob moves up
    await row(sbPage, 0, "role").locator("select").selectOption("Manager");
    await expect.poll(() => docText(sbPage)).toContain("role: Manager\n");
    await row(sbPage, 1, "role").locator("select").selectOption("Designer");
    await expect
      .poll(() => docText(sbPage))
      .toBe(
        contacts
          .replace("role: Engineer", "role: Manager")
          .replace(
            "email: bob@example.com\n",
            "email: bob@example.com\nrole: Designer\n",
          ),
      );
  });

  test("the row menu moves a key within its own document", async ({
    sbPage,
    sbServer,
  }) => {
    await openContacts(sbPage, sbServer);
    await row(sbPage, 1, "email").locator(".sb-fm-key").hover();
    await row(sbPage, 1, "email").locator(".sb-in-more").click();
    await row(sbPage, 1, "email")
      .locator(".sb-in-menu .sb-in-option", { hasText: "Move up" })
      .click();
    await expect
      .poll(() => docText(sbPage))
      .toBe(
        contacts.replace(
          "name: Bob\nemail: bob@example.com",
          "email: bob@example.com\nname: Bob",
        ),
      );
  });

  test("Esc in a field jumps to its line in the source", async ({
    sbPage,
    sbServer,
  }) => {
    await openContacts(sbPage, sbServer);
    await row(sbPage, 1, "email").locator("textarea").focus();
    await sbPage.keyboard.press("Escape");
    await expect(forms(sbPage)).toHaveCount(0);
    const head = await sbPage.evaluate(
      () => (globalThis as any).client.editorView.state.selection.main.head,
    );
    expect(head).toBe(contacts.indexOf("bob@example.com"));
  });
});

test.describe("data block form setting", () => {
  test.use({
    spaceFiles: {
      ...spaceFiles,
      "Library/Config.md": `${tagsConfig}
\`\`\`space-lua
config.set("liveEdit", { dataBlocks = false })
tag.define {
  name = "vendor",
  renderDataBlock = function(vendor)
    return widget.htmlBlock(dom.div { class = "fixture-vendor", vendor.name })
  end,
}
\`\`\`
`,
      "Contacts.md": `${contacts}
\`\`\`#vendor
name: Acme
\`\`\`
`,
    },
  });

  test("turning liveEdit.dataBlocks off restores the YAML, but not a tag's own renderer", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Contacts");
    await expect(sbPage.locator(".fixture-vendor")).toHaveText("Acme");
    await expect(
      sbPage.locator(".cm-line", { hasText: "email: bob@example.com" }),
    ).toBeVisible();
    await expect(forms(sbPage)).toHaveCount(0);
  });
});
