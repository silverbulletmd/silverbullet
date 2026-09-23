import type { Locator, Page } from "@playwright/test";
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

async function decoratedRowGeometry(row: Locator) {
  return row.evaluate((element) => {
    const rowRect = element.getBoundingClientRect();
    const titleWidth = element
      .querySelector(".sb-nav-primary")!
      .getBoundingClientRect().width;
    const trailing = element.querySelector(".sb-nav-trailing");
    if (!trailing) {
      return {
        rowWidth: rowRect.width,
        rowHeight: rowRect.height,
        titleWidth,
        chipRatios: [],
        chipTopOffsets: [],
      };
    }
    const title = element
      .querySelector(".sb-nav-primary")!
      .getBoundingClientRect();
    const clip = trailing.getBoundingClientRect();
    const chipRatios = [...trailing.children].map((child) => {
      const chip = child.getBoundingClientRect();
      const visibleWidth = Math.max(
        0,
        Math.min(chip.right, clip.right) - Math.max(chip.left, clip.left),
      );
      const visibleHeight = Math.max(
        0,
        Math.min(chip.bottom, clip.bottom) - Math.max(chip.top, clip.top),
      );
      return (visibleWidth * visibleHeight) / (chip.width * chip.height);
    });
    const chipTopOffsets = [...trailing.children].map(
      (child) => child.getBoundingClientRect().top - title.top,
    );
    return {
      rowWidth: rowRect.width,
      rowHeight: rowRect.height,
      titleWidth,
      chipRatios,
      chipTopOffsets,
    };
  });
}

