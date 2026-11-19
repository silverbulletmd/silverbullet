import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

const conceptIndex = `# Concepts

\${template.each(query[[
  from p = tags.concept
  order by p.name
]], templates.pageItem)}
`;

test.use({
  spaceFiles: {
    "Draft.md": "# Draft\n",
    "Topic.md": "# Topic\n\nA topic page.\n",
    "Concepts.md": conceptIndex,
    "Widgets.md": [
      "Intro.",
      "",
      "| item | action |",
      "|---|---|",
      '| one | ${widgets.button("Cell", function() editor.flashNotification("cell clicked") end)} |',
      "",
      "Bold **${1+1}** here.",
      "",
      "![[Nested]]",
      "",
    ].join("\n"),
    "Nested.md":
      "${widget.markdown(\"deep ${widgets.button('Deep', function() editor.flashNotification('deep clicked') end)}\")}\n",
  },
});

test("editing a tagged, linked note updates queries and backlinks", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Draft");
  await page.evaluate(() => {
    const view = (globalThis as any).client.editorView;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  });
  await page.keyboard.insertText(
    "\n#concept\n\nResearch connects the idea to [[Topic]].\n",
  );
  await waitForPersistedContent(
    sbServer,
    "Draft.md",
    /#concept[\s\S]*\[\[Topic\]\]/,
  );

  await gotoSilverBulletPage(page, sbServer, "Concepts");
  await expect(page.locator("#sb-editor .cm-content")).toContainText("Draft", {
    timeout: 20_000,
  });

  await gotoSilverBulletPage(page, sbServer, "Topic");
  const topic = page.locator("#sb-editor .cm-content");
  await expect(topic).toContainText("Linked Mentions", { timeout: 20_000 });
  await expect(topic).toContainText("Research connects the idea");
});

test("widgets compose inside tables, transclusions and emphasis", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Widgets");
  const table = page.locator(".sb-table-widget");
  await table.locator("button", { hasText: "Cell" }).click();
  await expect(page.getByText("cell clicked")).toBeVisible();
  // Clicking the button must not drop the table into edit mode
  await expect(table).toBeVisible();
  await page.locator("button", { hasText: "Deep" }).click();
  await expect(page.getByText("deep clicked")).toBeVisible();
  await expect(
    page.locator(".sb-lua-wrapper strong", { hasText: "2" }),
  ).toBeVisible();
});
