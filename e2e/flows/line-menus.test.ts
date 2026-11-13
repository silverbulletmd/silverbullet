import type { Page } from "@playwright/test";
import {
  docLines,
  docText,
  expectLineHandleOn,
  lineHandle,
  lineMenuItem,
  lineMenus,
  openLineMenu,
  openWidgetMenu,
  widgetHandle,
} from "../fixtures/actions.ts";
import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

// The line handle's menu fits the line (spec addendum 2026-11-12, phase 1)
const spaceFiles = {
  "index.md": "Welcome",
  "Notes/Doc.md":
    "Intro\n\n## Section\n\nSome paragraph text.\n\n- [ ] a task\n- plain item\n",
};

// Hovers line `line` (every line of the page is drawn as its own .cm-line)
async function openMenuOnLine(page: Page, line: number) {
  await page
    .locator(".cm-line")
    .nth(line - 1)
    .hover();
  await expectLineHandleOn(page, line);
  await lineHandle(page).click();
  await expect(lineMenus(page)).toHaveCount(1);
}

/**
 * Waits for the Std library's slash commands (a blank line's blocks), defined
 * once its Space Lua and pages are loaded
 */
async function waitForBlocks(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as any
        ).client.clientSystem.slashCommandHook.slashCommands.some(
          (c: { name: string }) => c.name === "warning-admonition",
        ),
      ),
    )
    .toBe(true);
}

test.describe("context-aware line menus", () => {
  test.use({ spaceFiles });

  test("a heading's Heading menu ticks its level; picking Heading 3 changes it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Doc");
    await openLineMenu(sbPage, "Section", 3);
    await expect(lineMenuItem(sbPage, "Collapse")).toBeVisible();
    await expect(lineMenuItem(sbPage, "Turn into")).toHaveCount(0);
    const row = lineMenuItem(sbPage, "Heading");
    await expect(row).toHaveAttribute("aria-haspopup", "menu");
    await row.hover();
    await expect(lineMenus(sbPage)).toHaveCount(2);
    await expect(lineMenuItem(sbPage, "Heading 2", 1)).toHaveClass(
      /sb-dock-menu-current/,
    );
    await expect(lineMenuItem(sbPage, "Heading 3", 1)).not.toHaveClass(
      /sb-dock-menu-current/,
    );
    await expect(lineMenuItem(sbPage, "Normal text", 1)).toBeVisible();
    await lineMenuItem(sbPage, "Heading 3", 1).click();
    await expect
      .poll(async () => (await docLines(sbPage))[2])
      .toBe("### Section");
    await expect(lineMenus(sbPage)).toHaveCount(0);
  });

  test("the submenu opens and closes from the keyboard", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Doc");
    await openLineMenu(sbPage, "Some paragraph text.", 5);
    const row = lineMenuItem(sbPage, "Turn into heading");
    await expect(row).toBeFocused();
    await sbPage.keyboard.press("ArrowRight");
    await expect(lineMenuItem(sbPage, "Heading 1", 1)).toBeFocused();
    await sbPage.keyboard.press("ArrowLeft");
    await expect(lineMenus(sbPage)).toHaveCount(1);
    await expect(row).toBeFocused();
    await sbPage.keyboard.press("Enter");
    await sbPage.keyboard.press("ArrowDown");
    await expect(lineMenuItem(sbPage, "Heading 2", 1)).toBeFocused();
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(async () => (await docLines(sbPage))[4])
      .toBe("## Some paragraph text.");
  });

  test("a task's Set state submenu lists the states and sets one", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Doc");
    await openLineMenu(sbPage, "a task", 7);
    await expect(lineMenuItem(sbPage, "Indent")).toBeVisible();
    await lineMenuItem(sbPage, "Set state").hover();
    await expect(lineMenuItem(sbPage, "Not done", 1)).toHaveClass(
      /sb-dock-menu-current/,
    );
    await expect(lineMenuItem(sbPage, "Done", 1)).toBeVisible();
    await lineMenuItem(sbPage, "Done", 1).click();
    await expect
      .poll(async () => (await docLines(sbPage))[6])
      .toBe("- [x] a task");
    // A plain item has no Set state
    await openLineMenu(sbPage, "plain item", 8);
    await expect(lineMenuItem(sbPage, "Set state")).toHaveCount(0);
    await expect(lineMenuItem(sbPage, "Turn into task")).toBeVisible();
  });

  test("Delete removes a text line's block: a paragraph, then a list item", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Doc");
    await openLineMenu(sbPage, "Some paragraph text.", 5);
    await lineMenuItem(sbPage, "Delete").click();
    await expect
      .poll(() => docText(sbPage))
      .toBe("Intro\n\n## Section\n\n- [ ] a task\n- plain item\n");
    await openLineMenu(sbPage, "a task", 5);
    await lineMenuItem(sbPage, "Delete").click();
    await expect
      .poll(() => docText(sbPage))
      .toBe("Intro\n\n## Section\n\n- plain item\n");
  });

  test("a blank line lists the slash menu's blocks, one submenu per group", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Doc");
    await waitForBlocks(sbPage);
    // A paragraph keeps Upload file, without the blocks
    await openLineMenu(sbPage, "Some paragraph text.", 5);
    await expect(lineMenuItem(sbPage, "Upload file")).toBeVisible();
    await expect(lineMenuItem(sbPage, "Basic blocks")).toHaveCount(0);
    await sbPage.keyboard.press("Escape");

    await openMenuOnLine(sbPage, 4);
    const rows = lineMenus(sbPage).nth(0).getByRole("menuitem");
    await expect(rows).toHaveText([
      "Basic blocks",
      "Lists",
      "Callouts",
      "Media",
      "Insert",
      "Dates",
      "Advanced",
    ]);
    for (const row of await rows.all()) {
      await expect(row).toHaveAttribute("aria-haspopup", "menu");
    }
    await expect(lineMenuItem(sbPage, "Insert…")).toHaveCount(0);
    await expect(lineMenuItem(sbPage, "Turn into")).toHaveCount(0);
    // The groups hold the slash menu's entries, by their display names
    await lineMenuItem(sbPage, "Media").hover();
    await expect(lineMenus(sbPage).nth(1).getByRole("menuitem")).toHaveText([
      "Image or file",
      "Embed page",
    ]);
    await lineMenuItem(sbPage, "Basic blocks").hover();
    await expect(lineMenuItem(sbPage, "Heading 4", 1)).toBeVisible();
    await expect(lineMenuItem(sbPage, "Divider", 1)).toBeVisible();
    await lineMenuItem(sbPage, "Heading 1", 1).click();
    await expect.poll(async () => (await docLines(sbPage))[3]).toBe("# ");
    await expect(lineMenus(sbPage)).toHaveCount(0);
    await expect(sbPage.locator(".cm-content")).toBeFocused();
  });

  test("Escape after a click hands focus back to the editor and frees the handle; from the keyboard it stays on the handle", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Doc");
    await openLineMenu(sbPage, "Some paragraph text.", 5);
    await sbPage.keyboard.press("Escape");
    await expect(lineMenus(sbPage)).toHaveCount(0);
    await expect(sbPage.locator(".cm-content")).toBeFocused();
    // Not pinned: it follows the pointer to another line
    await sbPage.locator(".cm-line", { hasText: "Intro" }).hover();
    await expectLineHandleOn(sbPage, 1);

    // Opened from the keyboard on the focused handle
    await lineHandle(sbPage).focus();
    await sbPage.keyboard.press("Enter");
    await expect(lineMenus(sbPage)).toHaveCount(1);
    await sbPage.keyboard.press("Escape");
    await expect(lineMenus(sbPage)).toHaveCount(0);
    await expect(lineHandle(sbPage)).toBeFocused();
    await sbPage.keyboard.press("Enter");
    await expect(lineMenus(sbPage)).toHaveCount(1);
    // Arrows stay in the menu: the caret doesn't move, the menu stays open
    const head = () =>
      sbPage.evaluate(
        () => (globalThis as any).client.editorView.state.selection.main.head,
      );
    const before = await head();
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      await sbPage.keyboard.press(key);
    }
    await expect(lineMenus(sbPage)).toHaveCount(1);
    expect(await head()).toBe(before);
  });
});