test.describe("page and command navigation", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Fruit Apple.md": "Apple notes",
      "Fruit Banana.md": "Banana notes",
      "Fruit Cherry.md": "Cherry notes",
      "Plan.md": "---\ntags: [planning, active]\n---\n",
      "Projects/Medium Length Roadmap.md":
        "---\ntags: [extraordinarily-long-tag]\ndescription: Summary\n---\n",
      "Projects/Quarterly Roadmap For Product Launch.md":
        "---\ntags: [planning, roadmap, active, review]\n---\n",
    },
  });

  test("the page picker clears the standalone iOS top band", async ({
    sbPage,
  }) => {
    await sbPage.setViewportSize({ width: 390, height: 844 });
    await sbPage.addStyleTag({
      content: ":root { --sb-standalone-top-offset: 20px; }",
    });
    await openPagePicker(sbPage);

    const top = await sbPage
      .locator(".sb-modal-centered")
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(top).toBe(28);
  });

  test("page titles take precedence over tags at narrow widths", async ({
    sbPage,
  }) => {
    await sbPage.setViewportSize({ width: 390, height: 844 });
    const frame = await openPagePicker(sbPage);
    const row = frame.locator(".sb-nav-row", {
      hasText: "Projects/Quarterly Roadmap For Product Launch",
    });
    await expect(row).toBeVisible({ timeout: 20_000 });
    const plainRow = frame.locator(".sb-nav-row", { hasText: "Fruit Apple" });
    const shortRow = frame
      .locator(".sb-nav-primary")
      .filter({ hasText: /^Plan$/ })
      .locator("..");
    const intermediateRow = frame.locator(".sb-nav-row", {
      hasText: "Projects/Medium Length Roadmap",
    });
    await expect(shortRow).toBeVisible();
    await expect(intermediateRow).toBeVisible();

    const [longGeometry, plainHeight, shortGeometry, intermediateGeometry] =
      await Promise.all([
        decoratedRowGeometry(row),
        plainRow.evaluate((element) => element.getBoundingClientRect().height),
        decoratedRowGeometry(shortRow),
        decoratedRowGeometry(intermediateRow),
      ]);
    expect(longGeometry.titleWidth).toBeGreaterThan(
      longGeometry.rowWidth * 0.75,
    );
    expect(longGeometry.rowHeight).toBeCloseTo(plainHeight, 0);
    expect(longGeometry.chipRatios.filter((ratio) => ratio > 0.01)).toEqual([]);
    expect(shortGeometry.chipRatios.length).toBeGreaterThan(0);
    expect(shortGeometry.chipRatios.every((ratio) => ratio > 0.99)).toBe(true);
    expect(shortGeometry.chipTopOffsets.every((offset) => offset > 1)).toBe(
      true,
    );
    expect(
      intermediateGeometry.chipRatios.every(
        (ratio) => ratio < 0.01 || ratio > 0.99,
      ),
    ).toBe(true);
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
      "index.md": "Before\n\nAfter",
      "Projects/Alpha.md": "# Alpha",
      "Projects/Beta.md": "# Beta",
      "Files/report.txt": "Report text",
      "Journal/Today.md": "# Today\n\nPlanning notes.",
      ...Object.fromEntries(
        Array.from({ length: 80 }, (_, index) => [
          `Archive ${index}/Note.md`,
          "Archived notes",
        ]),
      ),
    },
  });

  test("a narrow-screen tree can be reopened from the side where it is docked", async ({
    sbPage,
  }) => {
    await sbPage.setViewportSize({ width: 390, height: 844 });
    await runCommandViaPalette(sbPage, "Navigate: Tree");
    const leftTree = sbPage.locator(".sb-nav-root-lhs");
    await expect(leftTree.locator("[data-path='Projects']")).toBeVisible();
    await leftTree.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await leftTree.locator("[data-path='Projects/Alpha']").click();
    await expect(currentPage(sbPage)).toHaveValue("Projects/Alpha");
    await expect(leftTree).toBeHidden();

    const leftButton = sbPage.locator(".sb-mobile-dock-left");
    await expect(leftButton).toBeVisible();
    const leftButtonRight = await leftButton.evaluate(
      (element) => element.getBoundingClientRect().right,
    );
    const titleWithDockLeft = await sbPage
      .locator("#sb-current-page")
      .evaluate((element) => element.getBoundingClientRect().left);
    expect(titleWithDockLeft - leftButtonRight).toBe(8);
    await leftButton.click();
    await expect(leftTree).toBeVisible();

    await leftTree
      .getByRole("button", { name: /Shown as: Left sidebar/ })
      .click();
    await leftTree.getByRole("menuitem", { name: "Right sidebar" }).click();
    const rightTree = sbPage.locator(".sb-nav-root-rhs");
    await expect(rightTree).toBeVisible();
    await expect(leftButton).toBeHidden();
    await rightTree.locator("[data-path='Projects/Beta']").click();
    await expect(currentPage(sbPage)).toHaveValue("Projects/Beta");
    await expect(rightTree).toBeHidden();

    const rightButton = sbPage.locator(".sb-mobile-dock-right");
    await expect(rightButton).toBeVisible();
    await sbPage.reload();
    await expect(rightButton).toBeVisible();
    await rightButton.click();
    await expect(rightTree).toBeVisible();
    const drawerLeft = await rightTree.evaluate(
      (element) => element.getBoundingClientRect().left,
    );
    expect(drawerLeft).toBeGreaterThanOrEqual(40);
    await rightTree.getByRole("button", { name: "Close", exact: true }).click();
    await expect(rightTree).toBeHidden();
    await expect(rightButton).toBeHidden();
    await sbPage.reload();
    await expect(rightButton).toBeHidden();
    const titleLeft = await sbPage
      .locator("#sb-current-page")
      .evaluate((element) => element.getBoundingClientRect().left);
    const bodyLeft = await sbPage
      .locator(".cm-line")
      .first()
      .evaluate((element) => element.getBoundingClientRect().left);
    expect(Math.abs(titleLeft - bodyLeft)).toBeLessThanOrEqual(1);
    await runCommandViaPalette(sbPage, "Navigate: Tree");
    await expect(rightTree).toBeVisible();
  });

  test("dragging Space tree files into the editor inserts links without uploading", async ({
    sbPage,
    sbServer,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Tree");
    const tree = sbPage.locator(".sb-nav-root-lhs");
    await expect(sbPage.locator(".sb-mobile-dock-scrim")).toHaveCount(0);
    await expect(tree.locator("[data-path='Projects']")).toBeVisible({
      timeout: 20_000,
    });
    await tree.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await tree.locator("[data-path='Files'] .sb-nav-chevron").click();
    await tree.locator(".sb-tree").evaluate((element) => {
      (window as any).__treeDownloads = [];
      element.addEventListener("dragstart", (event) => {
        (window as any).__treeDownloads.push(
          (event as DragEvent).dataTransfer?.getData("DownloadURL"),
        );
      });
    });
    const editor = sbPage.locator("#sb-editor .cm-content");
    await tree.locator("[data-path='Projects/Alpha']").dragTo(editor);
    await expect
      .poll(() =>
        sbPage.evaluate(() =>
          (globalThis as any).client.editorView.state.doc.toString(),
        ),
      )
      .toContain("[[Projects/Alpha]]");
    await tree.locator("[data-path='Files/report.txt']").dragTo(editor);
    await expect
      .poll(() =>
        sbPage.evaluate(() =>
          (globalThis as any).client.editorView.state.doc.toString(),
        ),
      )
      .toContain("[[Files/report.txt]]");
    await waitForPersistedContent(
      sbServer,
      "index.md",
      /(?=.*\[\[Projects\/Alpha\]\])(?=.*\[\[Files\/report\.txt\]\])/s,
    );
    const downloads = await sbPage.evaluate(async () =>
      Promise.all(
        ((window as any).__treeDownloads as string[]).map(async (value) => {
          const match = /^[^:]+:[^:]+:(.+)$/.exec(value);
          return match
            ? [value, await (await fetch(match[1])).text()]
            : [value];
        }),
      ),
    );
    expect(downloads).toEqual([
      [expect.stringContaining("text/markdown:Alpha.md:"), "# Alpha"],
      [expect.stringContaining("text/plain:report.txt:"), "Report text"],
    ]);
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
    await tree.getByRole("radio", { name: "Meta" }).click();
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
