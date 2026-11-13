import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  docText,
  openWidgetMenu,
  navigateViaPagePicker,
  runCommandViaPalette,
} from "../fixtures/actions.ts";
import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

test.use({
  spaceFiles: {
    "index.md": "Welcome\n${pageAmount = 21}",
    "Recipes.md":
      '${pageAmount = 7}\n\n${widgets.commandButton("Workbench: Toggle")}\n\nEnd\n',
  },
});

type Page = import("@playwright/test").Page;

/** Opens the Data tab on `tag` (when given); its query editor shows from the start */
async function editQuery(page: Page, tag?: RegExp) {
  await runCommandViaPalette(page, "Workbench: Data");
  if (tag) {
    await page
      .getByRole("navigation", { name: "Tags" })
      .getByRole("button", { name: tag })
      .click();
  }
  await expect(page.getByRole("group", { name: "Where" })).toBeVisible();
}

test("workbench console evaluates Lua with persistent locals and shows errors", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "index");
  await runCommandViaPalette(page, "Workbench: Console");
  // Every tab is an `.sb-workbench`; the console is the one showing
  const workbench = page.locator(".sb-wb-tab:not([hidden]) .sb-workbench");
  await expect(workbench).toBeVisible();
  const log = workbench.locator(".sb-workbench-body");

  // Escape closes any completion popup so Enter runs the input instead of
  // accepting a completion.
  async function run(code: string) {
    await page.keyboard.type(code);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
  }

  await workbench.locator(".cm-content").click();
  await run("local n = 21");
  await run("n * 2");
  await expect(log).toContainText("42");

  await run("nil_thing.x");
  await expect(log).toContainText("console#3");

  const context = workbench
    .locator(".sb-wb-toolbar")
    .getByRole("button", { name: "Console context" });
  await expect(context).toHaveText("Space ▾");
  await expect(workbench.locator(".sb-workbench-input select")).toHaveCount(0);
  await context.click();
  await page
    .getByRole("menuitem", { name: "Current page: index", exact: true })
    .click();
  await expect(context).toHaveText("Page ▾");
  await workbench.locator(".cm-content").click();
  await run("pageAmount * 2");
  await expect(log.locator(".sb-wb-row-result").last()).toContainText("42");
  await page.keyboard.type("pageAmount * 3");
  await navigateViaPagePicker(page, "Recipes");
  await expect(context).toHaveAttribute("title", "Current page: Recipes");
  await expect(workbench.locator(".cm-content")).toHaveText("pageAmount * 3");
  await workbench.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(log.locator(".sb-wb-row-result").last()).toContainText("21");
  await expect(log.locator(".sb-wb-row-input").last()).toContainText(
    "[Recipes]",
  );

  // "Workbench: Scripts" switches the open panel to the Code tab's Space Lua
  // section and focuses it; switching back keeps the console
  await runCommandViaPalette(page, "Workbench: Scripts");
  const sections = page.getByRole("navigation", { name: "Code sections" });
  await expect(
    page.getByRole("radiogroup", { name: "Tabs" }).getByRole("radio", {
      name: /^Code/,
    }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    sections.getByRole("button", { name: /^Space Lua/ }),
  ).toHaveAttribute("aria-current", "page");
  const scripts = page.getByRole("table", { name: "Scripts" });
  await expect(
    page.getByRole("searchbox", { name: "Filter scripts" }),
  ).toBeFocused();
  // Your own scripts first: the built-in ones are a click away
  const visibleTab = page.locator(".sb-wb-tab:not([hidden])");
  await expect(
    visibleTab.getByRole("radio", { name: /^Custom/ }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(scripts).not.toContainText("Library/Std/Config");
  await visibleTab.getByRole("radio", { name: /^All/ }).first().click();
  await expect(scripts).toContainText("Library/Std/Config");
  // The Space Style section lists the space's styles with the rules each one
  // parsed to, also starting on your own
  await runCommandViaPalette(page, "Workbench: Styles");
  await expect(
    sections.getByRole("button", { name: /^Space Style/ }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    visibleTab.getByRole("radio", { name: /^Custom/ }),
  ).toHaveAttribute("aria-checked", "true");
  await visibleTab.getByRole("radio", { name: /^All/ }).first().click();
  await expect(page.getByRole("table", { name: "Styles" })).toContainText(
    "Library/Std",
  );
  await page.getByRole("radio", { name: "Console" }).click();
  await expect(log).toContainText("console#3");
  await workbench.locator(".cm-content").click();

  const toggleButton = page
    .locator("#sb-editor")
    .getByRole("button", { name: "Workbench: Toggle", exact: true });
  await toggleButton.click();
  await expect(workbench).toBeHidden();
  await toggleButton.click();
  await expect(workbench).toBeVisible();

  // The palette takes focus away from the panel; Toggle must still close it.
  await runCommandViaPalette(page, "Workbench: Toggle");
  await expect(workbench).toBeHidden();
  await runCommandViaPalette(page, "Workbench: Toggle");
  await expect(workbench).toBeVisible();
  await workbench.locator(".cm-content").click();

  // App shortcuts still work with focus in the REPL, and closing returns focus to the page
  await page.keyboard.press("ControlOrMeta+Alt+j");
  await expect(workbench).toBeHidden();
  await expect(page.locator("#sb-editor .cm-content")).toBeFocused();
});

test("the workbench can open as a modal window", async ({ page, sbServer }) => {
  await gotoSilverBulletPage(page, sbServer, "index");
  await runCommandViaPalette(page, "Workbench: Console");
  await page
    .locator(".sb-nav-root-bhs")
    .getByRole("button", { name: /Change placement/ })
    .click();
  // The dock menu opens on document.body, outside the panel
  await page.getByRole("menuitem", { name: "Modal window" }).click();
  const modal = page.locator('.sb-nav-root[data-slot="modal"]');
  // A tab picked by hand is remembered across the move
  await modal.getByRole("radio", { name: "Console" }).click();
  const workbench = modal.locator(".sb-wb-tab:not([hidden]) .sb-workbench");
  await expect(workbench).toBeVisible();
  await workbench.locator(".cm-content").click();
  await page.keyboard.type("6 * 7");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(workbench.locator(".sb-workbench-body")).toContainText("42");
  // Big enough to work in, not a cramped dialog
  const box = await modal.boundingBox();
  expect(box!.height).toBeGreaterThan(500);
  expect(box!.width).toBeGreaterThan(900);
  // Toggle closes it, and opens it as a modal again
  await page.keyboard.press("ControlOrMeta+Alt+j");
  await expect(modal).toBeHidden();
  await runCommandViaPalette(page, "Workbench: Console");
  await expect(modal).toBeVisible();
});

test.describe("query builder", () => {
  // Made-up books, as pages tagged #book
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Books/Piranesi.md":
        "---\ntags: book\nauthor: Susanna Clarke\nstatus: finished\nrating: 4\n---\nA house of halls.",
      "Books/Klara and the Sun.md":
        "---\ntags: book\nauthor: Kazuo Ishiguro\nstatus: finished\nrating: 3\n---\nA story told by a robot.",
      "Books/The Overstory.md":
        "---\ntags: book\nauthor: Richard Powers\nstatus: reading\n---\nTrees.",
    },
  });

  test("the workbench opens on pages, and a tag's objects copy as a query", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Workbench: Data");
    const tags = page.getByRole("navigation", { name: "Tags" });
    await expect(tags.getByRole("button", { name: /^page/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const results = page.getByRole("region", { name: "Results" });
    // Page names show as links to the pages
    await expect(
      results.getByRole("link", { name: "Piranesi" }).first(),
    ).toBeVisible();
    await tags.getByRole("button", { name: /^book/ }).click();
    await expect(results).toContainText("3 results");
    await expect(results.locator("table")).toContainText("author");
    await expect(results).toContainText("Susanna Clarke");
    await expect(results).toContainText("3 results");
    // The query editor shows from the start, and closes from its own column
    const where = page.getByRole("group", { name: "Where" });
    await expect(where).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit query" })).toBeHidden();
    await page.getByRole("button", { name: "Close query editor" }).click();
    await expect(where).toBeHidden();
    await page.getByRole("button", { name: "Edit query" }).click();
    await expect(where).toBeVisible();
    // The full query text opens with Show and closes with its ✕
    const bar = page.getByRole("region", { name: "Query" });
    await bar.getByRole("button", { name: "Show" }).click();
    await expect(bar.locator(".sb-wbq-code")).toBeVisible();
    await expect(bar.getByRole("button", { name: "Show" })).toBeHidden();
    await bar.getByRole("button", { name: "Hide query text" }).click();
    await expect(bar.locator(".sb-wbq-code")).toBeHidden();
    await page
      .getByRole("region", { name: "Query" })
      .getByRole("button", { name: "Copy" })
      .click();
    await expect(page.getByText("Copied")).toBeVisible();
  });
});

test.describe("query builder page scope", () => {
  // A made-up content page and a tool page
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Garden Notes.md": "Tomatoes by the fence.",
      "Library/House Style.md": "Widgets stay small.",
    },
  });

  test("pages read content pages by default; Tool and All switch the scope", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await editQuery(page);
    const scope = page.getByRole("radiogroup", { name: "Which pages" });
    const results = page.getByRole("region", { name: "Results" });
    const bar = page.getByRole("region", { name: "Query" });
    await bar.getByRole("button", { name: "Show" }).click();
    const code = bar.locator(".sb-wbq-code");

    await expect(scope.getByRole("radio", { name: "Content" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(code).toContainText("index.contentPages()");
    await expect(results).toContainText("Garden Notes");
    await expect(results).not.toContainText("House Style");

    await scope.getByRole("radio", { name: "Tool" }).click();
    await expect(code).toContainText("index.toolPages()");
    await expect(results).toContainText("House Style");
    await expect(results).not.toContainText("Garden Notes");

    await scope.getByRole("radio", { name: "All" }).click();
    await expect(code).toContainText("index.pages()");
  });
});

