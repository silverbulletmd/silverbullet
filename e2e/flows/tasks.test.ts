import type { Page } from "@playwright/test";
import {
  expect,
  gotoSilverBulletPage,
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

test.describe("task:stateChange from query widgets", () => {
  // Keeps a count and the last payload on window so the test can read them.
  const listener = [
    "```space-lua",
    'event.listen { name = "task:stateChange", run = function(e)',
    "  js.window.stateChangeCount = (js.window.stateChangeCount or 0) + 1",
    "  js.window.lastStateChange = js.tojs(e.data)",
    "end }",
    "```",
    "",
  ].join("\n");

  test.use({
    spaceFiles: {
      "Shopping.md":
        "# Shopping\n\n* [ ] milk #shopping\n* [ ] eggs #shopping\n",
      "Daily.md":
        '# Daily\n\n${query[[from t = index.tasks("shopping") order by t.name select templates.taskItem(t)]]}\n',
      "Home.md":
        '# Home\n\n* [ ] call mom #home\n\n${query[[from t = index.tasks("home") select templates.taskItem(t)]]}\n',
      "Listener.md": listener,
    },
  });

  function stateChangeCount(page: Page): Promise<number> {
    return page.evaluate(() => (globalThis as any).stateChangeCount ?? 0);
  }

  function lastStateChange(page: Page): Promise<Record<string, unknown>> {
    return page.evaluate(() => (globalThis as any).lastStateChange);
  }

  test("ticking a task from another page fires the event", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Daily");
    const checkboxes = page.locator(
      "#sb-editor .sb-lua-directive-block input[type='checkbox']",
    );
    await expect(checkboxes).toHaveCount(2);

    // Rows are ordered by name: eggs, then milk
    await checkboxes.nth(1).click();
    await waitForPersistedContent(sbServer, "Shopping.md", /\* \[x\] milk/);

    await expect.poll(() => stateChangeCount(page)).toBe(1);
    const event = await lastStateChange(page);
    expect(event).toMatchObject({
      ref: "Shopping@12",
      page: "Shopping",
      pos: 12,
      oldState: " ",
      newState: "x",
      text: "[ ] milk #shopping",
    });
    // Editor positions would point into Daily, not Shopping
    expect(event.from).toBeUndefined();
    expect(event.to).toBeUndefined();
  });

  test("ticking a same-page task from a query includes editor positions", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Home");
    const widgetCheckbox = page.locator(
      "#sb-editor .sb-lua-directive-block input[type='checkbox']",
    );
    await expect(widgetCheckbox).toHaveCount(1);

    await widgetCheckbox.click();
    await waitForPersistedContent(sbServer, "Home.md", /\* \[x\] call mom/);

    await expect.poll(() => stateChangeCount(page)).toBe(1);
    const event = await lastStateChange(page);
    const source = "# Home\n\n* [ ] call mom #home";
    expect(event).toMatchObject({
      ref: "Home@8",
      page: "Home",
      oldState: " ",
      newState: "x",
      text: "[ ] call mom #home",
      from: source.indexOf("[ ]"),
      to: source.length,
    });
  });
});
