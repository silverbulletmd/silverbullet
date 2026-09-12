import { currentPage, runCommandViaPalette } from "../fixtures/actions.ts";
import { expect, test, waitForPersistedContent } from "../fixtures/core.ts";

function today(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test.use({ spaceFiles: { "index.md": "# Welcome\n" } });

test("today's journal starts from the template and saves an entry", async ({
  sbPage,
  sbServer,
}) => {
  await runCommandViaPalette(sbPage, "Journal: Today");
  const pageName = `Journal/${today()}`;
  await expect(currentPage(sbPage)).toHaveValue(pageName);
  const editor = sbPage.locator("#sb-editor .cm-content");
  await expect(editor).toContainText("tags: journal");

  await editor.click();
  await sbPage.keyboard.insertText("Outlined tomorrow's priorities.");
  await waitForPersistedContent(
    sbServer,
    `${pageName}.md`,
    /tags: journal[\s\S]*Outlined tomorrow's priorities\./,
  );
});