// One block-actions menu for a `${…}` of its own (decision 2026-11-12): the ⋮
// on its first line while its source is edited, the widget's ⋯ once rendered
test.describe("a ${…} block's actions menu", () => {
  const query = '${query[[\n  from p = index.tag "page"\n  limit 2\n]]}';
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Notes/Query.md": `Intro para.\n\n${query}\n\nNext para.\n\nLast.\n`,
    },
  });

  test("the ⋮ shows on its first line only, with the editing items; Move down, Show result, then the ⋯ moves and deletes it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Query");
    // The cursor in the expression: its source shows
    await sbPage.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      const pos = view.state.doc.toString().indexOf("from p");
      view.focus();
      view.dispatch({ selection: { anchor: pos } });
    });
    await expect(sbPage.locator(".sb-lua-directive-block")).toHaveCount(0);

    // Its inner lines have no handle
    await sbPage.locator(".cm-line", { hasText: "Intro para." }).hover();
    await expectLineHandleOn(sbPage, 1);
    await sbPage.locator(".cm-line", { hasText: "limit 2" }).hover();
    await expect(lineHandle(sbPage)).not.toHaveClass(/sb-line-handle-shown/);

    await openLineMenu(sbPage, "${query[[", 3);
    const labels = await lineMenus(sbPage)
      .getByRole("menuitem")
      .allTextContents();
    expect(labels.map((l) => l.trim())).toEqual([
      "Show result",
      "Edit in query builder",
      "Bake into page",
      "Move up",
      "Move down",
      "Delete",
    ]);
    await lineMenuItem(sbPage, "Move down").click();
    await expect
      .poll(async () => (await docLines(sbPage)).slice(0, 5))
      .toEqual(["Intro para.", "", "Next para.", "", "${query[["]);
    // Still being edited
    await expect(sbPage.locator(".sb-lua-directive-block")).toHaveCount(0);

    await openLineMenu(sbPage, "${query[[", 5);
    await lineMenuItem(sbPage, "Show result").click();
    const widget = sbPage.locator(".sb-lua-directive-block").first();
    await expect(widget).toBeVisible();

    // Rendered, on desktop: no ⋯; the ⋮ beside its card has the same
    // actions, with Edit source and Copy
    await expect(widget.locator('button[data-button="menu"]')).toHaveCount(0);
    await openWidgetMenu(sbPage, widget);
    const widgetMenu = sbPage.locator(".sb-widget-menu");
    const rendered = (
      await widgetMenu.getByRole("menuitem").allTextContents()
    ).map((l) => l.trim());
    expect(rendered).toEqual([
      "Edit source",
      "Edit in query builder",
      "Bake into page",
      "Copy as Markdown",
      "Move up",
      "Move down",
      "Delete",
    ]);
    expect(rendered).not.toContain("Reload");
    await widgetMenu.getByRole("menuitem", { name: "Delete" }).click();
    await expect
      .poll(async () => (await docLines(sbPage)).join("\n"))
      .toBe("Intro para.\n\nNext para.\n\nLast.\n");
  });
});

