import type { Page } from "@playwright/test";
import {
  docText,
  expectLineHandleOn,
  lineHandle,
  lineMenuItem,
  openLineMenu,
} from "../fixtures/actions.ts";
import { expect, gotoSilverBulletPage, mod, test } from "../fixtures/core.ts";

const plain = "# Plain\nBody text.\n";
const list = "Intro\n\n- one\n- two\n- three\n- four\n";

const spaceFiles = {
  "index.md": "Welcome",
  "Notes/Plain.md": plain,
  "Notes/Tagged.md": "---\nstatus: active\n---\nTagged body.\n",
  "Notes/List.md": list,
  "Notes/Query.md":
    'Before\n${query[[from index.tag "page" limit 2]]}\nAfter\n',
  "Notes/Links.md": "Intro\n[[Notes/Plain]]\nAfter\n",
  "Projects/Apollo.md": "---\ntags: project\n---\nApollo",
  "Notes/Wrapped.md": `${"A first line long enough to wrap over several rows of the editor. ".repeat(6)}\nSecond line.\n`,
};

function setCaret(page: Page, where: "start" | "end") {
  return page.evaluate((where) => {
    const view = (globalThis as any).client.editorView;
    view.dispatch({
      selection: { anchor: where === "start" ? 0 : view.state.doc.length },
    });
  }, where);
}

// With the editor unfocused, only a hovered line has a handle
function blurEditor(page: Page) {
  return page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

// Before checking a line gets no handle: the handle is placed in the editor's
// next measure, a frame after the pointer moves
function afterMeasure(page: Page) {
  return page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
}

// Shown beside `line`, faded in
async function expectShownOn(page: Page, line: number) {
  await expectLineHandleOn(page, line);
  await expect(lineHandle(page)).toHaveCSS("opacity", "1");
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
  const box = (await lineHandle(page).boundingBox())!;
  const row = await firstRow(page);
  expect(box.x + box.width).toBeLessThanOrEqual(row.left);
  expect(Math.abs(box.y - row.top)).toBeLessThanOrEqual(1);
  expect(box.height).toBeLessThanOrEqual(row.bottom - row.top + 1);
}

function tagsRow(page: Page) {
  return page.locator('.sb-frontmatter-preview .sb-fm-row[data-key="tags"]');
}

test.describe("the line handle", () => {
  test.use({ spaceFiles });

  test("hovering the top of the page shows the handle left of line 1, and never moves it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Plain");
    await expect(lineHandle(sbPage)).toHaveCount(1);
    await expect(
      lineHandle(sbPage).locator("svg.sb-line-handle-icon"),
    ).toHaveCount(1);
    await expect(lineHandle(sbPage)).toHaveAttribute("title", "Line actions");
    await expect(lineHandle(sbPage)).toHaveAttribute(
      "aria-label",
      "Line actions",
    );
    await expect(lineHandle(sbPage)).toHaveAttribute("aria-haspopup", "menu");

    // Not before any hover, not even on the cursor's line
    await sbPage.mouse.move(5, 500);
    await setCaret(sbPage, "start");
    await sbPage.locator(".cm-content").focus();
    await afterMeasure(sbPage);
    await expect(lineHandle(sbPage)).not.toHaveClass(/sb-line-handle-shown/);
    await blurEditor(sbPage);
    const hiddenTop = await firstLineTop(sbPage);

    await firstLine(sbPage).hover();
    await expectShownOn(sbPage, 1);
    expect(await firstLineTop(sbPage)).toBe(hiddenTop);
    // Left of the revealed heading marker (caret on line 1)
    await expect
      .poll(async () => {
        const box = (await lineHandle(sbPage).boundingBox())!;
        return box.x + box.width <= (await firstRow(sbPage)).left;
      })
      .toBe(true);
    await expectBesideFirstRow(sbPage);

    await setCaret(sbPage, "end");
    await expect
      .poll(async () => {
        const box = (await lineHandle(sbPage).boundingBox())!;
        return box.x + box.width <= (await firstRow(sbPage)).left;
      })
      .toBe(true);
    await expectBesideFirstRow(sbPage);

    // The padding above line 1 counts as line 1
    const scroller = (await sbPage.locator(".cm-scroller").boundingBox())!;
    const line = (await firstLine(sbPage).boundingBox())!;
    await sbPage.mouse.move(line.x + 50, scroller.y + 2);
    await expectShownOn(sbPage, 1);

    await sbPage.locator(".cm-line", { hasText: "Body text." }).hover();
    await expectShownOn(sbPage, 2);
    expect(await firstLineTop(sbPage)).toBe(hiddenTop);
  });

  test("Add tag from line 1's menu inserts tags: frontmatter and focuses the tags field; undo removes it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Plain");
    await openLineMenu(sbPage, "Plain", 1);
    // Add tag comes first
    await expect(
      sbPage.locator(".sb-dock-menu [role=menuitem]").first(),
    ).toHaveText(/^Add tag/);
    await lineMenuItem(sbPage, "Add tag").click();
    await expect.poll(() => docText(sbPage)).toBe(`---\ntags:\n---\n${plain}`);
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

    for (let i = 0; i < 2; i++) await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(() => docText(sbPage)).toBe(plain);
    await openLineMenu(sbPage, "Plain", 1);
    await expect(lineMenuItem(sbPage, "Add tag")).toBeVisible();
  });

  test("hovering a list item shows its handle; Indent from the menu indents it", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/List");
    await setCaret(sbPage, "start");
    await openLineMenu(sbPage, "two", 4);
    await expect(lineMenuItem(sbPage, "Outdent")).toBeVisible();
    await expect(lineMenuItem(sbPage, "Turn into bullet item")).toHaveCount(0);
    await lineMenuItem(sbPage, "Indent").click();
    await expect
      .poll(async () => (await docText(sbPage)).split("\n")[3])
      .toMatch(/^\s+- two$/);
    await expect
      .poll(async () => (await docText(sbPage)).split("\n")[4])
      .toBe("- three");
    // The cursor moved to the item's text
    const head = await sbPage.evaluate(
      () => (globalThis as any).client.editorView.state.selection.main.head,
    );
    const text = await docText(sbPage);
    expect(text.slice(head)).toMatch(/^two/);
  });

  test("with three list items selected, Indent from the middle item's handle indents all three", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/List");
    await sbPage.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      const text = view.state.doc.toString();
      view.dispatch({
        selection: {
          anchor: text.indexOf("two"),
          head: text.indexOf("four") + "four".length,
        },
      });
    });
    await openLineMenu(sbPage, "three", 5);
    await lineMenuItem(sbPage, "Indent").click();
    await expect
      .poll(async () => (await docText(sbPage)).split("\n").slice(2, 6))
      .toEqual([
        "- one",
        expect.stringMatching(/^\s+- two$/),
        expect.stringMatching(/^\s+- three$/),
        expect.stringMatching(/^\s+- four$/),
      ]);
  });
});
