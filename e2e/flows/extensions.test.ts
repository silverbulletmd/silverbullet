import {
  currentPage,
  navFrame,
  navInput,
  runCommandViaPalette,
} from "../fixtures/actions.ts";
import { expect, test } from "../fixtures/core.ts";

const viewConfig = `# Route view
\`\`\`space-lua
view.define {
  name = "fixture.routes",
  title = "Routes",
  command = "Fixture: Open Routes",
  dock = "modal",
  presentation = { mode = "list", row = { description = "details" } },
  source = function()
    return js.importFromSpace("routes.js").rows()
  end,
  onSelect = function(item) editor.navigate(item.ref) end,
}
\`\`\`
`;

test.describe("Lua-defined views", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "CONFIG.md": viewConfig,
      "routes.js": `export function rows() {
        return new Promise(resolve => {
          globalThis.finishRoutes = () => resolve([{ name: "Open Destination", ref: "Destination", details: { label: "Weekend routes", text: "A quiet walking route through pine forest.", highlights: [[8, 15]] } }]);
        });
      }`,
      "Destination.md": "# Destination",
    },
  });

  test("a Space Lua view runs its source and selection handlers", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Fixture: Open Routes");
    const frame = navFrame(sbPage);
    await expect(frame.getByRole("status", { name: "Loading" })).toBeVisible();
    await navInput(sbPage).fill("Destination");
    await sbPage.evaluate(() => (globalThis as any).finishRoutes());
    await expect(frame.locator(".sb-nav-title")).toHaveText("Routes");
    await expect(navInput(sbPage)).toHaveValue("Destination");
    await expect(frame.getByRole("status", { name: "Loading" })).toHaveCount(0);
    const row = frame.locator(".sb-nav-row", { hasText: "Open Destination" });
    await expect(row.locator(".sb-nav-description-label")).toHaveText(
      "Weekend routes",
    );
    await expect(row.locator(".sb-nav-description mark")).toHaveText("walking");
    const fits = await row.evaluate((element) => {
      const rowBounds = element.getBoundingClientRect();
      const description = element
        .querySelector(".sb-nav-description")!
        .getBoundingClientRect();
      return (
        description.top >= rowBounds.top &&
        description.bottom <= rowBounds.bottom
      );
    });
    expect(fits).toBe(true);
    await row.click();

    await expect(currentPage(sbPage)).toHaveValue("Destination");
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
  });
});

const pickConfig = `# Pick command
\`\`\`space-lua
command.define {
  name = "Fixture: Pick Produce",
  run = function()
    local item = navigator.pick {
      title = "Choose Produce",
      placeholder = "Produce",
      source = function()
        return {
          { name = "Pear", value = "pear" },
          { name = "Plum", value = "plum" },
        }
      end,
    }
    return item and item.value or nil
  end,
}
\`\`\`
`;

test.describe("Lua picker", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "CONFIG.md": pickConfig,
    },
  });

  test("selecting a row returns its full object to the suspended Lua command", async ({
    sbPage,
  }) => {
    const result = sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua(
        'editor.invokeCommand("Fixture: Pick Produce")',
      ),
    );
    await expect(navInput(sbPage)).toHaveAttribute("placeholder", "Produce", {
      timeout: 20_000,
    });
    await navFrame(sbPage).locator(".sb-nav-row", { hasText: "Plum" }).click();

    await expect(sbPage.locator(".sb-modal")).toBeHidden();
    expect(await result).toBe("plum");
  });
});

test.describe("configuration extension", () => {
  test.use({ spaceFiles: { "index.md": "Workspace text" } });

  test("configuration tabs work inside the iframe without replacing the editor", async ({
    sbPage,
  }) => {
    const before = await sbPage.evaluate(() =>
      (globalThis as any).client.editorView.state.doc.toString(),
    );
    await runCommandViaPalette(sbPage, "Configuration: Open");

    const frame = sbPage.frameLocator(".sb-modal iframe");
    const configuration = frame.getByRole("tab", {
      name: "Configuration",
      exact: true,
    });
    await expect(configuration).toBeVisible();
    await configuration.focus();
    await sbPage.keyboard.press("ArrowRight");
    const shortcuts = frame.getByRole("tab", {
      name: "Keyboard Shortcuts",
      exact: true,
    });
    await expect(shortcuts).toBeFocused();
    await expect(shortcuts).toHaveAttribute("aria-selected", "true");
    await sbPage.keyboard.press("Home");
    await expect(configuration).toHaveAttribute("aria-selected", "true");

    expect(
      await sbPage.evaluate(() =>
        (globalThis as any).client.editorView.state.doc.toString(),
      ),
    ).toBe(before);
  });
});

