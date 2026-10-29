import type { Page } from "@playwright/test";
import { expect, gotoSilverBulletPage, mod, test } from "../fixtures/core.ts";

const plain = "# Plain\nBody text.\n";

const spaceFiles = {
  "index.md": "Welcome",
  "Notes/Plain.md": plain,
  "Notes/Tagged.md": "---\nstatus: active\n---\nTagged body.\n",
  "Projects/Apollo.md": "---\ntags: project\n---\nApollo",
  "Notes/Wrapped.md": `${"A first line long enough to wrap over several rows of the editor. ".repeat(6)}\nSecond line.\n`,
};

function docText(page: Page): Promise<string> {
  return page.evaluate(() =>
    (globalThis as any).client.editorView.state.doc.toString(),
  );
}

function setCaret(page: Page, where: "start" | "end") {
  return page.evaluate((where) => {
    const view = (globalThis as any).client.editorView;
    view.dispatch({
      selection: { anchor: where === "start" ? 0 : view.state.doc.length },
    });
  }, where);
}

function ghost(page: Page) {
  return page.locator(".sb-frontmatter-ghost");
}

function firstLine(page: Page) {
  return page.locator(".cm-line").first();
}

async function firstLineTop(page: Page): Promise<number> {
  return (await firstLine(page).boundingBox())!.y;
}

// Line 1's first visual row, and the leftmost text painted on it
function firstRow(page: Page) {
  return page.evaluate(() => {
    const view = (globalThis as any).client.editorView;
    const first = view.coordsAtPos(0, 1);
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".cm-line")!);
    let left = Number.POSITIVE_INFINITY;
    for (const rect of range.getClientRects()) {
      const middle = (rect.top + rect.bottom) / 2;
      if (rect.width > 0 && middle >= first.top && middle <= first.bottom) {
        left = Math.min(left, rect.left);
      }
    }
    return { top: first.top, bottom: first.bottom, left };
  });
}

async function expectBesideFirstRow(page: Page) {
  const box = (await ghost(page).boundingBox())!;
  const row = await firstRow(page);
  expect(box.x + box.width).toBeLessThanOrEqual(row.left);
  expect(Math.abs(box.y - row.top)).toBeLessThanOrEqual(1);
  expect(box.height).toBeLessThanOrEqual(row.bottom - row.top + 1);
}

function tagsRow(page: Page) {
  return page.locator('.sb-frontmatter-preview .sb-fm-row[data-key="tags"]');
}

