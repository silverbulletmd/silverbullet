import {
  clickRevealedMenu,
  currentPage,
  navFrame,
  navInput,
  runCommandViaPalette,
} from "../fixtures/actions.ts";
import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

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
      "Library/Config.md": viewConfig,
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

test.describe("frontmatter live preview", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Library/Config.md": `# Configuration
\`\`\`space-lua
tag.define {
  name = "team",
  renderFrontmatter = function(pageMeta)
    return widget.htmlBlock(dom.div {
      class = "fixture-team-header",
      dom.span { class = "fixture-team-title", pageMeta.name .. ": " .. pageMeta.points },
      dom.button { class = "fixture-team-action", onclick = function() end, "Inspect" },
      dom.a { class = "fixture-team-link", href = "/index", "Open index" },
    })
  end,
}
tag.define {
  name = "empty-preview",
  renderFrontmatter = function() return "" end,
}
tag.define {
  name = "broken-preview",
  renderFrontmatter = function() error("Fixture render failure") end,
}
\`\`\`
`,
      "Teams/Example.md": "---\ntags: team\npoints: 306\n---\nBody",
      "Teams/Empty.md": "---\ntags: empty-preview\n---\nBody",
      "Teams/Broken.md": "---\ntags: broken-preview\n---\nBody",
    },
  });

  test("editing a custom header reveals YAML and refreshes from the current text", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Teams/Example");
    const preview = sbPage.locator(".sb-frontmatter-preview");
    await expect(preview.locator(".fixture-team-title")).toHaveText(
      "Teams/Example: 306",
    );
    await clickRevealedMenu(preview.locator('button[data-button="menu"]'));
    await sbPage.getByRole("menuitem", { name: "Edit source" }).click();
    await expect(preview).toHaveCount(0);
    await sbPage.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      const text = view.state.doc.toString();
      const from = text.indexOf("306");
      view.dispatch({
        changes: { from, to: from + 3, insert: "310" },
        selection: { anchor: text.length },
      });
    });
    await expect(preview.locator(".fixture-team-title")).toHaveText(
      "Teams/Example: 310",
    );
    await preview.locator(".fixture-team-action").click();
    await expect(preview).toBeVisible();
    await preview.locator(".fixture-team-title").click();
    await expect(preview).toHaveCount(0);
    await sbPage.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(preview.locator(".fixture-team-title")).toBeVisible();
    await preview.locator(".fixture-team-action").click({ modifiers: ["Alt"] });
    await expect(preview).toHaveCount(0);
    await sbPage.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await preview.locator(".fixture-team-link").click({ modifiers: ["Alt"] });
    await expect(preview).toHaveCount(0);
    await expect(currentPage(sbPage)).toHaveValue("Teams/Example");
  });

  test("empty and failing renderers keep Edit available", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Teams/Empty");
    const preview = sbPage.locator(".sb-frontmatter-preview");
    await expect(preview).toContainText(
      "Frontmatter preview returned no content",
    );
    await clickRevealedMenu(preview.locator('button[data-button="menu"]'));
    await sbPage.getByRole("menuitem", { name: "Edit source" }).click();
    await expect(preview).toHaveCount(0);

    await gotoSilverBulletPage(sbPage, sbServer, "Teams/Broken");
    await expect(preview).toContainText("Could not render frontmatter preview");
    await clickRevealedMenu(preview.locator('button[data-button="menu"]'));
    await sbPage.getByRole("menuitem", { name: "Edit source" }).click();
    await expect(preview).toHaveCount(0);
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
      "Library/Config.md": pickConfig,
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

const inlineViewConfig = `# Inline views
\`\`\`space-lua
function workshopTree()
  return widget.new {
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
  return widget.new {
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
  return widget.new {content = function() return "A **small** experiment." end}
end
\`\`\`
`;

const inlineViewPage =
  "# Workshop\n\n${workshopTree()}\n\n${readingList()}\n\n${weeklyContent()}\n\n${weeklyContent()}\n\nEnd of page.";

test.describe("inline view values", () => {
  test.use({
    spaceFiles: {
      "Library/Config.md": inlineViewConfig,
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
});

const tableConfig = `# Table views
\`\`\`space-lua
function projectTable(selectable)
  return widget.new {
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
  return widget.new {
    source = function() return {{name = "Maple", count = 2}, {name = "Cedar", status = false}} end,
    presentation = {mode = "table"},
  }
end
view.define {name = "fixture.table", widget = projectTable(true), command = "Fixture: Open Table"}
\`\`\`
`;

test.describe("table views", () => {
  test.use({
    spaceFiles: {
      "Library/Config.md": tableConfig,
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
});
