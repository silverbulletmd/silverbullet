import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

const initialRust = [
  "fn main() {",
  '    let message = "ready";',
  '    println!("{message}");',
  "}",
].join("\n");
const savedRust = `${initialRust}\n// Saved from the document editor.\n`;

test.use({
  spaceFiles: {
    "index.md": "Document examples",
    "Return.md": "A Markdown page between document visits.\n",
    "Source/sample.rs": initialRust,
  },
});

test("a source document can be highlighted, edited, saved, and reopened", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Source/sample.rs");

  const editor = page.locator("#sb-editor .cm-content");
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('let message = "ready";');
  await expect(editor.locator(".sb-keyword", { hasText: "fn" })).toBeVisible();

  await page.evaluate(() => {
    const view = (globalThis as any).client.editorView;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  });
  await page.keyboard.insertText("\n// Saved from the document editor.\n");
  await waitForPersistedContent(sbServer, "Source/sample.rs", savedRust);

  await gotoSilverBulletPage(page, sbServer, "Return");
  await expect(editor).toContainText(
    "A Markdown page between document visits.",
  );
  await gotoSilverBulletPage(page, sbServer, "Source/sample.rs");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as any).client.editorView.state.doc.toString(),
      ),
    )
    .toBe(savedRust);
});