test.describe("adding attributes to a page without frontmatter", () => {
  test.use({ spaceFiles });

  test("the ghost icon shows only while hovering the top of the page, left of line 1, and never moves it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Plain");
    await expect(ghost(sbPage)).toHaveCount(1);
    await expect(ghost(sbPage).locator("svg.sb-fm-icon")).toHaveCount(1);
    await expect(ghost(sbPage)).toHaveAttribute("title", "add tag");
    await expect(ghost(sbPage)).toHaveAttribute("aria-label", "add tag");

    // Not before any hover, even with the caret at the very start
    await sbPage.mouse.move(5, 500);
    await setCaret(sbPage, "start");
    await expect(ghost(sbPage)).toHaveCSS("opacity", "0");
    const hiddenTop = await firstLineTop(sbPage);

    await firstLine(sbPage).hover();
    await expect(ghost(sbPage)).toHaveCSS("opacity", "1");
    expect(await firstLineTop(sbPage)).toBe(hiddenTop);
    // Left of the revealed heading marker (caret on line 1)
    await expect
      .poll(async () => {
        const box = (await ghost(sbPage).boundingBox())!;
        return box.x + box.width <= (await firstRow(sbPage)).left;
      })
      .toBe(true);
    await expectBesideFirstRow(sbPage);

    await setCaret(sbPage, "end");
    await expect
      .poll(async () => {
        const box = (await ghost(sbPage).boundingBox())!;
        return box.x + box.width <= (await firstRow(sbPage)).left;
      })
      .toBe(true);
    await expectBesideFirstRow(sbPage);

    await sbPage.locator(".cm-line", { hasText: "Body text." }).hover();
    await expect(ghost(sbPage)).toHaveCSS("opacity", "0");
    expect(await firstLineTop(sbPage)).toBe(hiddenTop);
  });

  test("on a wrapped line 1 the ghost icon is level with its first row", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Wrapped");
    await setCaret(sbPage, "end");
    const line = (await firstLine(sbPage).boundingBox())!;
    const row = await firstRow(sbPage);
    expect(line.height).toBeGreaterThan((row.bottom - row.top) * 1.5);
    await sbPage.mouse.move(line.x + 50, line.y + line.height - 5);
    await expect(ghost(sbPage)).toHaveCSS("opacity", "1");
    await expectBesideFirstRow(sbPage);
  });

  test("the ghost inserts tags: frontmatter and focuses the tags field; undo removes it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Plain");
    await firstLine(sbPage).hover();
    await ghost(sbPage).click();
    await expect.poll(() => docText(sbPage)).toBe(`---\ntags:\n---\n${plain}`);
    await expect(ghost(sbPage)).toBeHidden();
    const input = tagsRow(sbPage).locator(".sb-in-chip-input");
    await expect(input).toBeFocused();
    await expect(input).not.toHaveAttribute("placeholder", /.+/);
    // No picker or completion opens by itself
    await expect(sbPage.locator(".sb-in-option:visible")).toHaveCount(0);
    await expect(sbPage.locator(".sb-in-dropdown:visible")).toHaveCount(0);
    await expect(sbPage.locator(".sb-modal")).toHaveCount(0);

    // The first completion is preselected: Enter takes it
    await sbPage.keyboard.type("proj");
    await expect(
      tagsRow(sbPage).locator(".sb-in-option.sb-in-selected"),
    ).toContainText("project");
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(() => docText(sbPage))
      .toBe(`---\ntags: project\n---\n${plain}`);

    // Removing the last tag keeps the key
    await tagsRow(sbPage).locator(".sb-in-x").first().click();
    await expect.poll(() => docText(sbPage)).toBe(`---\ntags:\n---\n${plain}`);
    await expect(tagsRow(sbPage)).toHaveCount(1);

    // Shift-Enter and Space commit exactly what was typed
    for (const key of ["Shift+Enter", " "]) {
      const input = tagsRow(sbPage).locator(".sb-in-chip-input");
      await input.focus();
      await sbPage.keyboard.type("proj");
      await expect(
        tagsRow(sbPage).locator(".sb-in-option").first(),
      ).toBeVisible();
      await sbPage.keyboard.press(key);
      await expect
        .poll(() => docText(sbPage))
        .toBe(`---\ntags: proj\n---\n${plain}`);
      await tagsRow(sbPage).locator(".sb-in-x").first().click();
      await expect
        .poll(() => docText(sbPage))
        .toBe(`---\ntags:\n---\n${plain}`);
    }

    for (let i = 0; i < 7; i++) await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toBe(plain);
    await firstLine(sbPage).hover();
    await expect(ghost(sbPage)).toBeVisible();
  });

  test("Enter on the focused ghost icon does what a click does", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Plain");
    await firstLine(sbPage).hover();
    await expect(ghost(sbPage)).toHaveCSS("opacity", "1");
    await ghost(sbPage).focus();
    await sbPage.keyboard.press("Enter");
    await expect.poll(() => docText(sbPage)).toBe(`---\ntags:\n---\n${plain}`);
    await expect(tagsRow(sbPage).locator(".sb-in-chip-input")).toBeFocused();
    await expect(sbPage.locator(".sb-in-option:visible")).toHaveCount(0);
  });

  test("a page with frontmatter has no ghost; its form is labelled until hovered", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Tagged");
    const form = sbPage.locator(".sb-frontmatter-preview");
    await expect(form.locator('.sb-fm-row[data-key="status"]')).toBeVisible();
    await expect(ghost(sbPage)).toBeHidden();

    const label = form.locator("> .sb-object-preview-label");
    await sbPage.mouse.move(5, 500);
    await setCaret(sbPage, "end");
    await expect(label).toHaveText("frontmatter");
    await expect(label).toHaveAttribute("aria-hidden", "true");
    await expect(label).toHaveCSS("opacity", "0.8");
    await form.hover();
    await expect(label).toHaveCSS("opacity", "0");
  });
});

test.describe("no ghost with liveEdit.frontmatter off", () => {
  test.use({
    spaceFiles: {
      ...spaceFiles,
      "CONFIG.md":
        '```space-lua\nconfig.set("liveEdit", { frontmatter = false })\n```\n',
    },
  });

  test("a page without frontmatter shows no ghost; raw YAML keeps its label", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Plain");
    await expect(
      sbPage.locator(".cm-line", { hasText: "Body text." }),
    ).toBeVisible();
    await expect(ghost(sbPage)).toBeHidden();

    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Tagged");
    await expect(
      sbPage.locator(".cm-line .sb-frontmatter-marker").first(),
    ).toHaveText("frontmatter");
  });
});
