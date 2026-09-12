import type { Page } from "@playwright/test";
import {
  currentPage,
  expectNavInputFocused,
  navFrame,
  navInput,
  navRows,
  openPagePicker,
  runCommandViaPalette,
} from "../fixtures/actions.ts";
import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

test.describe("page and command navigation", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Fruit Apple.md": "Apple notes",
      "Fruit Banana.md": "Banana notes",
      "Fruit Cherry.md": "Cherry notes",
    },
  });

  test("keyboard selection opens a page and returns focus to the editor", async ({
    sbPage,
  }) => {
    const frame = await openPagePicker(sbPage);
    const input = navInput(sbPage);
    const selected = frame.locator(
      ".sb-nav-row.sb-nav-selected .sb-nav-primary",
    );

    await input.fill("Fruit B");
    await expect(selected).toHaveText("Fruit Banana", { timeout: 20_000 });
    await input.press("ArrowDown");
    await expect(frame.locator(".sb-nav-create.sb-nav-selected")).toBeVisible();
    await input.press("Control+p");
    await expect(selected).toHaveText("Fruit Banana");
    await input.press("Control+n");
    await expect(frame.locator(".sb-nav-create.sb-nav-selected")).toBeVisible();
    await input.press("Control+p");
    await expect(selected).toHaveText("Fruit Banana");
    await input.press("Enter");

    await expect(currentPage(sbPage)).toHaveValue("Fruit Banana");
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
    await expect(sbPage.locator("#sb-editor .cm-content")).toBeFocused();
  });

  test("the command palette hands focus to a page picker opened by a command", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Page Picker");
    await expectNavInputFocused(sbPage);
    await navInput(sbPage).fill("Fruit Cherry");
    await expect(navRows(navFrame(sbPage)).first()).toHaveText("Fruit Cherry", {
      timeout: 20_000,
    });
    await sbPage.keyboard.press("Enter");

    await expect(currentPage(sbPage)).toHaveValue("Fruit Cherry");
    await expect(sbPage.locator("#sb-editor .cm-content")).toBeFocused();
  });
});

test.describe("anchor navigation", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Orchard.md": "A note with $shared in it.\n",
      "Pantry.md": "Another note with $shared in it.\n",
    },
  });

  test("a duplicate anchor row routes to the page chosen by the user", async ({
    sbPage,
  }) => {
    const frame = await openPagePicker(sbPage);
    await navInput(sbPage).fill("$shared");
    await expect(navInput(sbPage)).toHaveAttribute("placeholder", "Anchor");

    const rows = frame.locator(".sb-nav-row");
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    await expect(rows.filter({ hasText: "Orchard" })).toBeVisible();
    await rows.filter({ hasText: "Pantry" }).click();

    await expect(currentPage(sbPage)).toHaveValue("Pantry");
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
  });
});

test.describe("space tree", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Projects/Alpha.md": "# Alpha",
      "Projects/Beta.md": "# Beta",
      "Journal/Today.md": "# Today\n\nPlanning notes.",
    },
  });

  test("expanding and selecting a tree row navigates while the dock stays open", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Tree");
    const tree = sbPage.locator(".sb-nav-root-lhs");
    await expect(tree.locator("[data-path='Projects']")).toBeVisible({
      timeout: 20_000,
    });
    await expect(tree.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

    await tree.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await expect(tree.locator("[data-path='Projects/Alpha']")).toBeVisible();
    await tree.locator("[data-path='Projects/Alpha'] .sb-nav-primary").click();

    await expect(currentPage(sbPage)).toHaveValue("Projects/Alpha");
    await expect(tree).toBeVisible();
    await expect(
      tree.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
    ).toBeVisible();
  });

  test("dragging a page onto a folder moves the real file", async ({
    sbPage,
    sbServer,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Tree");
    const tree = sbPage.locator(".sb-nav-root-lhs");
    await expect(tree.locator("[data-path='Journal']")).toBeVisible({
      timeout: 20_000,
    });
    await tree.locator("[data-path='Journal'] .sb-nav-chevron").click();
    await expect(tree.locator("[data-path='Journal/Today']")).toBeVisible();

    await tree
      .locator("[data-path='Journal/Today']")
      .dragTo(tree.locator("[data-path='Projects']"));

    await expect(tree.locator("[data-path='Projects/Today']")).toBeVisible({
      timeout: 20_000,
    });
    await waitForPersistedContent(
      sbServer,
      "Projects/Today.md",
      "# Today\n\nPlanning notes.",
    );
    await expect
      .poll(
        async () =>
          (await fetch(`${sbServer.url}/.fs/Journal/Today.md`)).status,
      )
      .toBe(404);
  });
});

const historyPage =
  "# History\n\nOpen [[Destination]]\n\n" +
  Array.from({ length: 12 }, (_, index) => `History line ${index + 1}`).join(
    "\n",
  );

async function selectionLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const view = (globalThis as any).client.editorView;
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
}

test.describe("browser history", () => {
  test.use({
    spaceFiles: {
      "History.md": historyPage,
      "Destination.md": "# Destination\n\nArrived.",
    },
  });

  test("a link opens fresh and Back restores the prior cursor position", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "History");
    await page.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      view.dispatch({ selection: { anchor: view.state.doc.line(8).from } });
      view.focus();
    });

    await page.locator(".sb-wiki-link", { hasText: "Destination" }).click();
    await expect(currentPage(page)).toHaveValue("Destination");
    await expect.poll(() => selectionLine(page)).toBe(1);

    await page.goBack();
    await expect(currentPage(page)).toHaveValue("History");
    await expect.poll(() => selectionLine(page)).toBe(8);
  });
});