test.describe("query builder tag filter", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Books/Piranesi.md":
        "---\ntags: book\nauthor: Susanna Clarke\n---\nHalls.",
      "People/Sam.md": "---\ntags: person\n---\nSam.",
    },
  });

  test("typing filters the tag list, Enter picks the first match", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Workbench: Data");
    const tags = page.getByRole("navigation", { name: "Tags" });
    const rows = tags.locator("[aria-pressed]");
    const filter = page.getByRole("searchbox", { name: "Filter tags" });
    await filter.fill("boo");
    await expect(rows).toHaveText([/^book/]);
    await filter.press("Enter");
    await expect(page.getByRole("region", { name: "Results" })).toContainText(
      "Susanna Clarke",
    );
    await filter.fill("nothing like it");
    await expect(tags).toContainText("No tags match");
    await filter.press("Escape");
    await expect(filter).toHaveValue("");
    await expect(tags.getByRole("button", { name: /^person/ })).toBeVisible();
    // Pinned page and task first, then your tags by schema, built-ins collapsed last
    await expect(rows.nth(0)).toHaveText(/^page/);
    await expect(rows.nth(1)).toHaveText(/^task/);
    await expect(tags.locator(".sb-wbd-section")).toHaveText([
      /^Defined/,
      /^No schema/,
      /^Built-in/,
    ]);
    const builtIn = tags.getByRole("button", { name: /^Built-in/ });
    await expect(builtIn).toHaveAttribute("aria-expanded", "false");
    await expect(tags.getByRole("button", { name: /^item/ })).toBeHidden();
    await builtIn.click();
    await expect(tags.getByRole("button", { name: /^item/ })).toBeVisible();
  });

  test("a tag added while the Data tab is open shows without a reload", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Workbench: Data");
    const tags = page.getByRole("navigation", { name: "Tags" });
    await expect(tags.getByRole("button", { name: /^book/ })).toBeVisible();
    await expect(tags.getByRole("button", { name: /^poem/ })).toBeHidden();
    await writeFile(
      join(sbServer.spaceDir, "Ozymandias.md"),
      "---\ntags: poem\nauthor: Percy Shelley\n---\nTwo vast and trunkless legs.",
    );
    await expect(tags.getByRole("button", { name: /^poem/ })).toBeVisible();
  });

  test("Workbench: Schema opens the Data tab on the schema view", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Workbench: Schema");
    await expect(
      page
        .getByRole("radiogroup", { name: "View" })
        .getByRole("radio", { name: "Schema" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("the header's schema state opens the Schema view", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Workbench: Data");
    const tags = page.getByRole("navigation", { name: "Tags" });
    const schemaView = page
      .getByRole("radiogroup", { name: "View" })
      .getByRole("radio", { name: "Schema" });
    await tags.getByRole("button", { name: /^book/ }).click();
    await page.getByRole("button", { name: "no schema", exact: true }).click();
    await expect(schemaView).toHaveAttribute("aria-checked", "true");
    await page
      .getByRole("radiogroup", { name: "View" })
      .getByRole("radio", { name: "Objects" })
      .click();
    await tags.getByRole("button", { name: /^page/ }).click();
    await page
      .getByRole("button", { name: "built-in schema", exact: true })
      .click();
    await expect(schemaView).toHaveAttribute("aria-checked", "true");
  });

  test("pinning a tag moves it to the top and survives a reload", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Workbench: Data");
    const tags = page.getByRole("navigation", { name: "Tags" });
    await tags.getByRole("button", { name: /^book/ }).hover();
    await tags.getByRole("button", { name: "Pin book" }).click();
    const rows = tags.locator("[aria-pressed]");
    await expect(rows.nth(2)).toHaveText(/^book/);
    await expect
      .poll(() =>
        readFile(join(sbServer.spaceDir, "Library", "Config.md"), "utf8").catch(
          () => "",
        ),
      )
      .toMatch(
        /config\.set\("workbench\.pinnedTags", \{\s*"page",\s*"task",\s*"book",?\s*\}\)/,
      );
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Workbench: Data");
    await expect(rows.nth(2)).toHaveText(/^book/);
  });
});

