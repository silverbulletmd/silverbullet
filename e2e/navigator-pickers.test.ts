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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}
\`\`\`
`;

const SPACE = {
  "index.md": "Welcome",
  "RowHeightTree.md": ROW_HEIGHT_TREE_CONFIG,
  "Projects/Alpha.md":
    "# Alpha\n\nSee [[Nowhere Page]] and [[Catalog/Quarterly Planning Retrospective Notes And Follow Ups]].\n\n$intro\nThe introduction paragraph.\n",
  "Projects/Beta.md": "# Beta\n",
  "Tagged.md": "---\ntags: work\n---\n\nTagged content.\n",
  "Schema Attributes Compendium.md":
    "---\ndescription: A long description that competes with the name for row width.\n---\nBody\n",
  "Zap.md":
    "---\ndescription: A description on its own long enough to want more width than a narrow row has to give.\n---\nBody\n",
  "Settings Page.md": "---\ntags: meta\n---\n\nA meta page.\n",
  "assets/notes.bin": "not markdown",
  "Templates/Zeta.md":
    "---\ndescription: A test template\ntags: meta/template/page\n---\n\nTemplated body.\n",
  "Journal/2026-08-07.md": "---\ntags: journal\n---\n\nA journal entry.\n",
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

  await expect(navSegment(frame, "Pages")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // Segments no longer carry a row count in their label.
  for (const label of ["Meta", "Documents", "All"]) {
    await expect(navSegment(frame, label)).toBeVisible();
  }
  await expect(navSegment(frame, "Pages")).toHaveText("Pages");

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

  await runCommandViaPalette(sbPage, "Navigate: Document Picker");
  frame = navFrame(sbPage);
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Document",
    { timeout: 20_000 },
  );
  await expect(navSegment(frame, "Documents")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expectNavRow(frame, "assets/notes.bin");
});

test("opening on a segment doesn't become the segment it opens on", async ({
  sbPage,
}) => {
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
  await expect(navInput(sbPage)).toHaveValue("");
  await expectNavRow(frame, "Settings Page");

  await navInput(sbPage).press("Backspace");
  await expect(navSegment(frame, "Pages")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("a document with no editor is listed last, and greyed", async ({
  sbPage,
}) => {
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

  await navInput(sbPage).fill("work");
  await expect(navRows(frame).first()).toHaveText("work");
  await sbPage.keyboard.press("Enter");

  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Page",
  );
  await expect(navInput(sbPage)).toHaveValue("#work ");
  await expect(navRows(frame)).toHaveText(["Tagged"]);
  // The round trip's own selection must not have closed the panel out from
  // under itself.
  await expect(sbPage.locator(".sb-modal")).toBeVisible();
});

test("Ctrl-Alt-t opens the tag picker on its own, and opens tag pages", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, "Control+Alt+t", "Tag");
  await expectNavRow(frame, "work");
  await expect(
    frame.locator(".sb-nav-row", { hasText: "work" }).first(),
  ).toContainText("1");

  await navInput(sbPage).fill("work");
  await sbPage.keyboard.press("Enter");
  await expect(currentPage(sbPage)).toHaveValue("tag:work");
});

