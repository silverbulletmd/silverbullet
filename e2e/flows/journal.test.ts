import { existsSync } from "node:fs";
import { join } from "node:path";
import { currentPage, runCommandViaPalette } from "../fixtures/actions.ts";
import { expect, test, waitForPersistedContent } from "../fixtures/core.ts";

function today(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Asserts on the raw YAML, so the frontmatter form is turned off. Seeded as a
// legacy root CONFIG.md, which the server moves to Library/Config.md on start
test.use({
  spaceFiles: {
    "index.md": "# Welcome\n",
    "CONFIG.md":
      '```space-lua\ntag.define { name = "page", renderFrontmatter = config.unset }\n```\n',
  },
});

test("today's journal starts from the template and saves an entry", async ({
  sbPage,
  sbServer,
}) => {
  expect(existsSync(join(sbServer.spaceDir, "CONFIG.md"))).toBe(false);
  expect(existsSync(join(sbServer.spaceDir, "Library", "Config.md"))).toBe(
    true,
  );
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