test.describe("query builder clauses", () => {
  // Made-up tasks, plus a page to insert into
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Dashboard.md": "Before",
      "Work.md": [
        "- [ ] Send quarterly report [due: 2026-10-21]",
        "- [ ] Update team wiki [due: 2026-10-12]",
        "- [x] Draft talk outline [due: 2026-10-10]",
        "- [ ] Renew passport [due: 2026-11-14]",
        "- [ ] Fix bike brakes",
      ].join("\n"),
    },
  });

  async function addFilter(
    page: Page,
    attribute: string,
    op: string,
    value?: string,
  ) {
    const where = page.getByRole("group", { name: "Where" });
    await where.getByRole("button", { name: "+ Filter" }).click();
    await where.getByLabel("Attribute").selectOption(attribute);
    await where.getByLabel("Operator").selectOption({ label: op });
    if (value !== undefined) await where.getByLabel("Value").fill(value);
    await where.getByRole("button", { name: "Add filter" }).click();
  }

  test("query builder inserts a filtered, ordered table at the cursor", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Dashboard");
    await page.locator("#sb-editor .cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await editQuery(page, /^task\b/);

    await addFilter(page, "done", "is false");
    await addFilter(page, "due", "before", "2026-11-01");

    const orderBy = page.getByRole("group", { name: "Order By" });
    await orderBy.getByRole("button", { name: "+ Order by" }).click();
    await orderBy.getByLabel("Attribute").selectOption("due");
    await orderBy.getByRole("button", { name: "Add" }).click();

    // Keep only the name, due and page columns
    const select = page.getByRole("group", { name: "Select" });
    const keep = ["Column name", "Column due", "Column page"];
    for (;;) {
      const labels = await select
        .getByRole("group", { name: /^Column / })
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      const extra = labels.find((l) => l && !keep.includes(l));
      if (!extra) break;
      await select
        .getByRole("group", { name: extra, exact: true })
        .getByRole("button", { name: "Remove column" })
        .click();
    }
    await select.getByLabel("Kind of column page").selectOption("link");

    await page
      .getByRole("region", { name: "Query" })
      .getByRole("button", { name: "Insert at cursor" })
      .click();

    // Move the cursor off the expression so it renders
    await page.locator("#sb-editor .cm-line").first().click();
    const table = page.locator("#sb-editor table").first();
    await expect(table.locator("th")).toHaveText(["name", "page", "due"]);
    await expect(table.locator("tbody tr").first()).toContainText(
      "Update team wiki",
    );
    await expect(table.locator("tbody tr")).toHaveCount(2);
  });

  test("slash command opens the Query tab and inserts where it was typed", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Dashboard");
    await page.locator("#sb-editor .cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/Query");
    await page
      .locator(".cm-tooltip-autocomplete li", { hasText: "Query…" })
      .click();
    const bar = page.getByRole("region", { name: "Query" });
    await expect(bar).toContainText(
      "Insert at cursor goes where you typed /Query… on Dashboard.",
    );
    // Typed to build a query, so the query editor shows straight away
    await expect(page.getByRole("group", { name: "Where" })).toBeVisible();
    // Edit the page above that spot first: the query still goes where
    // /Query… was typed
    await page.locator("#sb-editor .cm-line").first().click();
    await page.keyboard.press("Home");
    await page.keyboard.type("Top ");
    await bar.getByRole("button", { name: "Insert at cursor" }).click();
    const text = await page.evaluate(() =>
      (globalThis as any).client.editorView.state.doc.toString(),
    );
    expect(text.startsWith("Top Before\n${query[[")).toBe(true);
    await expect(bar).not.toContainText("Insert at cursor goes where");
  });

  test("editing one expression filter after another shows each one's text", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await editQuery(page, /^task\b/);
    const where = page.getByRole("group", { name: "Where" });
    for (const expr of ["t.done", "not t.done"]) {
      await where.getByRole("button", { name: "+ Expression" }).click();
      await where.getByLabel("Expression").click();
      await page.keyboard.type(expr);
      await where.getByRole("button", { name: "Add filter" }).click();
    }
    const pills = where.locator(".sb-wbq-pill-body");
    await pills.nth(0).click();
    await expect(where.getByLabel("Expression")).toHaveText("t.done");
    await pills.nth(1).click();
    await expect(where.getByLabel("Expression")).toHaveText("not t.done");
  });

  test("removing an expression column leaves the next one's text", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await editQuery(page, /^task\b/);
    const columns = page
      .getByRole("group", { name: "Select" })
      .getByRole("group", { name: /^Column / });
    // The first column's text passes through the second one's on the way
    for (const [i, text] of [
      [0, "t.done"],
      [1, "t.d"],
    ] as const) {
      const column = columns.nth(i);
      await column.getByLabel(/^Kind of column/).selectOption("expr");
      await column.getByLabel("Column expression").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(text);
      await page.keyboard.press("Escape");
    }
    await columns.nth(0).getByRole("button", { name: "Remove column" }).click();
    await expect(columns.nth(0).getByLabel("Column expression")).toHaveText(
      "t.d",
    );
  });

  test("an expression with a syntax error shows the error and still copies", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await editQuery(page, /^task\b/);
    const where = page.getByRole("group", { name: "Where" });
    await where.getByRole("button", { name: "+ Expression" }).click();
    await where.getByLabel("Expression").click();
    await page.keyboard.type("t.name == (");
    await where.getByRole("button", { name: "Add filter" }).click();
    await expect(
      page.getByRole("region", { name: "Results" }).locator(".sb-wb-message"),
    ).toBeVisible();
    await page
      .getByRole("region", { name: "Query" })
      .getByRole("button", { name: "Copy" })
      .click();
    await expect(page.getByText("Copied")).toBeVisible();
  });
});

