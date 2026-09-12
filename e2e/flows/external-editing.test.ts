import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expect,
  mod,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

test.use({ spaceFiles: { "index.md": "Original notebook.\n" } });

test("an external disk edit appears in the open editor and can be undone", async ({
  sbPage: page,
  sbServer,
}) => {
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("Original notebook.");
  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "Original notebook.\nExternal paragraph.\n",
  );
  await expect(editor).toContainText("External paragraph.");
  await editor.click();
  await page.keyboard.press(`${mod}+z`);
  await expect(editor).not.toContainText("External paragraph.");
  await waitForPersistedContent(sbServer, "index.md", "Original notebook.\n");
});
