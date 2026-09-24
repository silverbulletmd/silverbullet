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

const tableConfig = `# Table views
\`\`\`space-lua
function projectTable(selectable)
  return view.new {
    refreshOn = {"fixture:table"},
    source = function()
      if tableEmpty then return {} end
      if tableError then error("Table unavailable") end
      return {
      {name = "**Sketchbook**", completed = tableUpdated and 1 or 12, total = 20},
      {name = "[[Destination|Garden]]", completed = 3, total = 20},
      {name = "Orchard", completed = 7, total = 20},
    } end,
    presentation = {mode = "table", limit = 2, columns = {
      {attribute = "name", label = "Project"},
      {attribute = "completed", label = "Progress", value = function(obj) return obj.completed .. "/" .. obj.total end},
    }},
    actions = {{label = "Refresh values", run = function() tableUpdated = true end}},
    onSelect = selectable and function(obj) tableSelected = obj.completed; return false end or nil,
  }
end
function automaticTable()
  return view.new {
    source = function() return {{name = "Maple", count = 2}, {name = "Cedar", status = false}} end,
    presentation = {mode = "table"},
  }
end
function typedTable()
  return view.new {
    source = function() return {
      {ref = "Destination", amount = "12", done = "false", url = "https://example.com/one", text = "**literal**", markdown = "**rich**"},
      {ref = "[[Destination|Already linked]]", amount = "3", done = true, url = "javascript:alert(1)", text = "[[Destination]]", markdown = "*other*"},
    } end,
    presentation = {mode = "table", columns = {
      {attribute = "ref", type = "ref", value = function(obj) return obj.ref end},
      {attribute = "amount", type = "number", value = function(obj) return 100 - tonumber(obj.amount) end},
      {attribute = "done", type = "boolean"},
      {attribute = "url", type = "url"},
      {attribute = "text", type = "text"},
      {attribute = "markdown", type = "markdown"},
      {label = "Computed", type = "number", value = function(obj) return 100 - tonumber(obj.amount) end},
    }},
    onSelect = function() typedSelected = true; return false end,
  }
end
view.define {name = "fixture.typedTable", view = typedTable(), command = "Fixture: Open Typed Table"}
view.define {name = "fixture.dockedTable", view = typedTable(), dock = "rhs", title = "Typed table", command = "Fixture: Open Docked Table"}
view.define {name = "fixture.bottomTable", view = typedTable(), dock = "bhs", title = "Typed table", command = "Fixture: Open Bottom Table"}
view.define {name = "fixture.table", view = projectTable(true), command = "Fixture: Open Table"}
\`\`\`
`;