test.describe("query builder attributes", () => {
  // Made-up books; one rating is text, so rating is mixed
  const book = (author: string, status: string, rating?: string) =>
    `---\ntags: book\nauthor: ${author}\nstatus: ${status}\n${rating ? `rating: ${rating}\n` : ""}---\nNotes.`;
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Books/Piranesi.md": book("Susanna Clarke", "finished", "4"),
      "Books/Klara and the Sun.md": book("Kazuo Ishiguro", "finished", "3"),
      "Books/Project Hail Mary.md": book("Andy Weir", "finished", "4"),
      "Books/The Overstory.md": book("Richard Powers", "reading"),
      "Books/A Psalm for the Wild-Built.md": book(
        "Becky Chambers",
        "reading",
        "loved it",
      ),
    },
  });

  test("from pages narrowed to a tag, Open #tag selects that tag", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await editQuery(page, /^book/);
    const view = page.getByRole("radiogroup", { name: "View" });
    // From pages narrowed to #book, the tag itself is one click away
    const tags = page.getByRole("navigation", { name: "Tags" });
    await tags.getByRole("button", { name: /^page/ }).click();
    await view.getByRole("radio", { name: "Objects" }).click();
    await page.getByLabel("tagged").selectOption("book");
    await page.getByRole("button", { name: "Open #book" }).click();
    await expect(tags.getByRole("button", { name: /^book/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("switching tag offers undo", async ({ page, sbServer }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await editQuery(page, /^book/);
    const tags = page.getByRole("navigation", { name: "Tags" });
    const where = page.getByRole("group", { name: "Where" });
    await where.getByRole("button", { name: "+ Expression" }).click();
    await where.getByLabel("Expression").click();
    await page.keyboard.type('b.status == "reading"');
    await where.getByRole("button", { name: "Add filter" }).click();
    // Picking the tag that's already picked changes nothing
    await tags.getByRole("button", { name: /^book/ }).click();
    await expect(where).toContainText('b.status == "reading"');
    await tags.getByRole("button", { name: /^page/ }).click();
    await expect(page.getByText("Cleared the query for #book")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(where).toContainText('b.status == "reading"');
  });
});

test.describe("query builder round trip", () => {
  // Made-up tasks, and a page with a query on them
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Work.md": [
        "- [ ] Send quarterly report [due: 2026-10-21]",
        "- [ ] Update team wiki [due: 2026-10-12]",
        "- [x] Draft talk outline [due: 2026-10-10]",
        "- [ ] Renew passport [due: 2026-11-14]",
      ].join("\n"),
      "Dashboard.md": [
        "Open work",
        '${query[[from t = index.tag "task" where not t.done order by t.due select { Task = t.name }]]}',
        "After",
      ].join("\n"),
    },
  });

  test("a query on the page opens in the builder and is updated in place", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Dashboard");
    const widget = page.locator("#sb-editor table").first();
    await expect(widget.locator("tbody tr")).toHaveCount(3);
    await openWidgetMenu(
      page,
      page.locator("#sb-editor .sb-lua-directive-block").first(),
    );
    await page.getByRole("menuitem", { name: "Edit in query builder" }).click();

    // The query's parts are the builder's controls again
    const where = page.getByRole("group", { name: "Where" });
    await expect(where).toContainText("done");
    await expect(where).toContainText("is false");
    await expect(page.getByRole("group", { name: "Order By" })).toContainText(
      "due",
    );
    const bar = page.getByRole("region", { name: "Query" });
    await expect(bar).toContainText(
      "Update page replaces the query you opened on Dashboard.",
    );

    await page
      .getByRole("group", { name: "Limit" })
      .getByLabel("Limit")
      .fill("2");
    await bar.getByRole("button", { name: "Update page" }).click();
    const text = await docText(page);
    expect(text.startsWith("Open work\n${query[[")).toBe(true);
    expect(text.endsWith("]]}\nAfter")).toBe(true);
    expect(text.match(/query\[\[/g)).toHaveLength(1);
    expect(text).toContain("limit 2");
    // Still bound to the page's query: a second change updates it again
    await page
      .getByRole("group", { name: "Limit" })
      .getByLabel("Limit")
      .fill("1");
    await bar.getByRole("button", { name: "Update page" }).click();
    const again = await docText(page);
    expect(again.match(/query\[\[/g)).toHaveLength(1);
    expect(again).toContain("limit 1");
    expect(again.endsWith("]]}\nAfter")).toBe(true);
  });

  test("a query the builder can't show says why", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Dashboard");
    await page.locator("#sb-editor .cm-content").click();
    // Replace the query with one that has an offset
    await page.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      const doc: string = view.state.doc.toString();
      const from = doc.indexOf("${");
      const to = doc.indexOf("}\nAfter") + 1;
      view.dispatch({
        changes: {
          from,
          to,
          insert: '${query[[from t = index.tag "task" limit 1 offset 1]]}',
        },
        selection: { anchor: from + 5 },
      });
    });
    await runCommandViaPalette(page, "Workbench: Edit Query");
    await expect(page.locator(".sb-notifications")).toContainText(
      "The builder has no offset",
    );
  });
});

