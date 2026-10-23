import type { Page } from "@playwright/test";
import {
  expect,
  gotoSilverBulletPage,
  type SBServer,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

test.describe("task workflows", () => {
  test.use({
    spaceFiles: {
      "Tasks.md":
        "# Tasks\n\n* [ ] Order supplies\n* [ ] Draft agenda\n* [x] Archive notes\n",
    },
  });

  test("toggling a task persists across reopening", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Tasks");
    const checkboxes = page.locator(
      "#sb-editor .sb-checkbox input[type='checkbox']",
    );
    await expect(checkboxes).toHaveCount(3);
    await expect(checkboxes.nth(2)).toBeChecked();
    await expect(checkboxes.first()).not.toBeChecked();

    await checkboxes.first().click();
    await waitForPersistedContent(
      sbServer,
      "Tasks.md",
      /\* \[x\] Order supplies/,
    );

    await gotoSilverBulletPage(page, sbServer, "Tasks");
    await expect(checkboxes.first()).toBeChecked();
  });
});

test.describe("cycling task states from a query", () => {
  const taskList = (pageName: string) =>
    `\${query[[from t = index.tasks() where t.page == "${pageName}" order by t.pos select templates.taskItem(t)]]}\n`;

  test.use({
    spaceFiles: {
      "States.md": [
        "```space-lua",
        'taskState.define { name = "TODO", order = 1 }',
        'taskState.define { name = "IN PROGRESS", order = 2 }',
        'taskState.define { name = "DONE", order = 3, done = true }',
        "```",
        "",
      ].join("\n"),
      "Work.md": "# Work\n\n* [TODO] first\n* [TODO] second\n* [TODO] third\n",
      "Board.md": `# Board\n\n${taskList("Work")}`,
      "Inline.md": `# Inline\n\n* [TODO] first\n* [TODO] second\n\n${taskList("Inline")}`,
    },
  });

  async function openList(page: Page, sbServer: SBServer, name: string) {
    await gotoSilverBulletPage(page, sbServer, name);
    // Out of the directive, so it renders
    await page.evaluate(() => {
      const view = (window as any).client.editorView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    return page.locator("#sb-editor .sb-lua-directive-block .sb-task-state");
  }

  test("quick clicks on tasks of another page each save once", async ({
    page,
    sbServer,
  }) => {
    const states = await openList(page, sbServer, "Board");
    await expect(states).toHaveCount(3);

    // IN PROGRESS is longer than TODO, so each save moves the tasks after it
    await states.nth(0).click();
    await states.nth(0).click();
    await states.nth(1).click();
    await states.nth(2).click();

    await waitForPersistedContent(
      sbServer,
      "Work.md",
      "# Work\n\n* [DONE] first\n* [IN PROGRESS] second\n* [IN PROGRESS] third\n",
    );
    await expect(states).toHaveText(["DONE", "IN PROGRESS", "IN PROGRESS"]);
  });

  test("quick clicks on tasks of the open page each save once", async ({
    page,
    sbServer,
  }) => {
    const states = await openList(page, sbServer, "Inline");
    await expect(states).toHaveCount(2);

    await states.nth(0).click();
    await states.nth(1).click();

    await waitForPersistedContent(
      sbServer,
      "Inline.md",
      /^# Inline\n\n\* \[IN PROGRESS\] first\n\* \[IN PROGRESS\] second\n/,
    );
  });
});