test.describe("table views", () => {
  test.use({
    spaceFiles: {
      "CONFIG.md": tableConfig,
      "index.md":
        "# Projects\n\n${projectTable(false)}\n\n${automaticTable()}\n\nEnd.",
      "Destination.md": "# Destination",
    },
  });

  test("tables render Markdown and retain source order through refreshes and actions", async ({
    sbPage,
  }) => {
    const tables = sbPage.locator(".sb-lua-view table");
    await expect(tables).toHaveCount(2);
    const table = sbPage.locator(".sb-lua-view").nth(0).locator("table");
    const names = table.locator("tbody tr td:first-child");
    await expect(table.locator("strong")).toHaveText("Sketchbook");
    await expect(names).toHaveText(["Sketchbook", "Garden"]);
    await expect(table.locator("tbody tr[tabindex]")).toHaveCount(0);
    await expect(
      table.locator(".sb-nav-selected, .sb-table-selectable"),
    ).toHaveCount(0);
    await expect(tables.nth(1).locator("thead th")).toHaveText([
      "name",
      "count",
      "status",
    ]);
    await expect(
      tables.nth(1).locator("tbody tr").nth(1).locator("td"),
    ).toHaveText(["Cedar", "", "false"]);
    await expect(table.locator("thead button")).toHaveCount(0);
    await sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua(
        '(function() tableEmpty = true; event.dispatch("fixture:table") end)()',
      ),
    );
    await expect(table.locator("tbody tr")).toHaveCount(0);
    await sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua(
        '(function() tableEmpty = false; event.dispatch("fixture:table") end)()',
      ),
    );
    await expect(names).toHaveText(["Sketchbook", "Garden"]);
    await sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua(
        '(function() tableError = true; event.dispatch("fixture:table") end)()',
      ),
    );
    await expect(
      sbPage.locator(".sb-lua-view").nth(0).getByRole("alert"),
    ).toContainText("Table unavailable");
    await sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua(
        '(function() tableError = false; event.dispatch("fixture:table") end)()',
      ),
    );
    await expect(names).toHaveText(["Sketchbook", "Garden"]);
    await table.locator("tbody tr").first().hover();
    await table.getByRole("button", { name: "Refresh values" }).first().click();
    await expect(names).toHaveText(["Sketchbook", "Garden"]);
    await expect(table.locator("tbody tr td:nth-child(2)")).toHaveText([
      "1/20",
      "3/20",
    ]);
    await expect(currentPage(sbPage)).toHaveValue("index");
    await sbPage.locator(".cm-content").focus();
    await runCommandViaPalette(sbPage, "Fixture: Open Table");
    const panel = navFrame(sbPage);
    const panelTable = panel.locator("table");
    await expect(panelTable.locator("tbody tr")).toHaveCount(2);
    await expect(panelTable.locator("thead button")).toHaveCount(0);
    await expect(panelTable.locator("tbody tr td:first-child")).toHaveText([
      "Sketchbook",
      "Garden",
    ]);
    await navInput(sbPage).focus();
    await navInput(sbPage).press("Enter");
    expect(
      await sbPage.evaluate(() =>
        (globalThis as any).sbRuntime.evalLua("tableSelected"),
      ),
    ).toBe(1);
    await navInput(sbPage).press("Tab");
    await expect(navInput(sbPage)).not.toBeFocused();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await table.getByRole("link", { name: "Garden" }).click();
    await expect(currentPage(sbPage)).toHaveValue("Destination");
  });

  test("typed columns render callback values and keep links independent of row selection", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Fixture: Open Typed Table");
    const table = navFrame(sbPage).locator("table");
    const rows = table.locator("tbody tr");
    const first = rows.nth(0);
    const second = rows.nth(1);
    await expect(first.locator("td").nth(0).getByRole("link")).toHaveText(
      "Destination",
    );
    await expect(second.locator("td").nth(0).getByRole("link")).toHaveText(
      "Already linked",
    );
    await expect(
      first.locator("td").nth(2).getByRole("checkbox", { name: "false" }),
    ).toBeVisible();
    await expect(
      second.locator("td").nth(2).getByRole("checkbox", { name: "true" }),
    ).toBeVisible();
    await expect(table.getByRole("checkbox")).toHaveCount(2);
    await expect(
      table.getByRole("checkbox", { name: "false" }),
    ).not.toBeChecked();
    await expect(table.getByRole("checkbox", { name: "false" })).toBeDisabled();
    await expect(table.getByRole("checkbox", { name: "true" })).toBeChecked();
    await expect(table.getByRole("checkbox", { name: "true" })).toBeDisabled();
    await expect(first.locator("td").nth(3).getByRole("link")).toHaveAttribute(
      "href",
      "https://example.com/one",
    );
    await expect(second.locator("td").nth(3).locator("a")).toHaveCount(0);
    await expect(table.locator("thead th").nth(4)).toHaveText("text");
    await expect(
      table.locator("thead th").nth(4).getByRole("button"),
    ).toHaveCount(0);
    await expect(first.locator("td").nth(4)).toHaveText("**literal**");
    await expect(second.locator("td").nth(4)).toHaveText("[[Destination]]");
    await expect(
      table.locator('td[data-type="text"] a, td[data-type="text"] strong'),
    ).toHaveCount(0);
    await expect(first.locator("td").nth(5).locator("strong")).toHaveText(
      "rich",
    );
    await expect(table.locator("tbody tr td:nth-child(2)")).toHaveText([
      "88",
      "97",
    ]);
    await expect(table.locator("tbody tr td:nth-child(2)").first()).toHaveCSS(
      "text-align",
      "right",
    );
    await expect(table.locator("thead button")).toHaveCount(0);
    await expect(table.locator("tbody tr td:nth-child(7)")).toHaveText([
      "88",
      "97",
    ]);
    await table
      .getByRole("link", { name: "Already linked", exact: true })
      .click();
    await expect(currentPage(sbPage)).toHaveValue("Destination");
    expect(
      await sbPage.evaluate(() =>
        (globalThis as any).sbRuntime.evalLua("typedSelected == nil"),
      ),
    ).toBe(true);
  });

  test("a defined table fits a right dock and scrolls wide columns", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Fixture: Open Docked Table");
    const dock = sbPage.locator(".sb-nav-root-rhs");
    const scroll = dock.locator(".sb-table-scroll");
    const table = scroll.locator("table");
    await expect(table.locator("thead th")).toHaveCount(7);
    await expect(table.getByRole("checkbox", { name: "true" })).toBeChecked();
    await expect(table.getByRole("checkbox", { name: "true" })).toBeDisabled();
    await expect(table.locator("thead button")).toHaveCount(0);
    const widths = await scroll.evaluate((element) => ({
      client: element.clientWidth,
      content: element.scrollWidth,
      parent: element.parentElement?.clientWidth,
    }));
    expect(widths.content).toBeGreaterThan(widths.client);
    expect(widths.client).toBeLessThanOrEqual(widths.parent ?? 0);
    await dock.screenshot({ path: "/tmp/silverbullet-table-dock-wide.png" });
    await sbPage.setViewportSize({ width: 980, height: 720 });
    await expect(dock).toBeVisible();
    await dock.screenshot({ path: "/tmp/silverbullet-table-dock-narrow.png" });
    await scroll.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect(table.locator("tbody tr td:nth-child(7)")).toHaveText([
      "88",
      "97",
    ]);
    await scroll.screenshot({
      path: "/tmp/silverbullet-table-dock-scrolled.png",
    });
    const lastCell = table.locator("tbody tr").first().locator("td").last();
    const visible = await lastCell.evaluate((cell) => {
      const scroll = cell.closest(".sb-table-scroll")!;
      const cellBounds = cell.getBoundingClientRect();
      const scrollBounds = scroll.getBoundingClientRect();
      return (
        cellBounds.left >= scrollBounds.left - 1 &&
        cellBounds.right <= scrollBounds.right + 1
      );
    });
    expect(visible).toBe(true);
  });

  test("a defined table lays out in the bottom dock", async ({ sbPage }) => {
    await runCommandViaPalette(sbPage, "Fixture: Open Bottom Table");
    const dock = sbPage.locator(".sb-nav-root-bhs");
    const table = dock.locator("table");
    await expect(table.locator("thead th")).toHaveCount(7);
    await expect(table.getByRole("checkbox", { name: "true" })).toBeChecked();
    await dock.screenshot({ path: "/tmp/silverbullet-table-bottom-dock.png" });
  });
});