test.describe("query builder list templates", () => {
  // Made-up tasks, and a template of the space's own, documented
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Work.md": "- [ ] Send quarterly report\n- [ ] Update team wiki",
      "Library/My Templates.md": [
        "```space-lua",
        "--- A task and nothing else.",
        "--- @param t task",
        'templates.bareTask = template.new("* ${name}")',
        "```",
      ].join("\n"),
    },
  });

  test("lists the space's templates with their descriptions, the ones for the tag first", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await editQuery(page, /^task\b/);
    const select = page.getByRole("group", { name: "Select" });
    await select.getByRole("radio", { name: "List" }).click();
    const options = await select
      .getByLabel("Template")
      .locator("option")
      .allTextContents();
    // Named in full, the two that take tasks first, then the rest
    expect(options.slice(0, 2)).toEqual([
      "templates.bareTask",
      "templates.taskItem",
    ]);
    expect(options).toContain("templates.pageItem");
    expect(options.at(-1)).toBe("Custom template…");
    await expect(select.getByLabel("Template")).toHaveValue(
      "templates.bareTask",
    );
    // The chosen one's description, and a way to its definition
    await expect(select).toContainText("A task and nothing else.");
    await select.getByLabel("Template").selectOption("templates.taskItem");
    await expect(select).toContainText(
      "Renders a task as a togglable task, linked to where it is.",
    );
    await select.getByLabel("Template").selectOption("templates.bareTask");
    await expect(page.getByRole("region", { name: "Results" })).toContainText(
      "Update team wiki",
    );
    await select.getByRole("button", { name: "Go to definition" }).click();
    await expect(page).toHaveURL(/My%20Templates/);
    // The cursor lands on the assignment, once the page is open
    await expect
      .poll(() =>
        page.evaluate(() => {
          const view = (globalThis as any).client.editorView;
          return view.state.doc.lineAt(view.state.selection.main.head).text;
        }),
      )
      .toBe('templates.bareTask = template.new("* ${name}")');
  });

  test("completion shows a template's description", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await page.locator("#sb-editor .cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n${templates.bareT");
    await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
      "bareTask",
    );
    await expect(page.locator(".cm-completionInfo")).toContainText(
      "A task and nothing else.",
    );
  });
});

