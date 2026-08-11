import type { FrameLocator, Page } from "@playwright/test";
import { expect, gotoSilverBulletPage, mod, test } from "./fixtures.ts";
import {
  closePicker,
  currentPage,
  expectNavInputFocused,
  expectNavRow,
  NAV_MODAL_IFRAME,
  navFrame,
  navInput,
  navigateViaPagePicker,
  navRows,
  navSegment,
  openPicker,
  runCommandViaPalette,
} from "./navigator-ui.ts";

// Item 11 (polish round): a tree-mode view exercising the same three
// row-decorating mechanisms the list pickers get for free (a key-hint-style
// chip, a tag chip, and phrase-driven `<mark>` highlighting) -- `std.spaceTree`
// itself renders no decorations at all, so there is no shipped tree view to
// borrow this coverage from the way the list case borrows the command palette
// and the page picker.
const ROW_HEIGHT_TREE_CONFIG = `# Row height tree test
\`\`\`space-lua
navigator.define {
  name = "rowheighttree",
  title = "Row Height Tree",
  command = "Debug: Row Height Tree",
  dock = "modal",
  presentation = {
    mode = "tree",
    row = {
      decorations = function(obj)
        if obj.kind == "hint" then
          return {{ text = "⌘K", position = "right", cssClass = "sb-nav-chip-hint sb-nav-chip-key" }}
        end
        if obj.kind == "tag" then
          return {{ text = "#work", position = "right", cssClass = "sb-hashtag" }}
        end
        return nil
      end,
    },
  },
  source = function()
    return {
      { name = "HintRow", ref = "HintRow", kind = "hint" },
      { name = "TagRow", ref = "TagRow", kind = "tag" },
      { name = "PlainRow", ref = "PlainRow", kind = "plain" },
    }
  end,
}
\`\`\`
`;

const SPACE = {
  "index.md": "Welcome",
  "RowHeightTree.md": ROW_HEIGHT_TREE_CONFIG,
  // An anchor to jump to, and a link to a page that doesn't exist (an
  // aspiring page).
  // The second aspiring link is deliberately far too long for a narrow modal:
  // it is the row where the name and the `Create` chip compete for the width.
  "Projects/Alpha.md":
    "# Alpha\n\nSee [[Nowhere Page]] and [[Catalog/Quarterly Planning Retrospective Notes And Follow Ups]].\n\n$intro\nThe introduction paragraph.\n",
  "Projects/Beta.md": "# Beta\n",
  "Tagged.md": "---\ntags: work\n---\n\nTagged content.\n",
  // A long name paired with a long description: the pair the narrow-viewport
  // test measures.
  "Schema Attributes Compendium.md":
    "---\ndescription: A long description that competes with the name for row width.\n---\nBody\n",
  // A *short* name paired with a description that alone is still long enough
  // to want more room than the row has -- the pair that catches a name
  // truncating when it shouldn't (item 9, polish round): a name this short
  // was never close to its own overflow point, so any of it clipping at all
  // means the description crowded it, not genuine lack of room.
  "Zap.md":
    "---\ndescription: A description on its own long enough to want more width than a narrow row has to give.\n---\nBody\n",
  "Settings Page.md": "---\ntags: meta\n---\n\nA meta page.\n",
  // Any non-markdown file is a document; `.bin` has no document editor
  // registered, which is what makes it the unopenable case.
  "assets/notes.bin": "not markdown",
  "Templates/Zeta.md":
    "---\ndescription: A test template\ntags: meta/template/page\n---\n\nTemplated body.\n",
  "Journal/2026-08-07.md": "---\ntags: journal\n---\n\nA journal entry.\n",
  // Every shape the outline has to survive: nesting, an H1 -> H3 jump with no
  // H2 between them, a "/" inside a header, and two identical siblings.
  "Outline Page.md": [
    "Intro.",
    "",
    "# Getting started",
    "Text.",
    "",
    "## Install",
    "Text.",
    "",
    "### macOS",
    "Text.",
    "",
    "## Pros/Cons",
    "Text.",
    "",
    "# Reference",
    "Text.",
    "",
    "### Skipped",
    "Text.",
    "",
    "## Install",
    "Text.",
    "",
  ].join("\n"),
  // Deliberately the same header *paths* as the page above, with a child of
  // its own: what an outline collapse on one page must not reach.
  "Outline Other.md": [
    "# Getting started",
    "Text.",
    "",
    "## Install",
    "Text.",
    "",
    "### Elsewhere",
    "Text.",
    "",
  ].join("\n"),
};

test.use({ spaceFiles: SPACE });

test("Cmd-k opens the page picker, on its Pages segment", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(frame, "Projects/Alpha");

  // Pages is the default segment -- a picker is opened to find a page.
  await expect(navSegment(frame, "Pages")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // ...and the other three are there, with no row count -- segments no
  // longer carry one.
  for (const label of ["Meta", "Docs", "All"]) {
    await expect(navSegment(frame, label)).toBeVisible();
  }
  await expect(navSegment(frame, "Pages")).toHaveText("Pages");

  // The Pages segment is content pages only: no meta page, no document.
  const listed = await navRows(frame).allInnerTexts();
  expect(listed).toContain("Projects/Alpha");
  expect(listed).not.toContain("Settings Page");
  expect(listed).not.toContain("assets/notes.bin");
});

test("Enter opens the selected page and dismisses the picker", async ({
  sbPage,
}) => {
  await openPicker(sbPage, `${mod}+k`, "Page");
  await navInput(sbPage).fill("Projects/Beta");
  await expect(navRows(navFrame(sbPage)).first()).toHaveText("Projects/Beta");
  await sbPage.keyboard.press("Enter");
  await expect(currentPage(sbPage)).toHaveValue("Projects/Beta");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
});

