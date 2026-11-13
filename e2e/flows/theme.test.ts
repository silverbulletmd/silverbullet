import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommandViaPalette } from "../fixtures/actions.ts";
import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

const FIXTURE = "Library/Test/Themes/Fixture";

test.use({
  spaceFiles: {
    "index.md": "Welcome\n",
    [`${FIXTURE}.md`]: [
      "---",
      "tags: meta/theme",
      "displayName: Fixture Theme",
      "scheme: dark",
      "---",
      "```space-style",
      "html {",
      "  --root-background-color: rgb(1, 2, 3);",
      "}",
      "```",
      "",
    ].join("\n"),
  },
});

type Page = import("@playwright/test").Page;

test("a theme picked in Configuration applies, survives a reload, and yields to a device override", async ({
  page,
  sbServer,
}) => {
  const tab = (p: Page) =>
    p.locator(".sb-wb-tab:not([hidden]) .sb-wb-configuration");
  const themeSelect = (p: Page) =>
    tab(p).getByRole("combobox", { name: "Theme", exact: true });
  const html = (p: Page) =>
    p.evaluate(() => {
      const root = document.documentElement;
      return {
        theme: root.dataset.sbTheme,
        scheme: root.dataset.sbScheme,
        alias: root.dataset.theme,
        background: getComputedStyle(root)
          .getPropertyValue("--root-background-color")
          .trim(),
      };
    });

  await gotoSilverBulletPage(page, sbServer, "index");
  await runCommandViaPalette(page, "Configuration: Open");
  await themeSelect(page).selectOption({ label: "Fixture Theme" });
  await expect
    .poll(() => html(page))
    .toEqual({
      theme: FIXTURE,
      scheme: "dark",
      alias: "dark",
      background: "rgb(1, 2, 3)",
    });
  await tab(page).getByRole("button", { name: "Save and apply" }).click();
  await expect
    .poll(() =>
      readFile(join(sbServer.spaceDir, "Library", "Config.md"), "utf8").catch(
        () => "",
      ),
    )
    .toContain(`config.set("theme", "${FIXTURE}")`);

  await page.reload();
  await expect
    .poll(() => html(page))
    .toMatchObject({ theme: FIXTURE, background: "rgb(1, 2, 3)" });

  // A device override wins over the space setting, and says so.
  await runCommandViaPalette(page, "Theme: Select");
  await page
    .getByRole("dialog")
    .getByText("SilverBullet Light", { exact: true })
    .click();
  await expect
    .poll(() => html(page))
    .toMatchObject({
      theme: "Library/Std/Themes/SilverBullet Light",
      scheme: "light",
    });
  await runCommandViaPalette(page, "Configuration: Open");
  await expect(
    tab(page).getByText("This device uses SilverBullet Light"),
  ).toBeVisible();

  await tab(page).getByRole("button", { name: "Use space default" }).click();
  await expect
    .poll(() => html(page))
    .toMatchObject({ theme: FIXTURE, background: "rgb(1, 2, 3)" });
  await expect(tab(page).getByText("This device uses")).toHaveCount(0);
});
