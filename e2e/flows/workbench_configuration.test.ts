import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommandViaPalette } from "../fixtures/actions.ts";
import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

test.use({
  spaceFiles: {
    "index.md": "Welcome\n",
  },
});

type Page = import("@playwright/test").Page;

test.describe("configuration tab", () => {
  const MARKER = "-- managed-by: configuration-manager";
  const tab = (page: Page) =>
    page.locator(".sb-wb-tab:not([hidden]) .sb-wb-configuration");
  const shortWikiLinks = (page: Page) =>
    tab(page).getByRole("checkbox", { name: "Short wiki links" });

  test("configuration tab saves an option to CONFIG", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Configuration: Open");
    await expect(
      tab(page).getByRole("navigation", { name: "Configuration sections" }),
    ).toBeVisible();
    await expect(shortWikiLinks(page)).toBeChecked();
    await shortWikiLinks(page).uncheck();
    await tab(page).getByRole("button", { name: "Save and apply" }).click();
    await expect
      .poll(() =>
        readFile(join(sbServer.spaceDir, "CONFIG.md"), "utf8").catch(() => ""),
      )
      .toContain(`${MARKER}\nconfig.set("shortWikiLinks", false)`);
    await expect(
      tab(page).getByRole("button", { name: "Save and apply" }),
    ).toHaveCount(0);
  });

  test("unsaved configuration edits survive closing the workbench", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Configuration: Open");
    await shortWikiLinks(page).uncheck();
    await runCommandViaPalette(page, "Workbench: Toggle");
    await expect(tab(page)).toHaveCount(0);
    await runCommandViaPalette(page, "Workbench: Configuration");
    await expect(shortWikiLinks(page)).not.toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Configuration, •" }),
    ).toBeVisible();
  });

  const bindingRow = (page: Page, name: string) =>
    tab(page).getByRole("group", { name, exact: true });

  async function showBinding(page: Page, name: string) {
    await runCommandViaPalette(page, "Configuration: Keyboard Shortcuts");
    await tab(page)
      .getByRole("searchbox", { name: "Filter commands" })
      .fill(name);
    return bindingRow(page, name);
  }

  async function startRecording(page: Page, name: string) {
    const row = await showBinding(page, name);
    await row
      .getByRole("button", { name: /^Record/ })
      .first()
      .click();
    await expect(row.getByText("Press keys…")).toBeVisible();
    return row;
  }

  test("recording a global shortcut records it", async ({ page, sbServer }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    const row = await startRecording(page, "Workbench: Toggle");
    // Bound to the page picker: recorded (and refused), never run
    await page.keyboard.press("ControlOrMeta+k");
    await expect(row).toContainText(/already bound to/i);
    await expect(page.locator(".sb-modal")).toHaveCount(0);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("ControlOrMeta+Alt+Shift+u");
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("data-modified", "true");
    await expect(row.getByText("Press keys…")).toHaveCount(0);
    await expect(
      page.getByRole("radio", { name: "Configuration, •" }),
    ).toBeVisible();
  });

  test("escape cancels recording without closing the workbench", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    const row = await showBinding(page, "Workbench: Toggle");
    const before = await row.locator(".sb-wb-cfg-chords").textContent();
    await row
      .getByRole("button", { name: /^Record/ })
      .first()
      .click();
    await expect(row.getByText("Press keys…")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row.getByText("Press keys…")).toHaveCount(0);
    await expect(tab(page)).toBeVisible();
    await expect(row.locator(".sb-wb-cfg-chords")).toHaveText(before!);
    await expect(row).not.toHaveAttribute("data-modified", "true");
  });

  test("switching tabs cancels recording", async ({ page, sbServer }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    const row = await startRecording(page, "Workbench: Toggle");
    await page.getByRole("radio", { name: "Console" }).click();
    await page.getByRole("radio", { name: /^Configuration/ }).click();
    await expect(row.getByText("Press keys…")).toHaveCount(0);
  });

  test("clicking into the editor cancels recording", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    const row = await startRecording(page, "Workbench: Toggle");
    await page.locator("#sb-editor .cm-content").click();
    await expect(row.getByText("Press keys…")).toHaveCount(0);
    await page.keyboard.type("zq");
    await expect(page.locator("#sb-editor .cm-content")).toContainText("zq");
  });

  test("focus returns to the binding after recording", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    const row = await startRecording(page, "Workbench: Toggle");
    await page.keyboard.press("Escape");
    await expect(
      row.getByRole("button", { name: /^Record a new binding/ }).first(),
    ).toBeFocused();
    await expect(tab(page)).toBeVisible();
  });

  test("a duplicate chord is refused", async ({ page, sbServer }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    const row = await startRecording(page, "Workbench: Toggle");
    // Navigate: Page Picker's binding
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.press("Enter");
    await expect(row).toContainText(/already bound to/i);
    await page.keyboard.press("Escape");
    await expect(row).not.toHaveAttribute("data-modified", "true");
  });

  // The editor's keymap is rebuilt just after the save settles: wait for the
  // new definition, then a moment for the keymap to follow
  async function waitForBinding(page: Page, mac: string) {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (globalThis as any).client.clientSystem.commandHook
              .buildAllCommands()
              .get("Workbench: Toggle").mac,
        ),
      )
      .toBe(mac);
    await page.waitForTimeout(300);
  }

  // silverbulletmd/silverbullet#2178: Workbench: Toggle ships `mac`
  // "Cmd-Alt-j"; a portable override must replace it on macOS too
  test("a recorded binding replaces the built-in one once saved", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await startRecording(page, "Workbench: Toggle");
    await page.keyboard.press("ControlOrMeta+Alt+Shift+u");
    await page.keyboard.press("Enter");
    await tab(page).getByRole("button", { name: "Save and apply" }).click();
    await expect
      .poll(() =>
        readFile(join(sbServer.spaceDir, "CONFIG.md"), "utf8").catch(() => ""),
      )
      .toMatch(/name = "Workbench: Toggle", key = "[^"]+", mac = ""/);
    await expect(
      tab(page).getByRole("button", { name: "Save and apply" }),
    ).toHaveCount(0);
    await waitForBinding(page, "");
    // The old chord no longer closes the Workbench...
    await page.keyboard.press("ControlOrMeta+Alt+j");
    await page.waitForTimeout(500);
    await expect(tab(page)).toBeVisible();
    // ...the new one does
    await page.keyboard.press("ControlOrMeta+Alt+Shift+u");
    await expect(tab(page)).toHaveCount(0);
  });

  test("a removed binding stops firing once saved", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    const row = await showBinding(page, "Workbench: Toggle");
    await row.hover();
    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Remove binding" }).click();
    await tab(page).getByRole("button", { name: "Save and apply" }).click();
    await expect
      .poll(() =>
        readFile(join(sbServer.spaceDir, "CONFIG.md"), "utf8").catch(() => ""),
      )
      .toContain('name = "Workbench: Toggle", key = "", mac = ""');
    await expect(
      tab(page).getByRole("button", { name: "Save and apply" }),
    ).toHaveCount(0);
    await waitForBinding(page, "");
    await page.keyboard.press("ControlOrMeta+Alt+j");
    await page.waitForTimeout(500);
    await expect(tab(page)).toBeVisible();
  });

  test.describe("with a broken managed block", () => {
    test.use({
      spaceFiles: {
        "index.md": "Welcome",
        "CONFIG.md": `\`\`\`space-lua\n${MARKER}\nconfig.set(\n\`\`\`\n`,
      },
    });

    test("managed block error blocks saving", async ({ page, sbServer }) => {
      await gotoSilverBulletPage(page, sbServer, "index");
      await runCommandViaPalette(page, "Configuration: Open");
      await expect(tab(page)).toContainText(
        "The managed configuration block in CONFIG is not valid Lua",
      );
      await shortWikiLinks(page).uncheck();
      await expect(
        tab(page).getByRole("button", { name: "Save and apply" }),
      ).toHaveCount(0);
    });
  });
});
