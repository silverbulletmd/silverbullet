import type { Page } from "@playwright/test";
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
  "CONFIG.md": tagsConfig,
  "Contacts.md": contacts,
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
      "CONFIG.md": `${tagsConfig}
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