test.describe("query builder refresh", () => {
  test.use({
    spaceFiles: { "index.md": "Welcome", "Notes.md": "Some notes." },
  });

  test("results follow the space's scripts as they load", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await editQuery(page);
    const where = page.getByRole("group", { name: "Where" });
    await where.getByRole("button", { name: "+ Expression" }).click();
    await where.getByLabel("Expression").click();
    await page.keyboard.type("isNotes(p)");
    await where.getByRole("button", { name: "Add filter" }).click();
    const results = page.getByRole("region", { name: "Results" });
    // Not defined yet
    await expect(results).toContainText("isNotes");
    await mkdir(join(sbServer.spaceDir, "Library"), { recursive: true });
    await writeFile(
      join(sbServer.spaceDir, "Library/Lib.md"),
      '```space-lua\nfunction isNotes(p) return p.name == "Notes" end\n```\n',
    );
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const client = (globalThis as any).client;
          await client.clientSystem.loadLuaScripts();
          // A missing global reads as null
          return client.clientSystem.spaceLuaEnv.env.get("isNotes") != null;
        }),
      )
      .toBe(true);
    // The query runs again with the function there, unchanged
    await expect(results).toContainText("1 result");
    await expect(results).toContainText("Notes");
    await expect(where).toContainText("isNotes(p)");
  });
});

