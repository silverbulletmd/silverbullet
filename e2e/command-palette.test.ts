import { expect, mod, test } from "./fixtures.ts";
import { navInput, navRows, openPicker } from "./navigator-ui.ts";

test.describe("Command palette", () => {
  test("open and close command palette", async ({ sbPage }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    await expect(editor).toContainText("Welcome");

    // Open command palette
    await openPicker(sbPage, `${mod}+/`, "Command");
    await expect(sbPage.locator(".sb-modal")).toBeVisible();

    // Close with Escape
    await sbPage.keyboard.press("Escape");
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
  });

  test("filter commands by typing", async ({ sbPage }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    await expect(editor).toContainText("Welcome");

    // Open command palette
    const frame = await openPicker(sbPage, `${mod}+/`, "Command");

    // Type to filter
    await navInput(sbPage).fill("Stats");

    // Should show filtered results including "Stats: Show". Row *names*: a
    // row's text also carries its description and key-hint chip.
    await expect(
      navRows(frame).filter({ hasText: "Stats" }).first(),
    ).toBeVisible({ timeout: 20_000 });

    await sbPage.keyboard.press("Escape");
  });

  test("run a command from the palette", async ({ sbPage }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    await expect(editor).toContainText("Welcome");

    // Open command palette and run "Stats: Show"
    const frame = await openPicker(sbPage, `${mod}+/`, "Command");
    await navInput(sbPage).fill("Stats: Show");
    await expect(navRows(frame).first()).toHaveText("Stats: Show", {
      timeout: 20_000,
    });

    // Select the matching command
    await sbPage.keyboard.press("Enter");

    // The palette should close
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
  });
});