const inlineViewConfig = `# Inline views
\`\`\`space-lua
function workshopTree()
  return view.new {
    stateKey = "workshop",
    refreshOn = {"fixture:refresh"},
    source = function()
      local rows = {{name = "Sketchbook/Cover ideas"}}
      if fixtureRefreshed then table.insert(rows, {name = "Sketchbook/Paper studies"}) end
      return rows
    end,
    presentation = { mode = "tree", row = {
      icon = function(obj) return obj.isFolder and "folder" or "file-text" end,
    } },
    actions = {
      {label = "Add study", icon = "plus", requireMode = "rw",
        when = function(obj) return not obj.isFolder end,
        run = function() fixtureRefreshed = true end},
    },
  }
end
readingDone = false
function readingList()
  return view.new {
    source = function() return {{name = "Paper studies", details = "Notes on paper, texture, and binding"}} end,
    presentation = { row = {
      description = function(obj) return readingDone and "Finished" or obj.details end,
      icon = "book",
      decorations = function() return {{text = "Active", cssClass = "sb-hashtag"}} end,
    } },
    actions = {
      {label = "Complete", icon = "check", requireMode = "rw",
        when = function() return not readingDone end,
        run = function() readingDone = true end},
    },
    onSelect = function() editor.navigate("Destination") end,
  }
end
function weeklyContent()
  return view.new {content = function() return "A **small** experiment." end}
end
view.define {
  name = "fixture.inlineReading",
  view = readingList(),
  command = "Fixture: Open Reading",
}
\`\`\`
`;

const inlineViewPage =
  "# Workshop\n\n${workshopTree()}\n\n${readingList()}\n\n${weeklyContent()}\n\n${weeklyContent()}\n\nEnd of page.";

test.describe("inline view values", () => {
  test.use({
    spaceFiles: {
      "CONFIG.md": inlineViewConfig,
      "index.md": inlineViewPage,
      "Destination.md": "# Destination",
    },
  });

  test("inline list and tree actions refresh rows without selecting them", async ({
    sbPage,
  }) => {
    const views = sbPage.locator(".sb-lua-view");
    await expect(views).toHaveCount(4);
    const list = views.nth(1);
    await expect(list.locator(".sb-nav-icon svg")).toHaveCount(1);
    await expect(list.locator(".sb-nav-chip")).toHaveText("Active");
    await list.hover();
    await expect(
      list
        .getByRole("button", { name: "Complete", exact: true })
        .locator("svg"),
    ).toHaveCount(1);
    await list.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(currentPage(sbPage)).toHaveValue("index");
    await expect(list.getByText("Finished", { exact: true })).toBeVisible();
    await expect(
      list.getByRole("button", { name: "Complete", exact: true }),
    ).toHaveCount(0);
    const tree = views.nth(0);
    await tree.getByText("Sketchbook", { exact: true }).click();
    await expect(tree.locator(".sb-nav-icon svg")).toHaveCount(2);
    await tree.getByText("Cover ideas", { exact: true }).hover();
    await tree.getByRole("button", { name: "Add study", exact: true }).click();
    await expect(
      tree.getByText("Paper studies", { exact: true }),
    ).toBeVisible();
    await expect(currentPage(sbPage)).toHaveValue("index");
  });
  test("views render inline, retain keyed expansion, and use the Lua widget Edit control", async ({
    sbPage,
  }) => {
    const views = sbPage.locator(".sb-lua-view");
    await expect(views).toHaveCount(4);
    for (const [index, expression] of [
      [0, "${workshopTree()}"],
      [1, "${readingList()}"],
    ] as const) {
      await views.nth(index).hover();
      await views
        .nth(index)
        .getByRole("button", { name: "Edit", exact: true })
        .click({ timeout: 3000 });
      expect(
        await sbPage.evaluate(() =>
          (globalThis as any).sbRuntime.evalLua("editor.getCursor()"),
        ),
      ).toBe(inlineViewPage.indexOf(expression));
      await sbPage.evaluate(() =>
        (globalThis as any).sbRuntime.evalLua("editor.moveCursor(0)"),
      );
      await expect(views).toHaveCount(4);
    }
    const tree = views.nth(0);
    await expect(tree.getByText("Sketchbook", { exact: true })).toBeVisible();
    await tree.getByText("Sketchbook", { exact: true }).click();
    await expect(tree.getByText("Cover ideas", { exact: true })).toBeVisible();
    await expect(views.nth(2).locator("strong")).toHaveText("small");
    await expect(views.nth(3).locator("strong")).toHaveText("small");
    await sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua(
        '(function() fixtureRefreshed = true; event.dispatch("fixture:refresh") end)()',
      ),
    );
    await expect(
      tree.getByText("Paper studies", { exact: true }),
    ).toBeVisible();
    await expect(
      views.locator(
        'button[data-button="copy"], button[data-button="bake"], button[data-button="reload"]',
      ),
    ).toHaveCount(0);
    await views.nth(1).getByText("Paper studies", { exact: true }).click();
    await expect(currentPage(sbPage)).toHaveValue("Destination");
    await sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua('editor.navigate("index")'),
    );
    await expect(
      views.nth(0).getByText("Cover ideas", { exact: true }),
    ).toBeVisible();
    const secondContent = views.nth(3);
    await secondContent.hover();
    await secondContent.locator('button[data-button="edit"]').click();
    const selection = await sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua("editor.getCursor()"),
    );
    expect(selection).toBe(inlineViewPage.lastIndexOf("${weeklyContent()}"));
    await expect(
      sbPage.locator(".cm-line", { hasText: "${weeklyContent()}" }),
    ).toBeVisible();
    await runCommandViaPalette(sbPage, "Fixture: Open Reading");
    await expect(
      navFrame(sbPage).getByText("Paper studies", { exact: true }),
    ).toBeVisible();
    await navFrame(sbPage).getByText("Paper studies", { exact: true }).click();
    await expect(currentPage(sbPage)).toHaveValue("Destination");
  });
});