const inlineFilterConfig = `# Inline filters
\`\`\`space-lua
function clientFilteredTable()
  return view.new {
    title = "Projects",
    source = function() return {
      {name = "Maple", count = 1},
      {name = "Cedar", status = "Ready"},
      {name = "Birch", count = 3},
    } end,
    filter = {inline = true},
    presentation = {mode = "table", limit = 2},
  }
end
function secondFilteredTable()
  return view.new {
    source = function() return {{name = "Finch"}, {name = "Robin"}} end,
    filter = {inline = true},
    presentation = {mode = "table"},
  }
end
function sourceFilteredTable()
  return view.new {
    source = function(ctx)
      sourcePhraseSeen = ctx.phrase
      if ctx.phrase == "Owl" then return {{name = "Owl"}} end
      return {{name = "Owl"}, {name = "Wren"}}
    end,
    search = "source",
    filter = {inline = true},
    presentation = {mode = "table"},
  }
end
function clientFilteredList()
  return view.new {
    source = function() return {{name = "Hawk"}, {name = "Sparrow"}} end,
    filter = {inline = true},
  }
end
\`\`\`
`;

test.describe("inline view filters", () => {
  test.use({
    spaceFiles: {
      "CONFIG.md": inlineFilterConfig,
      "index.md":
        "# Views\n\n${clientFilteredTable()}\n\n${secondFilteredTable()}\n\n${sourceFilteredTable()}\n\n${clientFilteredList()}",
    },
  });

  test("embedded tables filter independently before limits and pass source phrases", async ({
    sbPage,
  }) => {
    const views = sbPage.locator(".sb-lua-view");
    await expect(views).toHaveCount(4);
    const first = views.nth(0);
    const second = views.nth(1);
    const source = views.nth(2);
    const firstRows = first.locator("tbody tr td:first-child");
    await expect(
      first.locator(".sb-inline-view-header .sb-nav-title"),
    ).toHaveText("Projects");
    await expect(
      first.locator(".sb-inline-view-header .sb-nav-input"),
    ).toBeVisible();
    await expect(firstRows).toHaveText(["Maple", "Cedar"]);
    await expect(first.locator("thead th")).toHaveText([
      "name",
      "count",
      "status",
    ]);
    await first.getByRole("textbox", { name: "Filter view" }).fill("Birch");
    await expect(firstRows).toHaveText(["Birch"]);
    await first.screenshot({
      path: "/tmp/silverbullet-inline-table-filter.png",
    });
    await expect(first.locator("thead th")).toHaveText([
      "name",
      "count",
      "status",
    ]);
    await expect(second.locator("tbody tr td:first-child")).toHaveText([
      "Finch",
      "Robin",
    ]);
    await source.getByRole("textbox", { name: "Filter view" }).fill("Owl");
    await expect(source.locator("tbody tr td:first-child")).toHaveText(["Owl"]);
    await expect
      .poll(() =>
        sbPage.evaluate(() =>
          (globalThis as any).sbRuntime.evalLua("sourcePhraseSeen"),
        ),
      )
      .toBe("Owl");
    await first
      .getByRole("textbox", { name: "Filter view" })
      .fill("unfindable");
    await expect(first.locator("tbody tr")).toHaveCount(0);
    await expect(first.getByText("No results")).toBeVisible();
    await expect(first.locator("thead th")).toHaveText([
      "name",
      "count",
      "status",
    ]);
    await first.getByRole("textbox", { name: "Filter view" }).press("Escape");
    await expect(firstRows).toHaveText(["Maple", "Cedar"]);
    const list = views.nth(3);
    await list.getByRole("textbox", { name: "Filter view" }).fill("Sparrow");
    await expect(list.locator(".sb-nav-primary")).toHaveText(["Sparrow"]);
  });
});
