import type { Page } from "@playwright/test";
import { docText, runCommandViaPalette } from "../fixtures/actions.ts";
import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

const spaceFiles = {
  "index.md": "Welcome",
  "Library/Config.md": [
    "# Config",
    "```space-lua",
    'config.set("vim", {',
    '  map = { { map = "jj", to = "<Esc>", mode = "insert" } },',
    "})",
    "```",
    "",
  ].join("\n"),
  "Notes/Groceries.md": "# Groceries\n- milk\n- eggs\nDelete me\nLast",
  "Notes/Garden.md": "Plant the tulip bulbs.",
};

function vimStatus(page: Page) {
  return page.locator(".cm-vim-panel");
}

async function turnOnVim(page: Page) {
  await runCommandViaPalette(page, "Editor: Toggle Vim Mode");
  await expect(vimStatus(page)).toHaveText(/NORMAL/);
  await expect(page.locator("#sb-editor .cm-content")).toBeFocused();
}

async function keys(page: Page, ...sequence: string[]) {
  for (const key of sequence) await page.keyboard.press(key);
}

test.describe("vim mode", () => {
  test.use({ spaceFiles });

  test("editing with vim keys is saved, and the mode is remembered per device", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Groceries");
    await turnOnVim(sbPage);

    // Normal-mode motions, an operator and undo
    await keys(sbPage, "g", "g", "j", "j", "j", "d", "d");
    await expect
      .poll(() => docText(sbPage))
      .toBe("# Groceries\n- milk\n- eggs\nLast");
    await keys(sbPage, "u");
    await expect.poll(() => docText(sbPage)).toContain("Delete me");
    await keys(sbPage, "d", "d");

    // `o` continues the list, and the space's `jj` insert mapping leaves
    // insert mode
    await keys(sbPage, "g", "g", "j", "o");
    await expect(vimStatus(sbPage)).toHaveText(/INSERT/);
    await sbPage.keyboard.type("bread");
    await keys(sbPage, "j", "j");
    await expect(vimStatus(sbPage)).toHaveText(/NORMAL/);

    // Enter in insert mode starts a new line
    await keys(sbPage, "Shift+G", "Shift+A", "Enter");
    await sbPage.keyboard.type("New");
    await keys(sbPage, "Escape");

    const expected = "# Groceries\n- milk\n- bread\n- eggs\nLast\nNew";
    await expect.poll(() => docText(sbPage)).toBe(expected);
    await waitForPersistedContent(sbServer, "Notes/Groceries.md", expected);

    await sbPage.reload();
    await expect(vimStatus(sbPage)).toHaveText(/NORMAL/);

    // Turned off, keys type text again
    await runCommandViaPalette(sbPage, "Editor: Toggle Vim Mode");
    await expect(vimStatus(sbPage)).toHaveCount(0);
    await sbPage.keyboard.type("x");
    await expect.poll(() => docText(sbPage)).toMatch(/x/);
  });

  test("a visual-mode selection gets the formatting bubble", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Garden");
    await turnOnVim(sbPage);
    const bubble = sbPage.getByRole("toolbar", { name: "Formatting" });

    await keys(sbPage, "g", "g", "w", "v", "e");
    await expect(vimStatus(sbPage)).toHaveText(/VISUAL/);
    await expect(bubble).toBeVisible();

    await bubble.getByRole("button", { name: "Bold" }).click();
    const expected = "Plant **the** tulip bulbs.";
    await expect.poll(() => docText(sbPage)).toBe(expected);
    await expect(sbPage.locator("#sb-editor .cm-content")).toBeFocused();

    // One Escape leaves visual mode and dismisses the bubble
    await keys(sbPage, "Escape");
    await expect(vimStatus(sbPage)).toHaveText(/NORMAL/);
    await expect(bubble).toHaveCount(0);
    await waitForPersistedContent(sbServer, "Notes/Garden.md", expected);
  });
});