test.describe("widget menus behind the ⋮ on desktop", () => {
  const table = "| a | b |\n|---|---|\n| 1 | 2 |";
  const baked = "<!--#lua 1 + 1 -->\n2\n<!--/lua-->";
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Notes/Widgets.md": `Intro para.\n\n${table}\n\nSum is \${1 + 1} here.\n\n${baked}\n\nLast.\n`,
    },
  });

  async function labelsOf(page: Page) {
    return (
      await page
        .locator(".sb-widget-menu")
        .first()
        .getByRole("menuitem")
        .allTextContents()
    ).map((l) => l.trim());
  }

  test("a rendered table's ⋮ edits, copies, moves and deletes it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Widgets");
    const card = sbPage.locator(".sb-table-widget");
    await expect(card.locator("table")).toBeVisible();
    await openWidgetMenu(sbPage, card);
    expect(await labelsOf(sbPage)).toEqual([
      "Edit source",
      "Copy as Markdown",
      "Move up",
      "Move down",
      "Delete",
    ]);
    await lineMenuItem(sbPage, "Move up").click();
    await expect
      .poll(async () => (await docLines(sbPage)).slice(0, 5))
      .toEqual(["| a | b |", "|---|---|", "| 1 | 2 |", "", "Intro para."]);
  });

  test("a baked section's ⋮ has its actions and moves it whole; it has no ⋯", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Widgets");
    const header = sbPage.locator(".sb-baked-header");
    await expect(header).toBeVisible();
    await expect(header.locator("button")).toHaveCount(0);
    await openWidgetMenu(sbPage, header);
    expect(await labelsOf(sbPage)).toEqual([
      "Update",
      "Edit expression",
      "Copy as Markdown",
      "Unbake",
      "Move up",
      "Move down",
      "Delete",
    ]);
    await lineMenuItem(sbPage, "Move down").click();
    await expect
      .poll(async () => (await docLines(sbPage)).slice(-6))
      .toEqual(["Last.", "", "<!--#lua 1 + 1 -->", "2", "<!--/lua-->", ""]);
  });
});

test.describe("widget menus on mobile", () => {
  // Firefox can't emulate a phone (`isMobile`): the context itself fails
  test.skip(
    ({ browserName }) => browserName === "firefox",
    "no mobile emulation",
  );
  test.use({
    viewport: { width: 393, height: 851 },
    hasTouch: true,
    isMobile: true,
    spaceFiles: {
      "index.md": "Welcome",
      "Notes/Query.md":
        'Intro para.\n\n${query[[\n  from p = index.tag "page"\n  limit 2\n]]}\n\nLast.\n',
    },
  });

  test("a rendered ${…} keeps its ⋯, with the same menu; no ⋮", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Query");
    expect(
      await sbPage.evaluate(
        () => (globalThis as any).client.ui.viewState.isMobile,
      ),
    ).toBe(true);
    const widget = sbPage.locator(".sb-lua-directive-block").first();
    await expect(widget).toBeVisible();
    const button = widget.locator('button[data-button="menu"]');
    await button.click();
    const labels = (
      await sbPage
        .locator(".sb-widget-menu")
        .getByRole("menuitem")
        .allTextContents()
    ).map((l) => l.trim());
    expect(labels).toEqual([
      "Edit source",
      "Edit in query builder",
      "Bake into page",
      "Copy as Markdown",
      "Move up",
      "Move down",
      "Delete",
    ]);
    await expect(widgetHandle(sbPage)).toHaveCount(0);
  });
});
