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

  const configText = (sbServer: { spaceDir: string }) =>
    readFile(join(sbServer.spaceDir, "Library", "Config.md"), "utf8").catch(
      () => "",
    );

  test("configuration tab saves options to Library/Config as they change", async ({
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
    await expect
      .poll(() => configText(sbServer))
      .toContain(
        `${MARKER}\n-- boot: true\nconfig.set("shortWikiLinks", false)`,
      );
    // A font choice applies and saves at once
    const editorFont = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue(
          "--editor-font",
        ),
      );
    await tab(page)
      .getByRole("combobox", { name: "Editor font" })
      .selectOption("inter");
    await expect.poll(editorFont).toContain("Inter");
    await expect
      .poll(() => configText(sbServer))
      .toContain('config.set("fonts.editor", "inter")');
    // A typed size previews while typed, and saves on Enter
    const editorSize = () =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector("#sb-editor .cm-editor")!)
            .fontSize,
      );
    await tab(page)
      .getByRole("spinbutton", { name: "Editor font size" })
      .fill("22");
    await expect.poll(editorSize).toBe("22px");
    expect(await configText(sbServer)).not.toContain("fonts.editorSize");
    await tab(page)
      .getByRole("spinbutton", { name: "Editor font size" })
      .press("Enter");
    await expect
      .poll(() => configText(sbServer))
      .toContain('config.set("fonts.editorSize", 22)');
    await expect(tab(page).getByRole("button", { name: /^Save/ })).toHaveCount(
      0,
    );

    await page.reload();
    await expect.poll(editorFont).toContain("Inter");
    await expect.poll(editorSize).toBe("22px");
  });

  test("a typed field saves when left, and Escape takes it back", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Configuration: Open");
    const editorSize = () =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector("#sb-editor .cm-editor")!)
            .fontSize,
      );
    const size = tab(page).getByRole("spinbutton", {
      name: "Editor font size",
    });
    const shown = await editorSize();
    await size.fill("24");
    await expect.poll(editorSize).toBe("24px");
    await size.press("Escape");
    await expect.poll(editorSize).toBe(shown);
    await expect(size).toHaveValue("");

    await size.fill("21");
    await tab(page).getByRole("searchbox", { name: "Filter options" }).click();
    await expect
      .poll(() => configText(sbServer))
      .toContain('config.set("fonts.editorSize", 21)');

    // A lone family name could be a missing font library's name, so it is
    // not used as is; the field says how to write it instead.
    await tab(page)
      .getByRole("combobox", { name: "Editor font" })
      .selectOption({ label: "Custom…" });
    await tab(page)
      .getByRole("textbox", { name: "Editor font, CSS font-family" })
      .fill("Georgia");
    await expect(tab(page).getByText("Add a fallback")).toBeVisible();
    await tab(page)
      .getByRole("textbox", { name: "Editor font, CSS font-family" })
      .fill("Georgia, serif");
    await expect(tab(page).getByText("Add a fallback")).toHaveCount(0);
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
    await expect
      .poll(() => configText(sbServer))
      .toContain('name = "Workbench: Toggle"');
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
    await expect
      .poll(() => configText(sbServer))
      .toMatch(/name = "Workbench: Toggle", key = "[^"]+", mac = ""/);
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
    await expect
      .poll(() => configText(sbServer))
      .toContain('name = "Workbench: Toggle", key = "", mac = ""');
    await waitForBinding(page, "");
    await page.keyboard.press("ControlOrMeta+Alt+j");
    await page.waitForTimeout(500);
    await expect(tab(page)).toBeVisible();
  });

  test.describe("with a broken managed block", () => {
    test.use({
      spaceFiles: {
        "index.md": "Welcome",
        "Library/Config.md": `\`\`\`space-lua\n${MARKER}\nconfig.set(\n\`\`\`\n`,
      },
    });

    test("managed block error keeps edits unsaved", async ({
      page,
      sbServer,
    }) => {
      await gotoSilverBulletPage(page, sbServer, "index");
      await runCommandViaPalette(page, "Configuration: Open");
      await expect(tab(page)).toContainText(
        "The managed configuration block in Library/Config is not valid Lua",
      );
      await shortWikiLinks(page).uncheck();
      await expect(tab(page)).toContainText(
        "1 change isn't saved; it will be once the block is fixed.",
      );
      expect(await configText(sbServer)).not.toContain("shortWikiLinks");
    });
  });
});

test.describe("data tab schemas", () => {
  // Made-up meetings, tagged without a schema
  test.use({
    spaceFiles: {
      "index.md": "Welcome\n",
      "Meetings/Kickoff.md":
        "---\ntags: meeting\ndate: 2026-10-02\nroom: Blue\n---\nAgenda.",
      "Meetings/Retro.md":
        "---\ntags: meeting\ndate: 2026-10-09\nroom: Green\n---\nNotes.",
    },
  });

  const config = (sbServer: { spaceDir: string }) =>
    readFile(join(sbServer.spaceDir, "Library", "Config.md"), "utf8").catch(
      () => "",
    );

  test("creates a schema from inferred attributes, extends page, and keeps unsaved Library/Config edits", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Workbench: Schema");
    const tags = page.getByRole("navigation", { name: "Tags" });
    await tags.getByRole("button", { name: /^meeting/ }).click();
    await page.getByRole("checkbox", { name: "Declare room" }).uncheck();
    await page.getByRole("button", { name: "Create schema" }).click();
    await expect
      .poll(() => config(sbServer))
      .toContain("-- managed-by: workbench-schemas");
    const text = await config(sbServer);
    expect(text).toContain('name = "meeting"');
    expect(text).toContain("date = schema.date()");
    expect(text).not.toContain("room =");
    await expect(
      tags.locator(".sb-wbd-group", { hasText: /^Defined/ }),
    ).toContainText("meeting");

    // Extending a built-in schema writes a targeted change
    await tags.getByRole("button", { name: /^page/ }).click();
    await page.getByRole("textbox", { name: "New attribute" }).fill("category");
    await page.getByRole("textbox", { name: "New attribute" }).press("Enter");
    await expect
      .poll(() => config(sbServer))
      .toMatch(
        /config\.set\(\{\s*"tags",\s*"page",\s*"schema",\s*"properties",\s*"category",?\s*\}/,
      );

    // An unsaved edit in the open Library/Config survives a save from the Workbench
    await gotoSilverBulletPage(page, sbServer, "Library/Config");
    await page.locator("#sb-editor .cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\nA note typed by hand.");
    await runCommandViaPalette(page, "Workbench: Schema");
    await tags.getByRole("button", { name: /^page/ }).click();
    await page.getByRole("textbox", { name: "New attribute" }).fill("rating");
    await page.getByRole("textbox", { name: "New attribute" }).press("Enter");
    await expect.poll(() => config(sbServer)).toContain('"rating"');
    expect(await config(sbServer)).toContain("A note typed by hand.");
  });
});