test.describe("overview and maintenance", () => {
  test.use({
    spaceFiles: {
      "index.md": "See [[Missing Placeholder]] #idea\n\n- [ ] Open task #idea",
      "Broken.md": "---\ntags: [unclosed\n---\nBody",
      // A space-lua block without a priority comment must pass the space-wide lint
      "Script.md": '```space-lua\nlocal greeting = "hi"\n```',
    },
  });

  test("workbench opens on Overview; Maintenance lists a broken link and the space-wide lint finds bad YAML", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "index");
    await runCommandViaPalette(page, "Workbench: Toggle");
    const visibleTab = page.locator(".sb-wb-tab:not([hidden])");
    const tabs = page.getByRole("radiogroup", { name: "Tabs" });
    await expect(
      tabs.getByRole("radio", { name: /^Overview/ }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      visibleTab
        .locator(".sb-wbo-card", { hasText: "Pages" })
        .locator(".sb-wbo-value"),
    ).toHaveText("3");

    await visibleTab
      .getByRole("button", { name: "Show open tasks in Data" })
      .click();
    await expect(tabs.getByRole("radio", { name: /^Data/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Tags" })
        .getByRole("button", { name: /^task\b/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "Where" })).toContainText(
      "done",
    );
    await tabs.getByRole("radio", { name: /^Overview/ }).click();

    // #idea is both a page tag and a task tag here: two tag objects, one row
    await page.getByRole("button", { name: "Show all tags in Data" }).click();
    await expect(
      page.getByRole("region", { name: "Results" }).getByText("idea", {
        exact: true,
      }),
    ).toHaveCount(1);
    await tabs.getByRole("radio", { name: /^Overview/ }).click();

    await runCommandViaPalette(page, "Workbench: Maintenance");
    await expect(
      tabs.getByRole("radio", { name: /^Maintenance/ }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(visibleTab).toContainText("Missing Placeholder");

    await visibleTab
      .getByRole("button", { name: "Run space-wide lint" })
      .click();
    const deep = visibleTab.getByRole("region", { name: "Space-wide lint" });
    const row = deep.locator(".sb-wbm-row", { hasText: "Broken" });
    await expect(row).toBeVisible();
    await expect(
      deep.locator(".sb-wbm-row", { hasText: "Script" }),
    ).toHaveCount(0);
    await expect(row).toBeVisible();
    await row.click();
    // Only the page, not the cursor line: line/column navigation is imprecise
    await expect(page).toHaveURL(/\/Broken(?:[:@#]|$)/);
  });
});