test("Cmd-Shift-k and the document picker command open the same view on another segment", async ({
  sbPage,
}) => {
  let frame = await openPicker(sbPage, `${mod}+Shift+k`, "Meta page");
  await expect(navSegment(frame, "Meta")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expectNavRow(frame, "Settings Page");
  await closePicker(sbPage);

  // "Navigate: Document Picker" is keyless -- reached through the palette
  // like any other unbound command.
  await runCommandViaPalette(sbPage, "Navigate: Document Picker");
  frame = navFrame(sbPage);
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Document",
    { timeout: 20_000 },
  );
  await expect(navSegment(frame, "Docs")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expectNavRow(frame, "assets/notes.bin");
});

test("opening on a segment doesn't become the segment it opens on", async ({
  sbPage,
}) => {
  // The remembered segment is a user choice; a command that asks for one is
  // not making that choice on their behalf.
  await openPicker(sbPage, `${mod}+Shift+k`, "Meta page");
  await expect(navSegment(navFrame(sbPage), "Meta")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await closePicker(sbPage);

  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expect(navSegment(frame, "Pages")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("^ activates the Meta segment from an empty phrase", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(frame, "Projects/Alpha");

  await sbPage.keyboard.press("^");
  await expect(navSegment(frame, "Meta")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // Dropped, not typed.
  await expect(navInput(sbPage)).toHaveValue("");
  await expectNavRow(frame, "Settings Page");

  // Backspace on an empty phrase goes back to the default segment.
  await navInput(sbPage).press("Backspace");
  await expect(navSegment(frame, "Pages")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("a document with no editor is listed last, and greyed", async ({
  sbPage,
}) => {
  // The document picker command is keyless; reached through the palette.
  await runCommandViaPalette(sbPage, "Navigate: Document Picker");
  const frame = navFrame(sbPage);
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Document",
    { timeout: 20_000 },
  );
  await expectNavRow(frame, "assets/notes.bin");
  const chip = frame
    .locator(".sb-nav-row", { hasText: "assets/notes.bin" })
    .locator(".sb-nav-chip");
  await expect(chip).toHaveText("BIN");
  await expect(chip).toHaveClass(/sb-nav-chip-inactive/);
});

test("an aspiring page is offered as a row that creates it", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await navInput(sbPage).fill("Nowhere");
  const row = frame.locator(".sb-nav-row", { hasText: "Nowhere Page" }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toHaveClass(/sb-nav-aspiring/);
  const chip = row.locator(".sb-nav-chip");
  await expect(chip).toHaveText("Create");
  await expect(chip).toHaveClass(/sb-nav-chip-hint/);

  await sbPage.keyboard.press("Enter");
  await expect(currentPage(sbPage)).toHaveValue("Nowhere Page");
});

test("a selected aspiring row takes the selection's foreground", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await navInput(sbPage).fill("Nowhere");
  await expect(frame.locator(".sb-nav-row.sb-nav-aspiring")).toBeVisible({
    timeout: 20_000,
  });
  await expect(async () => {
    const selected = await frame
      .locator(".sb-nav-selected")
      .evaluate((el) => el.className);
    expect(selected).toContain("sb-nav-aspiring");
  }).toPass({ timeout: 10_000 });

  const colors = await frame
    .locator(".sb-nav-row")
    .first()
    .evaluate(() => {
      const doc = document;
      return {
        aspiring: getComputedStyle(
          doc.querySelector(
            ".sb-nav-selected.sb-nav-aspiring .sb-nav-primary",
          )!,
        ).color,
        selectionToken: getComputedStyle(doc.querySelector(".sb-nav-selected")!)
          .color,
        // Italic survives the selection; only the colour yields.
        fontStyle: getComputedStyle(
          doc.querySelector(
            ".sb-nav-selected.sb-nav-aspiring .sb-nav-primary",
          )!,
        ).fontStyle,
      };
    });
  expect(colors.aspiring).toBe(colors.selectionToken);
  expect(colors.fontStyle).toBe("italic");
});

test("$ routes to the anchor picker, which navigates page-qualified", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(frame, "Projects/Alpha");

  await sbPage.keyboard.press("$");
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Anchor",
  );
  await expectNavRow(frame, "intro");
  // The page it lives on, which is what tells two same-named anchors apart.
  await expect(
    frame.locator(".sb-nav-row", { hasText: "intro" }).first(),
  ).toContainText("Projects/Alpha");

  await sbPage.keyboard.press("Enter");
  await expect(currentPage(sbPage)).toHaveValue("Projects/Alpha");
});

test("# routes to the tag picker, which hands the picker back filtered", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(frame, "Projects/Alpha");

  await sbPage.keyboard.press("#");
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Tag",
  );
  await expectNavRow(frame, "work");

  // Picked from a picker, a tag means "narrow that picker to this tag" --
  // what a leading `#` used to do in place.
  await navInput(sbPage).fill("work");
  await expect(navRows(frame).first()).toHaveText("work");
  await sbPage.keyboard.press("Enter");

  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Page",
  );
  await expect(navInput(sbPage)).toHaveValue("#work ");
  await expect(navRows(frame)).toHaveText(["Tagged"]);
  // The panel is still up: the round trip must not have been closed out from
  // under itself by the selection that started it.
  await expect(sbPage.locator(".sb-modal")).toBeVisible();
});

test("Ctrl-Alt-t opens the tag picker on its own, and opens tag pages", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, "Control+Alt+t", "Tag");
  await expectNavRow(frame, "work");
  // Counted off the index, one record per tagged thing.
  await expect(
    frame.locator(".sb-nav-row", { hasText: "work" }).first(),
  ).toContainText("1");

  await navInput(sbPage).fill("work");
  await sbPage.keyboard.press("Enter");
  // No invoking picker to hand back to: the tag's page, as before.
  await expect(currentPage(sbPage)).toHaveValue("tag:work");
});