test("Cmd-/ opens the command palette, with key hints, and runs a command", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+/`, "Command");
  await expectNavRow(frame, "Navigate: Page Picker");

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
  // The palette must dismiss itself before the command runs, or its own
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

  // The command returns false to say "I took the focus"; a palette that
  // dropped that return value would call editor.focus() here and race the
  // panel for it, leaving a picker you have to click before typing works.
  await expectNavInputFocused(sbPage);
  await sbPage.keyboard.type("Beta", { delay: 20 });
  await expect(navInput(sbPage)).toHaveValue("Beta");
});

test("a command that keeps its own focus keeps it through the palette", async ({
  sbPage,
}) => {
  // `Editor: Find in Page` returns false to keep focus on its own search
  // panel; the palette's dispatch has to honour that the same way the
  // key-binding path does.
  const frame = await openPicker(sbPage, `${mod}+/`, "Command");
  await navInput(sbPage).fill("Editor: Find in Page");
  await expect(navRows(frame).first()).toHaveText("Editor: Find in Page");
  await sbPage.keyboard.press("Enter");

  const search = sbPage.locator(".cm-search input[main-field]");
  await expect(search).toBeVisible({ timeout: 20_000 });
  await expect(search).toBeFocused();
  await sbPage.keyboard.type("needle", { delay: 20 });
  await expect(search).toHaveValue("needle");
});

test("a throwing command is reported instead of vanishing", async ({
  sbPage,
}) => {
  // Without `client.reportError` wrapping the run, the rejection escapes a
  // fire-and-forget dispatch: the palette just disappears with no error and
  // focus left nowhere.
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

  // `Error: kaboom` comes from `client.reportError`; the navigator's own
  // onSelect-wrapper fallback would instead say "navigator onSelect: ...",
  // so this text pins down which path actually caught it.
  await expect(sbPage.locator(".sb-notifications")).toContainText(
    "Error: kaboom",
    { timeout: 20_000 },
  );
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
});

test("the palette re-orders by what was last run", async ({ sbPage }) => {
  const frame = await openPicker(sbPage, `${mod}+/`, "Command");
  await navInput(sbPage).fill("Navigate: Center Cursor");
  await expect(navRows(frame).first()).toHaveText("Navigate: Center Cursor");
  await sbPage.keyboard.press("Enter");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  await openPicker(sbPage, `${mod}+/`, "Command");
  await expect(navRows(frame).first()).toHaveText("Navigate: Center Cursor", {
    timeout: 20_000,
  });
});

test("Ctrl-q t picks a template, then asks for the page name", async ({
  sbPage,
}) => {
  await sbPage.keyboard.press("Control+q");
  const frame = await openPicker(sbPage, "t", "Filter");
  // The space's own template has to be indexed before it can lead the list;
  // until then, the bundled template is the only one there.
  await expectNavRow(frame, "Zeta");
  await navInput(sbPage).fill("Zeta");
  await expect(navRows(frame).first()).toHaveText("Zeta");
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Zeta" }).first(),
  ).toContainText("A test template");

  await sbPage.keyboard.press("Enter");
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
  await expectNavRow(frame, "2026-08-07");
});

test("the picker re-runs its source on every open", async ({
  sbPage,
  sbServer,
}) => {
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
  await expect(navSegment(frame, "Documents")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await input.press("Tab");
  await expect(navSegment(frame, "All")).toHaveAttribute(
    "aria-checked",
    "true",
  );
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

  await navInput(sbPage).fill("Projects/Alph");
  const primaries = frame.locator(".sb-nav-row .sb-nav-primary");
  await expect(primaries.nth(0)).toHaveText("Projects/Alpha");
  await expect(primaries.nth(1)).toHaveText("Projects/Alph");
  await expect(frame.locator(".sb-nav-create .sb-nav-icon svg")).toBeVisible();
  await expect(frame.locator(".sb-nav-create .sb-nav-chip-hint")).toHaveText(
    "Create",
  );

  await sbPage.keyboard.press("ArrowDown");
  await expect(frame.locator(".sb-nav-create")).toHaveClass(/sb-nav-selected/);

  // Selected, the chip has to be re-paired with the selection's own fill
  // color rather than the row-surface color it was paired against unselected.
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
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await sbPage.keyboard.press("$");
  await expectNavRow(frame, "intro");
  await navInput(sbPage).fill("intr");
  await expect(navRows(frame).first()).toHaveText("intro");
  // Ranking and match-highlighting run against the phrase with the sigil
  // stripped, so typing the sigil must not blank the <mark> even though it
  // never appears in the row's own (bare) name.
  await expect(navRows(frame).first().locator("mark")).toBeVisible();
  await navInput(sbPage).fill("$intr");
  await expect(navRows(frame).first()).toHaveText("intro");
  await expect(navRows(frame).first().locator("mark")).toBeVisible();

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
  await openPicker(sbPage, `${mod}+k`, "Page");
  const box = (await sbPage.locator(".sb-modal").boundingBox())!;
  const viewport = sbPage.viewportSize()!;
  expect(box.width).toBe(Math.min(700, viewport.width * 0.9));
  expect(Math.round(box.x)).toBe(Math.round((viewport.width - box.width) / 2));
});

function contains(
  outer: { y: number; height: number },
  inner: { y: number; height: number },
): boolean {
  return (
    inner.y >= outer.y - 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

test("the modal is as tall as its content, capped like the old result list", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(frame, "Projects/Alpha");
  const modal = sbPage.locator(".sb-modal");
  // Polled: the height is re-applied on the host's own render cadence
  // (editor_ui.tsx's centered-modal effect), so it lands a frame after the
  // rows do.
  const height = async () => (await modal.boundingBox())!.height;
  const viewport = sbPage.viewportSize()!;
  await expect.poll(height).toBeLessThan(250 + 250);
  const full = await height();
  expect(full).toBeLessThan(viewport.height * 0.75);

  // The cap has to land *between* rows: capped mid-row it leaves a permanent
  // sliver of the next one peeking out under the modal's bottom edge.
  const leftover = await frame.locator(".sb-nav-body").evaluate((body) => {
    const row = body.querySelector(".sb-nav-row")!.getBoundingClientRect();
    return body.getBoundingClientRect().height % row.height;
  });
  expect(leftover).toBeLessThan(1);

  await navInput(sbPage).fill("Projects/Beta");
  await expect(frame.locator(".sb-nav-row")).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect.poll(height).toBeLessThan(full - 100);

  // The host's box height used to land mid-row here because the cross-
  // document ResizeObserver (editor_ui.tsx's centered-modal effect) isn't a
  // reliably prompt notification, even though the row itself paints fine.
  await expect
    .poll(async () => {
      const row = (await frame.locator(".sb-nav-row").first().boundingBox())!;
      const box = (await modal.boundingBox())!;
      return contains(box, row);
    })
    .toBe(true);
});

test("item 12: a create-only row (no matches) is never clipped by the modal", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await navInput(sbPage).fill("Brand New Unmatched Page Xyz");
  const row = frame.locator(".sb-nav-create");
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(frame.locator(".sb-nav-row")).toHaveCount(1);

  const modal = sbPage.locator(".sb-modal");
  await expect
    .poll(async () => {
      const r = (await row.boundingBox())!;
      const box = (await modal.boundingBox())!;
      return contains(box, r) && r.height >= 34;
    })
    .toBe(true);
});

test("item 12: a 2-3 row boundary case is never clipped by the modal", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await navInput(sbPage).fill("Projects/");
  const rows = frame.locator(".sb-nav-row");
  await expect(rows).toHaveCount(3, { timeout: 20_000 });

  const modal = sbPage.locator(".sb-modal");
  await expect
    .poll(async () => {
      const box = (await modal.boundingBox())!;
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const r = (await rows.nth(i).boundingBox())!;
        if (!contains(box, r)) return false;
      }
      return true;
    })
    .toBe(true);
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
    expect(widths.primaryClipped).toBe(false);
    expect(widths.hasDescription).toBe(true);
  });

  // The pre-fix CSS used a weighted `flex-shrink` on the name, which still
  // gave it a small, nonzero share of any deficit -- rarely visible on a long
  // name, but enough to clip a couple of characters off a short one at this
  // width; `.sb-nav-description`'s `flex-basis: 0` is what fixes that.
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
    expect(widths.descriptionClipped).toBe(true);
  });

  test("a create chip pins right without squeezing the name", async ({
    sbPage,
  }) => {
    const frame = await openPicker(sbPage, `${mod}+k`, "Page");
    await navInput(sbPage).fill("Nowhere");
    const row = frame.locator(".sb-nav-row.sb-nav-aspiring");
    await expect(row).toBeVisible({ timeout: 20_000 });

    const measured = await row.evaluate((el) => {
      const primary = el.querySelector(".sb-nav-primary") as HTMLElement;
      const chip = el.querySelector(".sb-nav-chip-hint") as HTMLElement;
      return {
        primaryClipped: primary.scrollWidth > primary.clientWidth + 1,
        gapToRowEdge:
          el.getBoundingClientRect().right -
          parseFloat(getComputedStyle(el).paddingRight) -
          chip.getBoundingClientRect().right,
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
    const frame = await openPicker(sbPage, `${mod}+k`, "Page");
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
    expect(box.x).toBe(8);
    expect(box.width).toBe(viewport.width - 16);

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
    // The <4px tolerance covers the modal's own 1px border on each side,
    // since `modal` is the outer (bordered) box.
    await expect
      .poll(async () => Math.abs((await fits()).modal - (await fits()).content))
      .toBeLessThan(4);
    expect((await fits()).modal).toBeLessThan(viewport.height / 2);
  });
});

test("item 11: key-hint chips, tag chips, and mark highlighting never change a row's height (list)", async ({
  sbPage,
}) => {
  const rowHeight = async (frame: FrameLocator, text: string) =>
    (await frame
      .locator(".sb-nav-row", { hasText: text })
      .first()
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

test("item 11: key-hint chips, tag chips, and mark highlighting never change a row's height (tree)", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Debug: Row Height Tree");
  const frame = navFrame(sbPage);
  await expectNavRow(frame, "HintRow");

  const rowHeight = async (text: string) =>
    (await frame
      .locator(".sb-nav-row", { hasText: text })
      .first()
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
  // The four shipped pickers live in the plug's registry, not in
  // `navigator._views`, so an opener that only knew about Lua-defined views
  // would reject exactly them.
  await sbPage.evaluate(() =>
    (globalThis as any).sbRuntime.evalLuaScript(
      `navigator.open("std.pages", { segment = "Documents" })`,
    ),
  );

  const frame = navFrame(sbPage);
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Document",
    { timeout: 20_000 },
  );
  await expect(navSegment(frame, "Documents")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expectNavRow(frame, "assets/notes.bin");
  await closePicker(sbPage);
});

async function evalPcall(sbPage: Page, code: string) {
  return (await sbPage.evaluate(
    (script) =>
      (globalThis as any).sbRuntime.evalLuaScript(`
        local ok, result = pcall(function() ${script} end)
        return { ok = ok, result = tostring(result) }
      `),
    code,
  )) as { ok: boolean; result: string };
}

test("defining a view named std.pages surfaces the collision error, and the built-in keeps answering unshadowed", async ({
  sbPage,
}) => {
  const frame = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(frame, "Projects/Alpha");
  await expect(navSegment(frame, "Pages")).toBeVisible();
  await closePicker(sbPage);

  const collision = await evalPcall(
    sbPage,
    `
      navigator.define {
        name = "std.pages",
        title = "Redefined",
        label = "Find",
        placeholder = "Redefined page",
        source = function()
          return { { name = "Only Mine", ref = "Only Mine" } }
        end,
        onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
      }
    `,
  );
  expect(collision.ok).toBe(false);
  expect(collision.result).toContain("std.pages");

  // Proves the rejected `define` never touched the registry: still the real
  // picker on the same key.
  const stillBuiltin = await openPicker(sbPage, `${mod}+k`, "Page");
  await expectNavRow(stillBuiltin, "Projects/Alpha");
  await expect(navSegment(stillBuiltin, "Pages")).toBeVisible();
});

test("a Lua view redefined by a space-lua edit shows its new definition on next open, without a reload", async ({
  sbPage,
}) => {
  await sbPage.evaluate(() =>
    (globalThis as any).sbRuntime.evalLuaScript(`
      navigator.define {
        name = "test.redefinable",
        title = "Original",
        dock = "modal",
        source = function()
          return { { name = "Original Row", ref = "Original Row" } }
        end,
        onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
      }
    `),
  );
  await sbPage.evaluate(() =>
    (globalThis as any).sbRuntime.evalLuaScript(
      `navigator.open("test.redefinable")`,
    ),
  );
  const frame = navFrame(sbPage);
  await expect(frame.locator(".sb-nav-title")).toHaveText("Original");
  await expectNavRow(frame, "Original Row");
  await closePicker(sbPage);

  await sbPage.evaluate(() =>
    (globalThis as any).sbRuntime.evalLuaScript(`
      navigator.define {
        name = "test.redefinable",
        title = "Redefined",
        dock = "modal",
        source = function()
          return { { name = "Redefined Row", ref = "Redefined Row" } }
        end,
        onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
      }
    `),
  );

  await sbPage.evaluate(() =>
    (globalThis as any).sbRuntime.evalLuaScript(
      `navigator.open("test.redefinable")`,
    ),
  );
  await expect(frame.locator(".sb-nav-title")).toHaveText("Redefined");
  await expectNavRow(frame, "Redefined Row");
});

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
    "Navigate: Outline Picker",
    NAV_MODAL_IFRAME,
  );

  await expect(navRows(frame)).toHaveText([
    "Getting started",
    "Install",
    "macOS",
    "Pros/Cons",
    "Reference",
    "Skipped",
    "Install",
  ]);
  // An H1 -> H3 jump has to hang off the nearest shallower header, with no
  // blank level invented between them.
  await expect(frame.locator("[data-path='Reference/Skipped']")).toBeVisible();
  // A "/" inside a header text must be escaped out of the path, since "/" is
  // the tree's own path separator, and left alone in the label.
  await expect(
    frame.locator("[data-path='Getting started/Pros∕Cons'] .sb-nav-primary"),
  ).toHaveText("Pros/Cons");
  // Two headers of the same name under different parents are two distinct
  // paths that must not get merged into one node.
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toBeVisible();
  await expect(frame.locator("[data-path='Reference/Install']")).toBeVisible();

  await frame.locator("[data-path='Getting started/Install/macOS']").click();
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
  await expect(currentPage(sbPage)).toHaveValue("Outline Page");
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
    "Navigate: Outline",
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

  const editor = sbPage.locator("#sb-editor .cm-content");
  await editor.click();
  await sbPage.keyboard.press(`${mod}+ArrowDown`);
  await sbPage.keyboard.type("\n# Afterword\nTail.\n");

  await expect(frame.locator("[data-path='Afterword']")).toBeVisible({
    timeout: 20_000,
  });
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
    "Navigate: Outline",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toBeVisible({ timeout: 20_000 });

  await frame.locator("[data-path='Getting started'] .sb-nav-chevron").click();
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toHaveCount(0);

  const toEditor = () => sbPage.locator("#sb-editor .cm-content").click();

  await toEditor();
  await navigateViaPagePicker(sbPage, "Outline Other");
  await expect(
    frame.locator("[data-path='Getting started/Install/Elsewhere']"),
  ).toBeVisible({ timeout: 20_000 });

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
    "Navigate: Outline",
    ".sb-keyed-panel-rhs iframe",
  );
  const input = frame.locator("input.sb-nav-input");
  await expect(
    frame.locator("[data-path='Getting started/Install']"),
  ).toBeVisible({ timeout: 20_000 });

  // A printable keymap key only acts once an arrow has moved the selection --
  // before that it's treated as text, keeping a multi-word phrase typeable.
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
  await expect(input).toHaveValue("");
  await expectNavInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");
});

test("the outline drops the tree's folder bands; the space tree keeps them", async ({
  sbPage,
}) => {
  await navigateViaPagePicker(sbPage, "Outline Page");
  const outline = await openOutline(
    sbPage,
    "Navigate: Outline",
    ".sb-keyed-panel-rhs iframe",
  );
  const band = (frame: ReturnType<typeof navFrame>, path: string) =>
    frame
      .locator(`[data-path='${path}']`)
      .evaluate((el) => getComputedStyle(el).backgroundImage);

  // Must be a parent header that is *not* the selected row: the selection
  // paints its own surface and would answer "none" regardless of the bands.
  const parent = "Getting started/Install";
  await expect(outline.locator(`[data-path='${parent}']`)).toHaveClass(
    /sb-nav-folder/,
  );
  await expect(outline.locator(`[data-path='${parent}']`)).not.toHaveClass(
    /sb-nav-selected/,
  );
  expect(await band(outline, parent)).toBe("none");

  await sbPage.locator("#sb-editor .cm-content").click();
  await runCommandViaPalette(sbPage, "Navigate: Tree");
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
    "Navigate: Outline Picker",
    NAV_MODAL_IFRAME,
  );
  await expect(frame.locator("[data-path='Reference']")).toBeVisible({
    timeout: 20_000,
  });
  await closePicker(sbPage);

  // A modal is never open across a navigation, so it has to pick up the
  // current page from `refreshOnOpen` rather than a pageLoaded refresh.
  await navigateViaPagePicker(sbPage, "index");
  await openOutline(sbPage, "Navigate: Outline Picker", NAV_MODAL_IFRAME);
  await expect(frame.locator(".sb-nav-empty")).toBeVisible({ timeout: 20_000 });
});

test("std.toc/std.tocModal answer on a page loaded directly, before anything else touches the navigator", async ({
  sbServer,
  page,
}) => {
  // Both outline views are TS builtins registered from the plug's own
  // manifest rather than a `navigator.define` call, unlike `std.journal`/
  // `std.pageTemplates` -- so unlike those, they need no Space Lua to have
  // run first, and this tab's very first navigation has none.
  await gotoSilverBulletPage(page, sbServer, "Outline Page");

  const modal = await openOutline(
    page,
    "Navigate: Outline Picker",
    NAV_MODAL_IFRAME,
  );
  await expect(navRows(modal).first()).toHaveText("Getting started", {
    timeout: 20_000,
  });
  await closePicker(page);

  await page.locator("#sb-editor .cm-content").click();
  const sidebar = await openOutline(
    page,
    "Navigate: Outline",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(
    sidebar.locator("[data-path='Getting started/Install']"),
  ).toBeVisible({ timeout: 20_000 });
});

test("the collision error also covers a moved built-in (std.tocModal)", async ({
  sbPage,
}) => {
  await navigateViaPagePicker(sbPage, "Outline Page");
  const frame = await openOutline(
    sbPage,
    "Navigate: Outline Picker",
    NAV_MODAL_IFRAME,
  );
  await expect(frame.locator(".sb-nav-title")).toHaveText("Outline");
  await expect(navRows(frame).first()).toHaveText("Getting started", {
    timeout: 20_000,
  });
  await closePicker(sbPage);

  const collision = await evalPcall(
    sbPage,
    `
      navigator.define {
        name = "std.tocModal",
        title = "Redefined Outline",
        placeholder = "Header",
        source = function()
          return { { name = "Only Mine", ref = "Only Mine" } }
        end,
        onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
      }
    `,
  );
  expect(collision.ok).toBe(false);
  expect(collision.result).toContain("std.tocModal");

  const stillBuiltin = await openOutline(
    sbPage,
    "Navigate: Outline Picker",
    NAV_MODAL_IFRAME,
  );
  await expect(stillBuiltin.locator(".sb-nav-title")).toHaveText("Outline");
});

test("Navigate: Tree answers on a page loaded directly, before anything else touches the navigator", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Projects/Alpha");

  await runCommandViaPalette(page, "Navigate: Tree");
  const frame = page.frameLocator(".sb-keyed-panel-lhs iframe");
  // Checks the top-level listing, not a reveal into "Projects": followEditor's
  // own reveal-on-open behavior has a known race with the tree's initial
  // paint, so this proves the view answers with real content immediately
  // rather than depending on that reveal.
  await expect(frame.locator("[data-path='Projects']")).toBeVisible({
    timeout: 20_000,
  });
  await expect(frame.locator("[data-path='Journal']")).toBeVisible();
});

test("the collision error also covers a sidebar-docked built-in (std.spaceTree)", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigate: Tree");
  const frame = sbPage.frameLocator(".sb-keyed-panel-lhs iframe");
  await expect(frame.locator("[data-path='Projects']")).toBeVisible({
    timeout: 20_000,
  });
  await expect(frame.locator(".sb-nav-title")).toHaveText("Open");

  const collision = await evalPcall(
    sbPage,
    `
      navigator.define {
        name = "std.spaceTree",
        title = "Redefined Tree",
        dock = "lhs",
        source = function()
          return { { name = "Only Mine", ref = "Only Mine" } }
        end,
        onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
      }
    `,
  );
  expect(collision.ok).toBe(false);
  expect(collision.result).toContain("std.spaceTree");

  await sbPage.locator("#sb-editor .cm-content").click();

  await runCommandViaPalette(sbPage, "Navigate: Tree");
  await expect(frame.locator(".sb-nav-title")).toHaveText("Open");
  await expect(frame.locator("[data-path='Projects']")).toBeVisible();
});

test("Cmd-o/Ctrl-o opens the space tree, not the (now keyless) document picker", async ({
  sbPage,
}) => {
  await sbPage.keyboard.press(`${mod}+o`);

  const frame = sbPage.frameLocator(".sb-keyed-panel-lhs iframe");
  await expect(frame.locator("[data-path='Projects']")).toBeVisible({
    timeout: 20_000,
  });
  // A modal is what the old (now-removed) Cmd-o/Ctrl-o binding opened, so
  // this proves that binding is really gone, not just superseded visually.
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  await sbPage.locator("#sb-editor .cm-content").click();

  await runCommandViaPalette(sbPage, "Navigate: Document Picker");
  await expect(navFrame(sbPage).locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Document",
    { timeout: 20_000 },
  );
});
