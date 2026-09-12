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