test("Cmd-/ opens the command palette, with key hints, and runs a command", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+/`, "Command");
  await expectNavRow(frame, "Navigate: Page Picker");

  // The binding the row would run under, drawn in the same right-aligned hint
  // slot the create affordance uses -- flush with the row's edge, at the row's
  // own type size, not inline after the name.
  const keyChip = frame
    .locator(".sb-nav-row", { hasText: "Navigate: Page Picker" })
    .first()
    .locator(".sb-nav-chip-key");
  await expect(keyChip).toBeVisible();
  await expect(keyChip).toHaveClass(/sb-nav-chip-hint/);
  const hint = await frame
    .locator(".sb-nav-row", { hasText: "Navigate: Page Picker" })
    .first()
    .evaluate((el) => {
      const chip = el.querySelector(".sb-nav-chip-key") as HTMLElement;
      const primary = el.querySelector(".sb-nav-primary") as HTMLElement;
      return {
        gapToRowEdge:
          el.getBoundingClientRect().right -
          parseFloat(getComputedStyle(el).paddingRight) -
          chip.getBoundingClientRect().right,
        sameFontSize:
          getComputedStyle(chip).fontSize ===
          getComputedStyle(primary).fontSize,
      };
    });
  expect(Math.abs(hint.gapToRowEdge)).toBeLessThan(1.5);
  expect(hint.sameFontSize).toBe(true);

  await navInput(sbPage).fill("Navigate: Anything Picker");
  await expect(navRows(frame).first()).toHaveText("Navigate: Anything Picker");
  await sbPage.keyboard.press("Enter");
  // The command ran: the palette is gone and the picker it opens is up, on
  // the segment that command asks for.
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Page or document",
    { timeout: 20_000 },
  );
  await expect(navSegment(frame, "All")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("the palette can run a command that opens another picker", async ({
  sbPage,
}) => {
  // The palette dismisses itself before the command runs; otherwise its own
  // dismissal would close the panel the command just opened.
  const frame = await openPicker(sbPage, `${mod}+/`, "Command");
  await navInput(sbPage).fill("Navigate: Page Picker");
  await expect(navRows(frame).first()).toHaveText("Navigate: Page Picker");
  await sbPage.keyboard.press("Enter");

  await expect(navFrame(sbPage).locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Page",
    { timeout: 20_000 },
  );
  await expect(sbPage.locator(".sb-modal")).toBeVisible();

  // ...and the picker actually has the focus. The command returns false to
  // say "I took it"; a palette that dropped that return value would call
  // editor.focus() here and race the panel for it, leaving a picker you have
  // to click before you can type into.
  await expectNavInputFocused(sbPage);
  await sbPage.keyboard.type("Beta", { delay: 20 });
  await expect(navInput(sbPage)).toHaveValue("Beta");
});

test("a command that keeps its own focus keeps it through the palette", async ({
  sbPage,
}) => {
  // `Editor: Find in Page` returns false with the comment "keep focus on
  // search panel, not the editor". The key-binding path honours that; so must
  // the palette.
  const frame = await openPicker(sbPage, `${mod}+/`, "Command");
  await navInput(sbPage).fill("Editor: Find in Page");
  await expect(navRows(frame).first()).toHaveText("Editor: Find in Page");
  await sbPage.keyboard.press("Enter");

  const search = sbPage.locator(".cm-search input[main-field]");
  await expect(search).toBeVisible({ timeout: 20_000 });
  await expect(search).toBeFocused();
  // Not the editor: typing goes into the search box.
  await sbPage.keyboard.type("needle", { delay: 20 });
  await expect(search).toHaveValue("needle");
});

test("a throwing command is reported instead of vanishing", async ({
  sbPage,
}) => {
  // Without `client.reportError` wrapping the run, the rejection escapes
  // into a fire-and-forget dispatch: the palette disappears, nothing says
  // why, and focus is left nowhere.
  await sbPage.evaluate(() => {
    (globalThis as any).client.clientSystem.commandHook.registerCommand({
      name: "Test: Explode",
      run: () => Promise.reject(new Error("kaboom")),
    });
  });

  const frame = await openPicker(sbPage, `${mod}+/`, "Command");
  await navInput(sbPage).fill("Test: Explode");
  await expect(navRows(frame).first()).toHaveText("Test: Explode", {
    timeout: 20_000,
  });
  await sbPage.keyboard.press("Enter");

  // `Error: kaboom`, from `client.reportError` -- the path that turns a Lua
  // error into a navigation to its source. (The navigator's own handler
  // wrapper would say "navigator onSelect: ..." instead, which is the
  // fallback, not this.)
  await expect(sbPage.locator(".sb-notifications")).toContainText(
    "Error: kaboom",
    { timeout: 20_000 },
  );
  // ...and the palette is gone rather than hanging open.
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
});

test("the palette re-orders by what was last run", async ({ sbPage }) => {
  const frame = await openPicker(sbPage, `${mod}+/`, "Command");
  await navInput(sbPage).fill("Navigate: Center Cursor");
  await expect(navRows(frame).first()).toHaveText("Navigate: Center Cursor");
  await sbPage.keyboard.press("Enter");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  // Re-opening asks again (refreshOnOpen), and what was just run leads.
  await openPicker(sbPage, `${mod}+/`, "Command");
  await expect(navRows(frame).first()).toHaveText("Navigate: Center Cursor", {
    timeout: 20_000,
  });
});

test("Ctrl-q t picks a template, then asks for the page name", async ({
  sbPage,
}) => {
  // A CodeMirror chord: Ctrl-q, then t.
  await sbPage.keyboard.press("Control+q");
  const frame = await openPicker(sbPage, "t", "Filter");
  // The space's own template has to be *in* the list before it can lead it:
  // until indexing delivers it, the only template here is the bundled one.
  await expectNavRow(frame, "Zeta");
  // The last path segment, not the library path it lives at.
  await navInput(sbPage).fill("Zeta");
  await expect(navRows(frame).first()).toHaveText("Zeta");
  // ...and the template's own description.
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Zeta" }).first(),
  ).toContainText("A test template");

  await sbPage.keyboard.press("Enter");
  // The chained prompt, which is the half of the old flow worth keeping.
  const prompt = sbPage.locator(".sb-modal-box input.sb-input");
  await expect(prompt).toBeVisible({ timeout: 20_000 });
  await prompt.fill("From Template");
  await sbPage.keyboard.press("Enter");
  await expect(currentPage(sbPage)).toHaveValue("From Template");
});

test("the journal picker is a tree over the journal folder", async ({
  sbPage,
}) => {
  await sbPage.keyboard.press(`${mod}+/`);
  const frame = navFrame(sbPage);
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Command",
    { timeout: 20_000 },
  );
  await navInput(sbPage).fill("Journal: Picker");
  await expect(navRows(frame).first()).toHaveText("Journal: Picker", {
    timeout: 20_000,
  });
  await sbPage.keyboard.press("Enter");

  await expect(frame.locator(".sb-nav-title")).toHaveText("Journal", {
    timeout: 20_000,
  });
  await expect(frame.locator(".sb-treeitem").first()).toBeVisible({
    timeout: 20_000,
  });
  await expectNavRow(frame, "Journal");
  // A picker has to open with something to pick: the entries are on screen
  // without expanding the folder first.
  await expectNavRow(frame, "2026-08-07");
});

test("the picker re-runs its source on every open", async ({
  sbPage,
  sbServer,
}) => {
  // Recency is a fact about now: the page you just visited has to be near the
  // top the next time you ask, not where it stood when the view first loaded.
  await openPicker(sbPage, `${mod}+k`, "Page");
  await navInput(sbPage).fill("Projects/Beta");
  await sbPage.keyboard.press("Enter");
  await expect(currentPage(sbPage)).toHaveValue("Projects/Beta");

  await gotoSilverBulletPage(sbPage, sbServer, "index");
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expect(navRows(frame).first()).toHaveText("Projects/Beta", {
    timeout: 20_000,
  });
});

test("Tab steps through the segments and never leaves the input", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  const input = navInput(sbPage);

  await input.press("Tab");
  await expect(navSegment(frame, "Meta")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await input.press("Tab");
  await expect(navSegment(frame, "Docs")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await input.press("Tab");
  await expect(navSegment(frame, "All")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // ...and wraps.
  await input.press("Tab");
  await expect(navSegment(frame, "Pages")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await input.press("Shift+Tab");
  await expect(navSegment(frame, "All")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // The whole point: focus never went anywhere.
  await expect(input).toBeFocused();
  await sbPage.keyboard.type("Alpha", { delay: 20 });
  await expect(input).toHaveValue("Alpha");
});

test("Tab is swallowed by a view with no segments", async ({ sbPage }) => {
  const frame = await openPicker(sbPage, "Control+Alt+t", "Tag");
  await expect(frame.locator(".sb-segment")).toHaveCount(0);
  const input = navInput(sbPage);
  await input.press("Tab");
  await expect(input).toBeFocused();
  await sbPage.keyboard.type("wo", { delay: 20 });
  await expect(input).toHaveValue("wo");
});

test("the create row sits second, under the best match", async ({ sbPage }) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(frame, "Projects/Alpha");

  // A phrase that still matches something: the match leads, create follows.
  await navInput(sbPage).fill("Projects/Alph");
  const primaries = frame.locator(".sb-nav-row .sb-nav-primary");
  await expect(primaries.nth(0)).toHaveText("Projects/Alpha");
  // Just the phrase -- the create row reads like any other row, and the
  // right-aligned chip below is what says it creates rather than opens.
  await expect(primaries.nth(1)).toHaveText("Projects/Alph");
  // It creates a page, and says so with the page icon and the same chip an
  // aspiring row carries.
  await expect(frame.locator(".sb-nav-create .sb-nav-icon svg")).toBeVisible();
  await expect(frame.locator(".sb-nav-create .sb-nav-chip-hint")).toHaveText(
    "Create",
  );

  // One ArrowDown is all it takes to create instead of open.
  await sbPage.keyboard.press("ArrowDown");
  await expect(frame.locator(".sb-nav-create")).toHaveClass(/sb-nav-selected/);

  // Selected, the chip sits on the accent fill rather than on the row surface
  // its own colours were paired against -- so it is re-paired with the
  // selection, exactly as the row's own foregrounds are.
  const chip = await frame
    .locator(".sb-nav-create .sb-nav-chip-hint")
    .evaluate((el) => {
      const row = el.closest(".sb-nav-row")!;
      return {
        chip: getComputedStyle(el).color,
        row: getComputedStyle(row).color,
      };
    });
  expect(chip.chip).toBe(chip.row);

  await sbPage.keyboard.press("Enter");
  await expect(currentPage(sbPage)).toHaveValue("Projects/Alph");
});

test("the create row is the only row when nothing matches", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await navInput(sbPage).fill("Zzzq Nothing");
  await expect(frame.locator(".sb-nav-row")).toHaveCount(1);
  await expect(frame.locator(".sb-nav-create")).toHaveClass(/sb-nav-selected/);
});

test("typing filters the anchor and tag pickers, with or without the sigil", async ({
  sbPage,
}) => {
  // The rows are named bare (the sigil is the icon's job), so both spellings
  // have to reach them -- and neither may come back empty.
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await sbPage.keyboard.press("$");
  await expectNavRow(frame, "intro");
  await navInput(sbPage).fill("intr");
  await expect(navRows(frame).first()).toHaveText("intro");
  // Ranking is against the phrase with the sigil stripped, and so is the
  // match highlighting -- typing the sigil must not blank the <mark> even
  // though it never appears in the row's own (bare) name.
  await expect(navRows(frame).first().locator("mark")).toBeVisible();
  await navInput(sbPage).fill("$intr");
  await expect(navRows(frame).first()).toHaveText("intro");
  await expect(navRows(frame).first().locator("mark")).toBeVisible();

  // The first Escape clears the phrase; the second closes the panel.
  await sbPage.keyboard.press("Escape");
  await closePicker(sbPage);

  await openPicker(sbPage, "Control+Alt+t", "Tag");
  await expectNavRow(navFrame(sbPage), "work");
  await navInput(sbPage).fill("wor");
  await expect(navRows(navFrame(sbPage)).first()).toHaveText("work");
  await expect(navRows(navFrame(sbPage)).first().locator("mark")).toBeVisible();
  await navInput(sbPage).fill("#wor");
  await expect(navRows(navFrame(sbPage)).first()).toHaveText("work");
  await expect(navRows(navFrame(sbPage)).first().locator("mark")).toBeVisible();
});

test("the modal is a centered column, not the width of the window", async ({
  sbPage,
}) => {
  // The panel's own inset only sets the vertical extent.
  await openPicker(sbPage, `${mod}+k`, "Page");
  const box = (await sbPage.locator(".sb-modal").boundingBox())!;
  const viewport = sbPage.viewportSize()!;
  expect(box.width).toBe(Math.min(700, viewport.width * 0.9));
  expect(Math.round(box.x)).toBe(Math.round((viewport.width - box.width) / 2));
});

// `boundingBox()` returns only `{x, y, width, height}` -- no `top`/`bottom` --
// so "is `inner` entirely inside `outer`, vertically" (item 12's clipping
// check) is computed off those directly, with a half-pixel tolerance for
// sub-pixel rounding.
function contains(
  outer: { y: number; height: number },
  inner: { y: number; height: number },
): boolean {
  return inner.y >= outer.y - 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5;
}

test("the modal is as tall as its content, capped like the old result list", async ({
  sbPage,
}) => {
  // The 250px list cap shrinks when there is little to show. Nothing about
  // the viewport enters into it.
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(frame, "Projects/Alpha");
  const modal = sbPage.locator(".sb-modal");
  // Polled: the height is re-applied on the host's own render cadence
  // (editor_ui.tsx's centered-modal effect), so it lands a frame after the
  // rows do.
  const height = async () => (await modal.boundingBox())!.height;
  const viewport = sbPage.viewportSize()!;
  // The property is the 250px list cap, not a pixel-perfect chrome height: the
  // slack is deliberately wide enough that a header wrapping to a second line
  // is not a failure of *this* test.
  await expect.poll(height).toBeLessThan(250 + 250);
  const full = await height();
  expect(full).toBeLessThan(viewport.height * 0.75);

  // ...and the cap lands *between* rows: capped mid-row it leaves a permanent
  // sliver of the next one peeking out under the modal's bottom edge.
  const leftover = await frame.locator(".sb-nav-body").evaluate((body) => {
    const row = body.querySelector(".sb-nav-row")!.getBoundingClientRect();
    return body.getBoundingClientRect().height % row.height;
  });
  expect(leftover).toBeLessThan(1);

  // One match: visibly shorter, and the list is no longer the cap.
  await navInput(sbPage).fill("Projects/Beta");
  await expect(frame.locator(".sb-nav-row")).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect.poll(height).toBeLessThan(full - 100);

  // Item 12 (polish round): the cap shrinking to fit a handful of rows is the
  // big-list side of "the box matches its content" -- this is the small-list
  // side, where the box's own height used to land mid-row instead (a cross-
  // document `ResizeObserver`, see editor_ui.tsx's centered-modal effect,
  // isn't a reliably prompt notification -- the row itself renders inside the
  // iframe just fine, the host's box around it just hadn't grown/shrunk to
  // match by the time it was revealed). The single remaining row must be
  // entirely inside the modal's own box, not straddling its bottom edge.
  await expect.poll(async () => {
    const row = (await frame.locator(".sb-nav-row").first().boundingBox())!;
    const box = (await modal.boundingBox())!;
    return contains(box, row);
  }).toBe(true);
});

// Item 12 (polish round): a create-only row (no matches, a phrase typed) is
// the exact repro from the reported screenshot -- the selected create row cut
// off at the modal's bottom edge, about half visible.
test("item 12: a create-only row (no matches) is never clipped by the modal", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await navInput(sbPage).fill("Brand New Unmatched Page Xyz");
  const row = frame.locator(".sb-nav-create");
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(frame.locator(".sb-nav-row")).toHaveCount(1);

  const modal = sbPage.locator(".sb-modal");
  await expect.poll(async () => {
    const r = (await row.boundingBox())!;
    const box = (await modal.boundingBox())!;
    return contains(box, r) && r.height >= 34;
  }).toBe(true);
});

// Item 12 (polish round): the boundary between "a couple of rows" and "the
// 250px cap" is where a stale height (too tall *or* too short relative to
// what just settled) would be most visible -- every row must still be fully
// inside the modal's box.
test("item 12: a 2-3 row boundary case is never clipped by the modal", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await navInput(sbPage).fill("Projects/");
  const rows = frame.locator(".sb-nav-row");
  await expect(rows).toHaveCount(3, { timeout: 20_000 });

  const modal = sbPage.locator(".sb-modal");
  await expect.poll(async () => {
    const box = (await modal.boundingBox())!;
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const r = (await rows.nth(i).boundingBox())!;
      if (!contains(box, r)) return false;
    }
    return true;
  }).toBe(true);
});

test.describe("narrow viewport", () => {
  test.use({ viewport: { width: 430, height: 700 } });

  test("a row's name keeps its width; the description gives way", async ({
    sbPage,
  }) => {
    const frame = await openPicker(sbPage, `${mod}+k`, "Page");
    const row = frame
      .locator(".sb-nav-row", { hasText: "Schema Attributes Compendium" })
      .first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    const widths = await row.evaluate((el) => {
      const primary = el.querySelector(".sb-nav-primary") as HTMLElement;
      const description = el.querySelector(
        ".sb-nav-description",
      ) as HTMLElement | null;
      return {
        primaryClipped: primary.scrollWidth > primary.clientWidth + 1,
        descriptionClipped: description
          ? description.scrollWidth > description.clientWidth + 1
          : false,
        hasDescription: !!description,
      };
    });
    // The name is short enough to fit whatever else is on the row.
    expect(widths.primaryClipped).toBe(false);
    expect(widths.hasDescription).toBe(true);
  });

  // Item 9 (polish round): a short name must never clip, however long its
  // description is competing for the same row -- `.sb-nav-description`'s
  // `flex-basis: 0` means it can only ever take leftover space, never any of
  // the name's, down to fully hidden. A weighted-`flex-shrink` approach (the
  // pre-fix CSS) still handed the name a small, nonzero, proportional share
  // of any deficit -- rarely visible on a long name, but enough to clip a
  // couple of characters off a short one at exactly this width.
  test("a short name never clips, however long the competing description is", async ({
    sbPage,
  }) => {
    const frame = await openPicker(sbPage, `${mod}+k`, "Page");
    const row = frame.locator(".sb-nav-row", { hasText: "Zap" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    const widths = await row.evaluate((el) => {
      const primary = el.querySelector(".sb-nav-primary") as HTMLElement;
      const description = el.querySelector(
        ".sb-nav-description",
      ) as HTMLElement | null;
      return {
        primaryText: primary.textContent,
        primaryClipped: primary.scrollWidth > primary.clientWidth + 1,
        descriptionClipped: description
          ? description.scrollWidth > description.clientWidth + 1
          : null,
      };
    });
    expect(widths.primaryText).toBe("Zap");
    expect(widths.primaryClipped).toBe(false);
    // The description is what gives way at this width -- it's long enough
    // that it has to.
    expect(widths.descriptionClipped).toBe(true);
  });

  test("a create chip pins right without squeezing the name", async ({
    sbPage,
  }) => {
    // The chip is a fixed-size trailing element, so the description is still
    // what gives way first -- the name keeps its width even at this width.
    const frame = await openPicker(sbPage, `${mod}+k`, "Page");
    await navInput(sbPage).fill("Nowhere");
    const row = frame.locator(".sb-nav-row.sb-nav-aspiring");
    await expect(row).toBeVisible({ timeout: 20_000 });

    const measured = await row.evaluate((el) => {
      const primary = el.querySelector(".sb-nav-primary") as HTMLElement;
      const chip = el.querySelector(".sb-nav-chip-hint") as HTMLElement;
      return {
        primaryClipped: primary.scrollWidth > primary.clientWidth + 1,
        // Flush right: the chip's edge is the row's content edge.
        gapToRowEdge:
          el.getBoundingClientRect().right -
          parseFloat(getComputedStyle(el).paddingRight) -
          chip.getBoundingClientRect().right,
        // The row's own type size, not the chip scale.
        sameFontSize:
          getComputedStyle(chip).fontSize ===
          getComputedStyle(primary).fontSize,
      };
    });
    expect(measured.primaryClipped).toBe(false);
    expect(Math.abs(measured.gapToRowEdge)).toBeLessThan(1.5);
    expect(measured.sameFontSize).toBe(true);
  });

  test("a name too long for the row ellipsizes; the chip stays whole", async ({
    sbPage,
  }) => {
    // The two ways to make a page read alike at any width: the chip is a fixed
    // trailing element on both, and the name is what gives way.
    const frame = await openPicker(sbPage, `${mod}+k`, "Page");
    // Long enough that both the aspiring row's name and the create row's
    // phrase outrun this viewport.
    await navInput(sbPage).fill("Catalog/Quarterly Planning Retrospective No");
    const aspiring = frame.locator(".sb-nav-row.sb-nav-aspiring").first();
    await expect(aspiring).toBeVisible({ timeout: 20_000 });
    const create = frame.locator(".sb-nav-row.sb-nav-create");
    await expect(create).toBeVisible({ timeout: 20_000 });

    const measure = (row: typeof aspiring) =>
      row.evaluate((el) => {
        const primary = el.querySelector(".sb-nav-primary") as HTMLElement;
        const chip = el.querySelector(".sb-nav-chip-hint") as HTMLElement;
        const rowBox = el.getBoundingClientRect();
        const chipBox = chip.getBoundingClientRect();
        const padding = parseFloat(getComputedStyle(el).paddingRight);
        return {
          nameEllipsized:
            primary.scrollWidth > primary.clientWidth + 1 &&
            getComputedStyle(primary).textOverflow === "ellipsis",
          // Whole: not clipped by its own box, and inside the row's content
          // box at both edges.
          chipWhole: chip.scrollWidth <= chip.clientWidth + 1,
          chipInsideRow:
            chipBox.left >= rowBox.left &&
            chipBox.right <= rowBox.right - padding + 1,
          chipWidth: chipBox.width,
        };
      });

    for (const row of [aspiring, create]) {
      const m = await measure(row);
      expect(m.nameEllipsized).toBe(true);
      expect(m.chipWhole).toBe(true);
      expect(m.chipInsideRow).toBe(true);
      expect(m.chipWidth).toBeGreaterThan(20);
    }
  });

  test("...and the modal itself goes edge to edge, still hugging its content", async ({
    sbPage,
  }) => {
    const frame = await openPicker(sbPage, `${mod}+k`, "Page");
    const box = (await sbPage.locator(".sb-modal").boundingBox())!;
    const viewport = sbPage.viewportSize()!;
    // The mobile breakpoint drops the fixed width for the 8px inset.
    expect(box.x).toBe(8);
    expect(box.width).toBe(viewport.width - 16);

    // ...in width only. A phone gets the same content-sized box a desktop
    // does: with a handful of rows it ends where they end, rather than being
    // stretched to the viewport by its own backstop.
    await navInput(sbPage).fill("Projects/");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(3, {
      timeout: 20_000,
    });
    const fits = async () =>
      await sbPage.evaluate(() => {
        const el = document.querySelector(".sb-modal") as HTMLElement;
        const doc = (
          document.querySelector(".sb-modal iframe") as HTMLIFrameElement
        ).contentDocument!;
        return {
          modal: el.getBoundingClientRect().height,
          content: doc.documentElement.getBoundingClientRect().height,
        };
      });
    // Polled: the height lands a frame after the rows do (editor_ui.tsx's
    // centered-modal effect). The gap includes the modal's own 1px border on
    // each side, since `modal` is the outer (bordered) box.
    await expect
      .poll(async () => Math.abs((await fits()).modal - (await fits()).content))
      .toBeLessThan(4);
    expect((await fits()).modal).toBeLessThan(viewport.height / 2);
  });
});

// Item 11 (polish round): a key-hint chip, a tag chip, and `<mark>`
// highlighting must never change a row's own height relative to its
// neighbours -- rows in a picker list should read as one even line, walking
// down. List presentation is driven off real shipped surfaces (the command
// palette's key hints, the page picker's tag chips and phrase-driven
// `<mark>`s) rather than a synthetic fixture, since all three already exist.
test("item 11: key-hint chips, tag chips, and mark highlighting never change a row's height (list)", async ({
  sbPage,
}) => {
  const rowHeight = async (frame: FrameLocator, text: string) =>
    (await frame.locator(".sb-nav-row", { hasText: text }).first()
      .boundingBox())!.height;

  const paletteFrame = await openPicker(sbPage, `${mod}+/`, "Command");
  await expectNavRow(paletteFrame, "Navigate: Page Picker");
  const hintChipHeight = await rowHeight(paletteFrame, "Navigate: Page Picker");
  const plainHeight = await rowHeight(paletteFrame, "Client: Logout");
  await closePicker(sbPage);

  const pageFrame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(pageFrame, "Tagged");
  const tagChipHeight = await rowHeight(pageFrame, "Tagged");

  await navInput(sbPage).fill("Alpha");
  await expect(pageFrame.locator(".sb-nav-row mark").first()).toBeVisible();
  const markHeight = await rowHeight(pageFrame, "Alpha");

  expect(tagChipHeight).toBe(hintChipHeight);
  expect(markHeight).toBe(hintChipHeight);
  expect(plainHeight).toBe(hintChipHeight);
});

// Item 11 (polish round), tree presentation: `std.spaceTree` itself renders
// no decorations, so `RowHeightTree.md`'s synthetic view (defined above)
// exercises the same three mechanisms over a tree-mode row.
test("item 11: key-hint chips, tag chips, and mark highlighting never change a row's height (tree)", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Debug: Row Height Tree");
  const frame = navFrame(sbPage);
  await expectNavRow(frame, "HintRow");

  const rowHeight = async (text: string) =>
    (await frame.locator(".sb-nav-row", { hasText: text }).first()
      .boundingBox())!.height;

  const hintChipHeight = await rowHeight("HintRow");
  const tagChipHeight = await rowHeight("TagRow");
  const plainHeight = await rowHeight("PlainRow");

  await navInput(sbPage).fill("PlainRow");
  await expect(frame.locator(".sb-nav-row mark").first()).toBeVisible();
  const markHeight = await rowHeight("PlainRow");

  expect(tagChipHeight).toBe(hintChipHeight);
  expect(plainHeight).toBe(hintChipHeight);
  expect(markHeight).toBe(hintChipHeight);
});

test("Space Lua opens a built-in picker by name, with options", async ({
  sbPage,
}) => {
  // Through the space's own `navigator.open` -- the documented opener -- not
  // through the syscall the built-in commands take. The four shipped pickers
  // live in the plug's registry rather than in `navigator._views`, so an
  // opener that only knew about the Lua one would reject exactly them.
  await sbPage.evaluate(() =>
    (globalThis as any).sbRuntime.evalLuaScript(
      `navigator.open("std.pages", { segment = "Docs" })`,
    ),
  );

  const frame = navFrame(sbPage);
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Document",
    { timeout: 20_000 },
  );
  // The `segment` option reached the view it named.
  await expect(navSegment(frame, "Docs")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expectNavRow(frame, "assets/notes.bin");
  await closePicker(sbPage);
});

test("a Lua redefinition takes over a built-in that already answered", async ({
  sbPage,
}) => {
  // The exact cold-boot sequence this round exists to serve: the plug's
  // built-in answers for `std.pages` first (Space Lua is evaluated from the
  // index, so a space's own version registers later), and when it does it has
  // to take over. `navigator.define` at runtime stands in for "the space's
  // Lua finished indexing" without waiting on an indexer.
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(frame, "Projects/Alpha");
  await closePicker(sbPage);

  await sbPage.evaluate(async () => {
    await (globalThis as any).sbRuntime.evalLuaScript(`
      navigator.define {
        name = "std.pages",
        title = "Redefined",
        label = "Find",
        placeholder = "Redefined page",
        source = function()
          return { { name = "Only Mine", ref = "Only Mine" } }
        end,
      }
    `);
  });

  // Same key, same view name, same session, same iframe: the panel must
  // notice it is no longer the one answering.
  const redefined = await openPicker(sbPage, `${mod}+k`, "Redefined page");
  await expect(redefined.locator(".sb-nav-title")).toHaveText("Find");
  await expect(navRows(redefined)).toHaveText(["Only Mine"]);
  // ...and the segments went with the built-in, rather than the slot keeping
  // one view's chrome over another view's rows.
  await expect(redefined.locator(".sb-segment")).toHaveCount(0);
});

/**
 * The outline views: `std.toc` in the right sidebar and `std.tocModal` as a
 * picker, both over the page being edited, both fully expanded, both live.
 * Reached through the palette -- neither takes a key binding of its own.
 */
async function openOutline(sbPage: Page, command: string, iframe: string) {
  await runCommandViaPalette(sbPage, command);
  const frame = sbPage.frameLocator(iframe);
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Header",
    { timeout: 20_000 },
  );
  return frame;
}

test("the outline picker nests a page's headers, fully expanded", async ({
  sbPage,
}) => {
  await navigateViaPagePicker(sbPage, "Outline Page");
  const frame = await openOutline(
    sbPage,
    "Navigator: Outline Picker",
    NAV_MODAL_IFRAME,
  );

  // Nobody expanded anything -- every depth is on screen at once.
  await expect(navRows(frame)).toHaveText([
    "Getting started",
    "Install",
    "macOS",
    "Pros/Cons",
    "Reference",
    "Skipped",
    "Install",
  ]);
  // An H1 -> H3 jump hangs off the nearest shallower header, with no blank
  // level invented between them.
  await expect(frame.locator("[data-path='Reference/Skipped']")).toBeVisible();
  // A "/" inside a header is escaped out of the path (it is the tree's own
  // separator) and left alone in the label.
  await expect(
    frame.locator("[data-path='Getting started/Pros∕Cons'] .sb-nav-primary"),
  ).toHaveText("Pros/Cons");
  // Two headers of the same name under different parents are simply two
  // paths; nothing is merged.
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toBeVisible();
  await expect(frame.locator("[data-path='Reference/Install']")).toBeVisible();

  // Picking a header jumps to it and dismisses the modal, as any picker does.
  await frame.locator("[data-path='Getting started/Install/macOS']").click();
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
  await expect(currentPage(sbPage)).toHaveValue("Outline Page");
  // The row carries the header's own position, so the cursor lands on the
  // header line rather than at the top of the page.
  await expect(async () => {
    expect(
      await sbPage.evaluate(() => {
        const view = (globalThis as any).client.editorView;
        return view.state.doc.lineAt(view.state.selection.main.head).text;
      }),
    ).toBe("### macOS");
  }).toPass();
});

test("the outline sidebar follows the buffer, keeping collapses", async ({
  sbPage,
}) => {
  await navigateViaPagePicker(sbPage, "Outline Page");
  const frame = await openOutline(
    sbPage,
    "Navigator: Table of Contents",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toBeVisible({
    timeout: 20_000,
  });

  await frame.locator("[data-path='Getting started'] .sb-nav-chevron").click();
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toHaveCount(0);

  // A header typed into the editor, not saved to disk: the source reads the
  // buffer, so the outline follows keystrokes rather than files.
  const editor = sbPage.locator("#sb-editor .cm-content");
  await editor.click();
  await sbPage.keyboard.press(`${mod}+ArrowDown`);
  await sbPage.keyboard.type("\n# Afterword\nTail.\n");

  await expect(frame.locator("[data-path='Afterword']")).toBeVisible({
    timeout: 20_000,
  });
  // The collapse survived the refresh, and the newcomer arrived open.
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toHaveCount(0);
  await expect(frame.locator("[data-path='Reference/Skipped']")).toBeVisible();
});

test("an outline collapse belongs to the page, not to the view", async ({
  sbPage,
}) => {
  await navigateViaPagePicker(sbPage, "Outline Page");
  const frame = await openOutline(
    sbPage,
    "Navigator: Table of Contents",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toBeVisible({ timeout: 20_000 });

  await frame.locator("[data-path='Getting started'] .sb-nav-chevron").click();
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toHaveCount(0);

  // The sidebar holds the keyboard once it is open, so a key binding has to be
  // handed back to the editor before it means anything.
  const toEditor = () => sbPage.locator("#sb-editor .cm-content").click();

  // Another page whose headers sit at exactly the same paths. Its outline is
  // a different dataset, so it opens fully expanded -- the collapse above was
  // about the page it was made on.
  await toEditor();
  await navigateViaPagePicker(sbPage, "Outline Other");
  await expect(
    frame.locator("[data-path='Getting started/Install/Elsewhere']"),
  ).toBeVisible({ timeout: 20_000 });

  // ...and it is not persisted either, so coming back is a clean slate too:
  // a collapse lasts while you are on the page and no longer.
  await toEditor();
  await navigateViaPagePicker(sbPage, "Outline Page");
  await expect(
    frame.locator("[data-path='Getting started/Install/macOS']"),
  ).toBeVisible({ timeout: 20_000 });
});

test("Space peeks at a header without leaving the outline sidebar", async ({
  sbPage,
}) => {
  await navigateViaPagePicker(sbPage, "Outline Page");
  const frame = await openOutline(
    sbPage,
    "Navigator: Table of Contents",
    ".sb-keyed-panel-rhs iframe",
  );
  const input = frame.locator("input.sb-nav-input");
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toBeVisible({ timeout: 20_000 });

  // A printable keymap key only acts once an arrow has moved the selection --
  // before that it is text, so a multi-word phrase stays typeable.
  await input.press("ArrowDown");
  await expect(frame.locator(".sb-nav-selected")).toHaveAttribute(
    "data-path",
    "Getting started/Install",
  );
  await input.press(" ");

  await expect(async () => {
    expect(
      await sbPage.evaluate(() => {
        const view = (globalThis as any).client.editorView;
        return view.state.doc.lineAt(view.state.selection.main.head).text;
      }),
    ).toBe("## Install");
  }).toPass();
  // The whole point of a peek: the phrase box still has the keyboard, so the
  // next arrow keeps browsing.
  await expect(input).toHaveValue("");
  await expectNavInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");
});

test("the outline drops the tree's folder bands; the space tree keeps them", async ({
  sbPage,
}) => {
  // An outline is nearly all parents -- every header with a subsection heads
  // one -- so the bands read as stripes there and the indentation carries the
  // structure instead. A space tree is mostly leaves, and its bands are what
  // make the folders findable.
  await navigateViaPagePicker(sbPage, "Outline Page");
  const outline = await openOutline(
    sbPage,
    "Navigator: Table of Contents",
    ".sb-keyed-panel-rhs iframe",
  );
  const band = (frame: ReturnType<typeof navFrame>, path: string) =>
    frame
      .locator(`[data-path='${path}']`)
      .evaluate((el) => getComputedStyle(el).backgroundImage);

  // A parent header that is *not* the selected row -- the selection paints its
  // own surface and would answer "none" whatever the bands do.
  const parent = "Getting started/Install";
  await expect(outline.locator(`[data-path='${parent}']`)).toHaveClass(
    /sb-nav-folder/,
  );
  await expect(outline.locator(`[data-path='${parent}']`)).not.toHaveClass(
    /sb-nav-selected/,
  );
  expect(await band(outline, parent)).toBe("none");

  // Focus sits in the outline's own iframe, where the palette binding never
  // arrives -- hand it back to the editor before asking for a command.
  await sbPage.locator("#sb-editor .cm-content").click();
  await runCommandViaPalette(sbPage, "Navigator: Tree");
  const tree = sbPage.frameLocator(".sb-keyed-panel-lhs iframe");
  await expect(tree.locator("[data-path='Projects']")).toBeVisible({
    timeout: 20_000,
  });
  expect(await band(tree, "Projects")).not.toBe("none");
});

test("the outline picker re-sources for the page it is opened on", async ({
  sbPage,
}) => {
  await navigateViaPagePicker(sbPage, "Outline Page");
  const frame = await openOutline(
    sbPage,
    "Navigator: Outline Picker",
    NAV_MODAL_IFRAME,
  );
  await expect(frame.locator("[data-path='Reference']")).toBeVisible({
    timeout: 20_000,
  });
  await closePicker(sbPage);

  // A modal is never open across a navigation, so it takes the current page
  // from `refreshOnOpen` rather than from a pageLoaded refresh -- and a page
  // with no headers is simply the view's own empty state, not a crash.
  await navigateViaPagePicker(sbPage, "index");
  await openOutline(sbPage, "Navigator: Outline Picker", NAV_MODAL_IFRAME);
  await expect(frame.locator(".sb-nav-empty")).toBeVisible({ timeout: 20_000 });
});

test("std.toc/std.tocModal answer on a page loaded directly, before anything else touches the navigator", async ({
  sbServer,
  page,
}) => {
  // This tab's very first navigation, straight to a page with headers -- no
  // page picker, no prior navigator activation of any kind. Both outline
  // views are TS builtins (`plugs/navigator/src/builtins.ts`, wired in
  // `navigator.plug.yaml`), registered from the plug's own manifest rather
  // than from a `navigator.define` call -- unlike `std.journal`/
  // `std.pageTemplates`, they need no Space Lua to have run first, so there
  // is nothing here for them to be waiting on.
  await gotoSilverBulletPage(page, sbServer, "Outline Page");

  const modal = await openOutline(
    page,
    "Navigator: Outline Picker",
    NAV_MODAL_IFRAME,
  );
  await expect(navRows(modal).first()).toHaveText("Getting started", {
    timeout: 20_000,
  });
  await closePicker(page);

  await page.locator("#sb-editor .cm-content").click();
  const sidebar = await openOutline(
    page,
    "Navigator: Table of Contents",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(
    sidebar.locator("[data-path='Getting started/Install']"),
  ).toBeVisible({ timeout: 20_000 });
});

test("a Lua redefinition takes over a moved built-in (std.tocModal)", async ({
  sbPage,
}) => {
  // `navigator.define` at runtime stands in for "the space's own Lua
  // finished indexing" without waiting on an indexer, same as the
  // `std.pages` case above -- the point being that a *moved* built-in still
  // has to yield the instant a same-named Lua view exists.
  await navigateViaPagePicker(sbPage, "Outline Page");
  const frame = await openOutline(
    sbPage,
    "Navigator: Outline Picker",
    NAV_MODAL_IFRAME,
  );
  // The title (the plug's own `label`) confirms this first answer really did
  // come from the built-in registry, not a Lua `std.tocModal` that happened
  // to exist already -- there is none yet at this point in the test.
  await expect(frame.locator(".sb-nav-title")).toHaveText("Outline");
  await expect(navRows(frame).first()).toHaveText("Getting started", {
    timeout: 20_000,
  });
  await closePicker(sbPage);

  await sbPage.evaluate(async () => {
    await (globalThis as any).sbRuntime.evalLuaScript(`
      navigator.define {
        name = "std.tocModal",
        title = "Redefined Outline",
        placeholder = "Header",
        source = function()
          return { { name = "Only Mine", ref = "Only Mine" } }
        end,
      }
    `);
  });

  // Same command, same session, same iframe: the panel must notice it is no
  // longer the plug's own view that answers for this name.
  const redefined = await openOutline(
    sbPage,
    "Navigator: Outline Picker",
    NAV_MODAL_IFRAME,
  );
  await expect(redefined.locator(".sb-nav-title")).toHaveText(
    "Redefined Outline",
  );
  await expect(navRows(redefined)).toHaveText(["Only Mine"]);
});

test("Navigator: Tree answers on a page loaded directly, before anything else touches the navigator", async ({
  sbServer,
  page,
}) => {
  // This tab's very first navigation -- no page picker, no prior navigator
  // activation of any kind. `std.spaceTree` is a TS builtin, registered
  // from the plug's own manifest rather than a `navigator.define` call, so
  // it needs no Space Lua to have run first -- the failure this whole
  // family of moves exists to fix.
  await gotoSilverBulletPage(page, sbServer, "Projects/Alpha");

  await runCommandViaPalette(page, "Navigator: Tree");
  const frame = page.frameLocator(".sb-keyed-panel-lhs iframe");
  // The top-level listing, not a reveal into "Projects" -- followEditor's
  // own reveal-on-open behavior is a different round's surface (a known race
  // with the tree's initial paint); what this test is for is proving the
  // view answers with the space's real content immediately.
  await expect(frame.locator("[data-path='Projects']")).toBeVisible({
    timeout: 20_000,
  });
  await expect(frame.locator("[data-path='Journal']")).toBeVisible();
});

test("a Lua redefinition takes over a moved built-in (std.spaceTree)", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigator: Tree");
  const frame = sbPage.frameLocator(".sb-keyed-panel-lhs iframe");
  await expect(frame.locator("[data-path='Projects']")).toBeVisible({
    timeout: 20_000,
  });
  // The title (the plug's own `label`) confirms this first answer really did
  // come from the built-in registry, not a Lua `std.spaceTree` that happened
  // to exist already -- there is none yet at this point in the test.
  await expect(frame.locator(".sb-nav-title")).toHaveText("Open");

  await sbPage.evaluate(async () => {
    await (globalThis as any).sbRuntime.evalLuaScript(`
      navigator.define {
        name = "std.spaceTree",
        title = "Redefined Tree",
        dock = "lhs",
        source = function()
          return { { name = "Only Mine", ref = "Only Mine" } }
        end,
      }
    `);
  });

  // The sidebar holds the keyboard once it is open, so the palette binding
  // has to be handed back to the editor before it means anything.
  await sbPage.locator("#sb-editor .cm-content").click();

  // Same command, same dock: the panel must notice it is no longer the
  // plug's own view that answers for this name.
  await runCommandViaPalette(sbPage, "Navigator: Tree");
  await expect(frame.locator(".sb-nav-title")).toHaveText("Redefined Tree");
  await expect(navRows(frame)).toHaveText(["Only Mine"]);
});

test("Cmd-o/Ctrl-o opens the space tree, not the (now keyless) document picker", async ({
  sbPage,
}) => {
  await sbPage.keyboard.press(`${mod}+o`);

  const frame = sbPage.frameLocator(".sb-keyed-panel-lhs iframe");
  await expect(frame.locator("[data-path='Projects']")).toBeVisible({
    timeout: 20_000,
  });
  // The document picker is a modal -- if the old binding were still live,
  // this is what it would have opened instead.
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  // The sidebar holds the keyboard once it is open, so the palette binding
  // has to be handed back to the editor before it means anything.
  await sbPage.locator("#sb-editor .cm-content").click();

  // The document picker command itself still works, just not on this key --
  // reached through the palette, it opens its usual modal segment.
  await runCommandViaPalette(sbPage, "Navigate: Document Picker");
  await expect(navFrame(sbPage).locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Document",
    { timeout: 20_000 },
  );
});
