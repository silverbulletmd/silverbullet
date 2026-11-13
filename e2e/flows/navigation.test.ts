import type { Page } from "@playwright/test";
import {
  currentPage,
  expectNavInputFocused,
  navFrame,
  navInput,
  navRows,
  openPagePicker,
  openPicker,
  runCommandViaPalette,
} from "../fixtures/actions.ts";
import {
  expect,
  gotoSilverBulletPage,
  mod,
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

  test("command and document pickers keep their headers visible on a phone", async ({
    sbPage,
  }) => {
    await sbPage.setViewportSize({ width: 602, height: 961 });

    const commandFrame = await openPicker(sbPage, `${mod}+/`, "Command");
    await sbPage.setViewportSize({ width: 596, height: 961 });
    const commandTop = await commandFrame
      .locator(".sb-nav-header")
      .evaluate((element) => element.getBoundingClientRect().top);
    const topBarBottom = await sbPage
      .locator("#sb-top")
      .evaluate((element) => element.getBoundingClientRect().bottom);
    expect(commandTop).toBeGreaterThanOrEqual(topBarBottom);
    await sbPage.keyboard.press("Escape");

    await sbPage.setViewportSize({ width: 602, height: 961 });
    await runCommandViaPalette(sbPage, "Navigate: Document Picker");
    await sbPage.setViewportSize({ width: 596, height: 961 });
    const documentFrame = navFrame(sbPage);
    await expect(navInput(sbPage)).toHaveAttribute("placeholder", "Document");
    const documentTop = await documentFrame
      .locator(".sb-nav-header")
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(documentTop).toBeGreaterThanOrEqual(topBarBottom);
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

    // A page picker opened by a command gets the focus the palette had
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

test.describe("space tree", () => {
  test.use({
    spaceFiles: {
      "index.md": "Before\n\nAfter",
      "Projects/Alpha.md": "# Alpha",
      "Projects/Beta.md": "# Beta",
      "Journal/Today.md": "# Today\n\nPlanning notes.",
      ...Object.fromEntries(
        Array.from({ length: 80 }, (_, index) => [
          `Archive ${index}/Note.md`,
          "Archived notes",
        ]),
      ),
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

    const expandAll = tree.getByRole("button", { name: "Expand all folders" });
    const collapseAll = tree.getByRole("button", {
      name: "Collapse all folders",
    });
    await expect(expandAll).toBeEnabled();
    await expect(collapseAll).toBeDisabled();
    await expandAll.click();
    await expect(tree.locator("[data-path='Projects/Alpha']")).toBeVisible();
    await expect(expandAll).toBeDisabled();
    // The buttons follow the segment: All leaves Library/ out, so its
    // folder is still collapsed in Tool
    await tree.getByRole("radio", { name: "Tool Pages" }).click();
    await expect(expandAll).toBeEnabled();
    await expect(collapseAll).toBeDisabled();
    await tree.getByRole("radio", { name: "All" }).click();
    await collapseAll.click();
    await expect(tree.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

    await tree.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await expect(tree.locator("[data-path='Projects/Alpha']")).toBeVisible();
    await tree.locator("[data-path='Projects/Alpha'] .sb-nav-primary").click();

    await expect(currentPage(sbPage)).toHaveValue("Projects/Alpha");
    await expect(tree).toBeVisible();
    await expect(
      tree.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
    ).toBeVisible();

    await sbPage.evaluate(async () => {
      await (globalThis as any).client.clientSystem.ds.set(
        ["navigator", "std.spaceTree", "expanded"],
        Array.from({ length: 80 }, (_, i) => `Archive ${i}`),
      );
    });
    await sbPage.reload();
    await expect(tree.locator("[data-path='Archive 0/Note']")).toBeAttached();

    await expect(
      tree.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
    ).toBeInViewport();
    await expect(sbPage.locator("#sb-editor .cm-content")).toBeFocused();
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

  test("dropping multiple files on a folder confirms the destination and saves them", async ({
    sbPage,
    sbServer,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Tree");
    const tree = sbPage.locator(".sb-nav-root-lhs");
    await expect(tree.locator("[data-path='Projects']")).toBeVisible({
      timeout: 20_000,
    });
    const rowTop = (await tree.locator("[data-path='Projects']").boundingBox())!
      .y;
    const rowOffset = await tree
      .locator("[data-path='Projects']")
      .evaluate((element) => (element as HTMLElement).offsetTop);
    await sbPage.evaluate(() => {
      const folder = document.querySelector(
        ".sb-nav-root-lhs [data-path='Projects']",
      )!;
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["# Draft"], "Draft.md", { type: "text/markdown" }),
      );
      transfer.items.add(
        new File(["details"], "Details.txt", { type: "text/plain" }),
      );
      folder.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    });
    await expect(tree.locator("[data-path='Projects']")).toHaveClass(
      /sb-nav-droptarget/,
    );
    await expect(tree.locator(".sb-nav-upload-target")).toHaveText(
      "Upload to Projects",
    );
    await expect(tree.locator(".sb-nav-upload-target span")).toBeInViewport();
    expect(
      (await tree.locator("[data-path='Projects']").boundingBox())!.y,
    ).toBe(rowTop);
    expect(
      await tree
        .locator("[data-path='Projects']")
        .evaluate((element) => (element as HTMLElement).offsetTop),
    ).toBe(rowOffset);
    await sbPage.evaluate(() => {
      const folder = document.querySelector(
        ".sb-nav-root-lhs [data-path='Projects']",
      )!;
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["# Draft"], "Draft.md", { type: "text/markdown" }),
      );
      transfer.items.add(
        new File(["details"], "Details.txt", { type: "text/plain" }),
      );
      folder.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    });
    const prompt = sbPage.locator(".sb-prompt");
    await expect(prompt).toContainText("Upload 2 files to folder");
    await expect(prompt.locator(".sb-prompt-input")).toHaveValue("Projects");
    await prompt.getByRole("button", { name: /Ok/ }).click();
    await expect(prompt).toBeHidden();
    await waitForPersistedContent(sbServer, "Projects/Draft.md", "# Draft");
    await waitForPersistedContent(sbServer, "Projects/Details.txt", "details");
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

test.describe("read-only keyboard navigation", () => {
  test.use({
    serverEnv: { SB_READ_ONLY: "1" },
    spaceFiles: {
      "index.md": "# Welcome\n\nIntro text.\n\nSee [[Destination]] here.\n",
      "Destination.md": "# Destination\n\nFirst line.\n\nBack to [[index]].\n",
    },
  });

  const placeCursor = (page: Page, needle: string, offset = 0) =>
    page.evaluate(
      ([needle, offset]) => {
        const view = (globalThis as any).client.editorView;
        view.dispatch({
          selection: {
            anchor: view.state.doc.toString().indexOf(needle) + offset,
          },
        });
      },
      [needle, offset] as const,
    );

  test("plain Enter on a wiki link opens the page", async ({
    sbPage: page,
  }) => {
    await placeCursor(page, "[[");
    await expect(page.locator(".sb-link-cursor")).toHaveText("Destination");
    await page.keyboard.press("Enter");
    await expect(currentPage(page)).toHaveValue("Destination");
  });
});
