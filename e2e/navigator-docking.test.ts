import type { Page } from "@playwright/test";
import { expect, gotoSilverBulletPage, mod, test } from "./fixtures.ts";
import {
  openPagePicker,
  openPicker,
  runCommandViaPalette,
} from "./navigator-ui.ts";

test.use({
  spaceFiles: {
    "index.md": "Welcome",
    "Projects/Alpha.md": "# Alpha",
  },
});

test("dock menu moves the space tree to the right sidebar and persists", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigate: Tree");
  const lhs = sbPage.locator(".sb-nav-root-lhs");
  await expect(lhs).toBeVisible();

  await lhs.locator(".sb-dock-button").click();
  await lhs.locator(".sb-dock-menu-item", { hasText: "Right sidebar" }).click();

  const rhs = sbPage.locator(".sb-nav-root-rhs");
  await expect(rhs).toBeVisible();
  await expect(sbPage.locator(".sb-nav-root-lhs")).toHaveCount(0);

  await sbPage.reload();
  await expect(sbPage.locator(".sb-nav-root-rhs")).toBeVisible({
    timeout: 20_000,
  });
});

test("dock menu is hidden for a single-dock view", async ({ sbPage }) => {
  // std.commands (the Command Palette itself) is modal-only -- no
  // supportedDocks, so there's nowhere else to move it and the dock menu
  // stays hidden. std.toc (Navigate: Table of Contents) no longer fits this
  // example: it's multi-dock now (`supportedDocks` in Widgets.md's `std.toc`).
  const frame = await openPicker(sbPage, `${mod}+/`, "Command");
  await expect(frame.locator(".sb-dock-button")).toHaveCount(0);
});

test("Navigate: Table of Contents opens as a modal by default, pins to a sidebar via the dock menu, and persists there across re-navigation", async ({
  sbPage,
  sbServer,
}) => {
  await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
  const modal = sbPage.locator(".sb-nav-root-modal");
  await expect(modal).toBeVisible();
  await expect(modal.locator(".sb-nav-title")).toHaveText("Table of Contents");

  await modal.locator(".sb-dock-button").click();
  await modal
    .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
    .click();

  const rhs = sbPage.locator(".sb-nav-root-rhs");
  await expect(rhs).toBeVisible();
  await expect(rhs.locator(".sb-nav-title")).toHaveText("Table of Contents");
  // Picking a dock from the modal's own menu closes the modal it was picked
  // from -- moveDock hides `before` even when that's "modal", not just a
  // window dock.
  await expect(sbPage.locator(".sb-nav-root-modal")).toHaveCount(0);

  // A plain page.reload() loses the `?headless=1` the fixture booted with;
  // re-navigate through the fixture helper instead (Task 7's pattern).
  await gotoSilverBulletPage(sbPage, sbServer, "Projects/Alpha");
  await expect(sbPage.locator(".sb-nav-root-rhs")).toBeVisible();
  await expect(sbPage.locator(".sb-nav-root-rhs .sb-nav-title")).toHaveText(
    "Table of Contents",
  );
});

test("the modal's close button hides it", async ({ sbPage }) => {
  const frame = await openPagePicker(sbPage);
  await frame.locator(".sb-nav-close").click();
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);
});

// A page-docked view with nothing to show renders nothing at all: no title
// bar, no dock menu, no ×, and no reserved height in the slot. Asserted per
// view, because each reaches "empty" by a different route -- the ToC through
// its `minHeaders` gate, the other two through an empty query.

/**
 * Wait until a page slot has actually finished putting its widgets in the DOM.
 *
 * `expect(".sb-page-slot-page-top").toHaveCount(1)` looks like a readiness gate
 * and is not one: `postScriptPrefacePlugin` pushes the slot decoration
 * unconditionally, so the element exists long before any view has resolved. A
 * `toHaveCount(0)` that follows it is therefore unsynchronised and can pass
 * simply by running early.
 *
 * Nor is "wait for the reserved `min-height` to clear": that is only ever set
 * when a cached height exists and is greater than zero, so an empty slot never
 * carries it and the poll passes on its first evaluation. The slot stamps
 * `data-settled` in `NavPageSlotWidget.measure` instead, once every view in it
 * has reported -- that is the real signal, and it is asserted here.
 */
/**
 * Drop a page slot's settle stamp, so the wait that follows can only be
 * satisfied by a *fresh* one.
 *
 * Needed before any action that rebuilds the editor without navigating -- a
 * command, or a dock-menu move. `views/commands.ts` awaits `hide("modal")`
 * *before* running the command, so the test helper returns while `open()` is
 * still in its `resolveDock` -> `setOpen` -> `rebuildEditorState()` chain, and
 * until `setState` runs the outgoing slot div is still in the document wearing
 * the previous render's stamp. Waiting on that is waiting on nothing.
 */
async function clearSlotStamp(
  page: Page,
  slot: "page-top" | "page-bottom",
): Promise<void> {
  await page
    .locator(`.sb-page-slot-${slot}`)
    .evaluate((el) => {
      delete (el as HTMLElement).dataset.settled;
    })
    // Not mounted yet is fine: there is no stale stamp to strip.
    .catch(() => {});
}

async function expectSlotSettled(
  page: Page,
  slot: "page-top" | "page-bottom",
): Promise<void> {
  await expect(
    page.locator(`.sb-page-slot-${slot}[data-settled="1"]`),
  ).toHaveCount(1, { timeout: 30_000 });
}

test.describe("an empty page-docked view renders no chrome at all", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      // Two headers, under the default `minHeaders` of 3.
      "Sparse.md": "# One\n\nsome text\n\n# Two\n\nmore text\n",
      // Three: exactly at the floor, so it must render.
      "Ample.md": "# One\n\na\n\n# Two\n\nb\n\n# Three\n\nc\n",
      "Lonely.md": "# Lonely\n\nNothing links here, and no tasks mention it.\n",
      "CONFIG.md": [
        "```space-lua",
        // Dock all three to page-top so one page exercises every view.
        'config.set("view.docks", {',
        '  ["std.toc"] = "page-top",',
        '  ["std.linkedMentions"] = "page-top",',
        '  ["std.linkedTasks"] = "page-top",',
        "})",
        "```",
        "",
      ].join("\n"),
    },
  });

  test("a page under minHeaders shows no Table of Contents, and a page with no mentions or tasks shows neither", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Sparse");
    // std.toc is closed until asked for (`defaultOpen = false`), so it has to
    // be opened before "renders nothing" means anything -- otherwise this
    // passes for the wrong reason, on a view that was never going to appear.
    // Only a fresh settle may satisfy the wait below.
    await clearSlotStamp(page, "page-top");
    // Its resolved dock is page-top (`view.docks` above), so the command opens
    // it there rather than as a modal.
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    // A real barrier -- see `expectSlotSettled`. The negative assertions below
    // are meaningless without it.
    await expectSlotSettled(page, "page-top");
    await expect(
      page.locator('.sb-page-widget[data-view="std.toc"]'),
    ).toHaveCount(0);

    // Not a single scrap of chrome from any of the three.
    await expect(
      page.locator(".sb-page-slot-page-top .sb-page-widget"),
    ).toHaveCount(0);
    await expect(
      page.locator(".sb-page-slot-page-top .sb-page-widget-bar"),
    ).toHaveCount(0);
    await expect(
      page.locator(".sb-page-slot-page-top .sb-nav-close"),
    ).toHaveCount(0);
    const slotHeight = () =>
      page
        .locator(".sb-page-slot-page-top")
        .evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
    expect(await slotHeight()).toBe(0);

    // ...and it is still 0 after leaving and coming back. This does not observe
    // the height *cache* directly -- `NavPageSlotWidget.measure` clears
    // `minHeight` in a `setTimeout(0)` that has long since fired by the time
    // the await below resolves, so what is read here is always post-clear. What
    // it does prove is the end state a reader sees on a return visit, which is
    // where a phantom gap would be visible.
    await gotoSilverBulletPage(page, sbServer, "index");
    // Only a fresh settle may satisfy the wait below.
    await clearSlotStamp(page, "page-top");
    await gotoSilverBulletPage(page, sbServer, "Sparse");
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    // A real barrier -- see `expectSlotSettled`. The negative assertions below
    // are meaningless without it.
    await expectSlotSettled(page, "page-top");
    expect(await slotHeight()).toBe(0);

    // Same for a page nothing links to: no mentions widget, no tasks widget.
    await gotoSilverBulletPage(page, sbServer, "Lonely");
    // A real barrier -- see `expectSlotSettled`. The negative assertions below
    // are meaningless without it.
    await expectSlotSettled(page, "page-top");
    await expect(
      page.locator('.sb-page-widget[data-view="std.linkedMentions"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('.sb-page-widget[data-view="std.linkedTasks"]'),
    ).toHaveCount(0);
  });

  // The other half of the gate: at or above the floor it does render. Without
  // this, "renders nothing" would also pass if the ToC were broken outright.
  test("a page at minHeaders does render a Table of Contents", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Ample");
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    await expect(
      page.locator('.sb-page-widget[data-view="std.toc"]'),
    ).toBeVisible({ timeout: 30_000 });
  });
});

// The gate is a property of the *dock*, not of the outline: in a panel you
// asked for this page's headers deliberately, so you get them however few.
// This pair is the requirement -- either half alone proves nothing.
test.describe("the minHeaders gate applies to page docks only", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Sparse.md": "# One\n\nsome text\n\n# Two\n\nmore text\n",
    },
  });

  test("a 2-header page shows both headers in the modal, and no ToC once docked page-top", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Sparse");

    // Modal (std.toc's own default dock): two headers, well under the floor
    // of 3, and both are shown -- you opened the view deliberately.
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    const modal = page.locator(".sb-nav-root-modal");
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await expect(modal.locator(".sb-nav-row")).toHaveCount(2);
    await expect(modal.locator(".sb-nav-primary").first()).toHaveText("One");
    await expect(modal.locator(".sb-nav-primary").nth(1)).toHaveText("Two");

    // The same view, the same page, moved to a page dock by the gesture this
    // feature exists for: now the floor applies and it renders nothing at all.
    // Only a fresh settle may satisfy the wait below.
    await clearSlotStamp(page, "page-top");
    await modal.locator(".sb-dock-button").click();
    await modal
      .locator(".sb-dock-menu-item", { hasText: "Top of page" })
      .click();
    await expect(page.locator(".sb-nav-root-modal")).toHaveCount(0);
    // A real barrier -- see `expectSlotSettled`. The negative assertions below
    // are meaningless without it.
    await expectSlotSettled(page, "page-top");
    await expect(
      page.locator('.sb-page-widget[data-view="std.toc"]'),
    ).toHaveCount(0);
  });
});

test.describe("minHeaders is read from config, not baked in", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Ample.md": "# One\n\na\n\n# Two\n\nb\n\n# Three\n\nc\n",
      // Five headers: clears the raised floor, so it must still render.
      "Plenty.md": "# A\n\na\n\n# B\n\nb\n\n# C\n\nc\n\n# D\n\nd\n\n# E\n\ne\n",
      "CONFIG.md": [
        "```space-lua",
        'config.set("view.docks", { ["std.toc"] = "page-top" })',
        // Three headers would clear the default floor of 3; this raises it.
        'config.set("std.widgets.toc.minHeaders", 5)',
        "```",
        "",
      ].join("\n"),
    },
  });

  // The positive control. Both `config.set` calls live in one Lua block, so if
  // the second threw, the first would never apply either: the ToC would open as
  // a modal and the count-0 assertion below would pass for entirely the wrong
  // reason. This proves the block ran and the dock took effect.
  test("the dock config applied, so a page under the raised floor is a real absence", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Plenty");
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    await expect(
      page.locator(
        '.sb-page-slot-page-top .sb-page-widget[data-view="std.toc"]',
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".sb-nav-root-modal")).toHaveCount(0);
  });

  test("raising minHeaders hides a Table of Contents that would otherwise render", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Ample");
    // std.toc is closed until asked for (`defaultOpen = false`), so without
    // Only a fresh settle may satisfy the wait below.
    await clearSlotStamp(page, "page-top");
    // this the count-0 assertion below passes even with the whole `minHeaders`
    // gate deleted -- `pageSlotViews` would have excluded the view anyway.
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    // A real barrier -- see `expectSlotSettled`. The negative assertions below
    // are meaningless without it.
    await expectSlotSettled(page, "page-top");
    await expect(
      page.locator('.sb-page-widget[data-view="std.toc"]'),
    ).toHaveCount(0);
  });
});

// Item 4: a tree-mode view in a page dock draws through the shared `TreeView`,
// so it nests and expands there as it does in a panel.
test.describe("a page-docked tree expands and collapses", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      // Nested, so there is something to expand. Four headers clears the
      // default `minHeaders` floor of 3.
      "Nested.md": [
        "# Top",
        "",
        "## Child A",
        "",
        "### Grandchild",
        "",
        "## Child B",
        "",
        "text",
      ].join("\n"),
      "CONFIG.md": [
        "```space-lua",
        'config.set("view.docks", { ["std.toc"] = "page-top" })',
        "```",
        "",
      ].join("\n"),
    },
  });

  test("starts fully expanded, and a chevron collapses and restores its subtree", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Nested");
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    const widget = page.locator('.sb-page-widget[data-view="std.toc"]');
    await expect(widget).toBeVisible({ timeout: 30_000 });

    // `expandAll` plus an empty set: every header is on screen to begin with.
    const rows = widget.locator(".sb-nav-row");
    await expect(rows).toHaveCount(4);
    await expect(widget.locator(".sb-nav-primary").nth(0)).toHaveText("Top");
    await expect(widget.locator(".sb-nav-primary").nth(1)).toHaveText(
      "Child A",
    );
    await expect(widget.locator(".sb-nav-primary").nth(2)).toHaveText(
      "Grandchild",
    );

    // Leaves keep the spacer, so their labels stay aligned with their
    // siblings' rather than sliding under the chevron column.
    await expect(
      widget.locator(".sb-nav-chevron-spacer").first(),
    ).toBeAttached();

    // Addressed by `data-path`, not by text: every ancestor `.sb-treeitem`
    // also "has text" Child A, so a text locator would pick the outermost one
    // and collapse the whole tree instead.
    const childA = widget.locator('.sb-nav-row[data-path="Top/Child A"]');
    await childA.locator(".sb-nav-chevron").click();
    await expect(rows).toHaveCount(3);
    await expect(
      widget.locator(".sb-nav-primary", { hasText: "Grandchild" }),
    ).toHaveCount(0);
    await expect(
      widget.locator(".sb-nav-primary", { hasText: "Child B" }),
    ).toHaveCount(1);

    // And back.
    await childA.locator(".sb-nav-chevron").click();
    await expect(rows).toHaveCount(4);
  });

  test("expansion is ephemeral: a fresh visit is fully expanded again", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Nested");
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    const widget = page.locator('.sb-page-widget[data-view="std.toc"]');
    await expect(widget.locator(".sb-nav-row")).toHaveCount(4, {
      timeout: 30_000,
    });

    await widget
      .locator('.sb-nav-row[data-path="Top/Child A"] .sb-nav-chevron')
      .click();
    await expect(widget.locator(".sb-nav-row")).toHaveCount(3);

    // `std.toc` is `expansionScope = "page"`: its paths are *this* page's
    // headers, so nothing is persisted -- in a page dock exactly as in a
    // panel. A stored set would otherwise land on another page's rows.
    await gotoSilverBulletPage(page, sbServer, "Nested");
    await expect(widget.locator(".sb-nav-row")).toHaveCount(4, {
      timeout: 30_000,
    });
  });

  test("Left collapses and Right expands the focused row", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Nested");
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    const widget = page.locator('.sb-page-widget[data-view="std.toc"]');
    await expect(widget.locator(".sb-nav-row")).toHaveCount(4, {
      timeout: 30_000,
    });

    // A page dock has no filter input, so the row itself takes the key.
    const childA = widget.locator('.sb-nav-row[data-path="Top/Child A"]');
    await childA.focus();
    await childA.press("ArrowLeft");
    await expect(widget.locator(".sb-nav-row")).toHaveCount(3);

    await widget
      .locator('.sb-nav-row[data-path="Top/Child A"]')
      .press("ArrowRight");
    await expect(widget.locator(".sb-nav-row")).toHaveCount(4);
  });
});

// Round 3: the page-docked tree's horizontal geometry. Relationships, not
// pixel values -- the numbers move with font and theme, the relationships must
// not. Depth 2 is asserted deliberately: the bug this guards against was the
// browser's default `<ul>` padding accumulating *per nesting level*, which
// depth 0 and 1 alone would under-report.
test.describe("page-docked tree geometry", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Deep.md": "# One\n\n## Two\n\n### Three\n\n# Four\n\ntext\n",
      "CONFIG.md": [
        "```space-lua",
        'config.set("view.docks", { ["std.toc"] = "page-top" })',
        "```",
        "",
      ].join("\n"),
    },
  });

  test("depth 0 sits at the widget's own inset, and each level adds one modest step", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Deep");
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    const widget = page.locator('.sb-page-widget[data-view="std.toc"]');
    await expect(widget.locator(".sb-nav-row")).toHaveCount(4, {
      timeout: 30_000,
    });

    const g = await page.evaluate(() => {
      const w = document.querySelector(
        '.sb-page-widget[data-view="std.toc"]',
      ) as HTMLElement;
      const at = (path: string) => {
        const row = w.querySelector(
          `.sb-nav-row[data-path="${path}"]`,
        ) as HTMLElement;
        const mark = row.querySelector(
          ".sb-nav-chevron, .sb-nav-chevron-spacer",
        ) as HTMLElement;
        return mark.getBoundingClientRect().left;
      };
      const body = w.querySelector(".sb-page-widget-body") as HTMLElement;
      return {
        widget: w.getBoundingClientRect().left,
        bodyInset:
          body.getBoundingClientRect().left -
          w.getBoundingClientRect().left +
          parseFloat(getComputedStyle(body).paddingLeft),
        d0: at("One"),
        d1: at("One/Two"),
        d2: at("One/Two/Three"),
        // The *root* font-size: `TreeView`'s step is `1.2rem`, so bounding it
        // against the widget's own em would drift the moment either is themed.
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      };
    });

    // Depth 0 begins at the widget's content inset -- not a whole list gutter
    // beyond it. Tolerance covers the border and sub-pixel rounding.
    expect(Math.abs(g.d0 - g.widget - g.bodyInset)).toBeLessThanOrEqual(2);

    // Each level adds the same modest step. "> previous" would pass at 40px a
    // level, which is precisely the bug -- so the step is bounded above.
    const step1 = g.d1 - g.d0;
    const step2 = g.d2 - g.d1;
    expect(step1).toBeGreaterThan(0.5 * g.rem);
    expect(step1).toBeLessThan(2 * g.rem);
    expect(Math.abs(step2 - step1)).toBeLessThanOrEqual(1);
  });

  test("the widget title is bold, in the editor's ordinary text colour", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Deep");
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    const widget = page.locator('.sb-page-widget[data-view="std.toc"]');
    await expect(widget).toBeVisible({ timeout: 30_000 });

    const t = await page.evaluate(() => {
      const title = document.querySelector(
        ".sb-page-widget-title",
      ) as HTMLElement;
      const cs = getComputedStyle(title);
      return {
        weight: Number(cs.fontWeight),
        color: cs.color,
        // Not blue: the same ink the prose around the widget is drawn in.
        editorColor: getComputedStyle(
          document.querySelector(".cm-content") as HTMLElement,
        ).color,
      };
    });
    expect(t.weight).toBeGreaterThanOrEqual(600);
    expect(t.color).toBe(t.editorColor);
  });
});

// The three title-bar buttons are one set. Asserted in both containers,
// because the panel's title bar has different typography and a centring that
// only worked against the editor font would be wrong there.
// A short panel used to clip its own dock menu: `.sb-nav-root` is
// `overflow: hidden` and the menu was absolutely positioned inside it, so on a
// one-header page four of the five items were cut off and un-clickable -- the
// only gesture for moving a view, broken in the ToC's default container. Every
// other test here uses a tall modal, which is why it went unnoticed.
test.describe("the dock menu is not clipped by a short panel", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      // One header: about the shortest the ToC modal ever gets.
      "Short.md": "# Only\n\ntext\n",
    },
  });

  test("every item is reachable in a modal shorter than the menu", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Short");
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    const modal = page.locator(".sb-nav-root-modal");
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await modal.locator(".sb-dock-button").click();

    const menu = page.locator(".sb-dock-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".sb-dock-menu-item")).toHaveCount(5);

    // Hit-testing, not `toBeVisible()`: Playwright's visibility check ignores
    // ancestor clipping, so it reported all five as visible even when four
    // were clipped away. What matters is whether a click would land.
    const reachable = await page.evaluate(() =>
      [...document.querySelectorAll(".sb-dock-menu-item")].map((item) => {
        const r = item.getBoundingClientRect();
        const at = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return item === at || item.contains(at as Node);
      }),
    );
    expect(reachable).toEqual([true, true, true, true, true]);

    // And the gesture itself still works from a short panel.
    await menu
      .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
      .click();
    await expect(page.locator(".sb-nav-root-rhs")).toBeVisible();
  });
});

// Two behavioural fixes that shipped untested in the previous wave.
test.describe("opening a page-docked view puts focus somewhere usable", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Target.md": "# Target\n",
      "Source.md": "mentions [[Target]]\n",
    },
  });

  test("the command lands focus inside the widget, not on the body", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Target");
    await expect(
      page.locator('.sb-page-widget[data-view="std.linkedMentions"]'),
    ).toBeVisible({ timeout: 30_000 });

    // Park focus somewhere unrelated first, so passing means the command
    // *moved* it rather than that it happened to be right already.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await runCommandViaPalette(page, "Navigate: Linked Mentions");

    // Polled: `runCommandViaPalette` returns once the command has been
    // dispatched, while the reveal is still waiting for the widget. The
    // assertion is about where focus settles.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const active = document.activeElement as HTMLElement | null;
            const widget = document.querySelector(
              '.sb-page-widget[data-view="std.linkedMentions"]',
            );
            if (!active || active === document.body) return "body";
            return widget?.contains(active) ? "widget" : "elsewhere";
          }),
        { timeout: 10_000 },
      )
      // The regression: the palette skipped its own `editor.focus()` because
      // the command claimed it had taken focus, and nothing had -- so typing
      // did nothing and the arrows scrolled the page.
      .toBe("widget");
  });
});

test.describe("a page-docked view with nothing to show hands focus back promptly", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      // Nothing links here, so `std.linkedMentions` -- which ships
      // `dock = "page-bottom"`, `defaultOpen = true` -- renders no widget at
      // all. An entirely ordinary page, not a contrived one.
      "Lonely.md": "# Lonely\n\nnothing links here\n",
    },
  });

  test("the keyboard is usable again in well under the backstop timeout", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Lonely");
    await expect(
      page.locator('.sb-page-widget[data-view="std.linkedMentions"]'),
    ).toHaveCount(0, { timeout: 30_000 });
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

    // `revealPageWidget` blocks `open()`, which blocks the palette's fallback
    // `editor.focus()`. If it waits out its 3s backstop instead of exiting on
    // the settled-slot signal, the keyboard is dead for three seconds: typing
    // does nothing and the arrows scroll the page -- the same §5 symptom as
    // before, merely time-boxed.
    const started = Date.now();
    await runCommandViaPalette(page, "Navigate: Linked Mentions");
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const active = document.activeElement as HTMLElement | null;
            return !!active?.closest(".cm-content");
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
    // Comfortably under the 3000ms backstop, and generous enough not to be
    // flaky on a slow box: the point is that the backstop is not what ends it.
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

test.describe("a content view is never revealed before its content", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Target.md": "# Target\n",
      "Source.md": "mentions [[Target]]\n",
      "CONFIG.md": [
        "```space-lua",
        'config.set("view.docks", { ["std.linkedMentions"] = "modal" })',
        "```",
        "",
      ].join("\n"),
    },
  });

  test("the modal has its markdown in the DOM on the first frame it is shown", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Target");

    // A MutationObserver on the class attribute, not a frame sampler: the
    // reveal is a single class change, and the gap it opens can be shorter
    // than a frame -- an rAF sampler misses it and passes even with the gate
    // removed (verified). This inspects the DOM at the exact instant the modal
    // stops being paint-pending.
    await page.evaluate(() => {
      (globalThis as any).__bad = 0;
      (globalThis as any).__seen = 0;
      const check = (modal: Element) => {
        const title = modal.querySelector(".sb-nav-title");
        if (title?.textContent?.trim() !== "Linked Mentions") return;
        if (modal.classList.contains("sb-modal-paint-pending")) return;
        (globalThis as any).__seen++;
        const body = modal.querySelector(".sb-nav-content");
        if (!body || body.childElementCount === 0) (globalThis as any).__bad++;
      };
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "attributes" && r.target instanceof Element) {
            const modal = (r.target as Element).closest(".sb-modal-centered");
            if (modal) check(modal);
          }
          for (const added of r.addedNodes) {
            if (!(added instanceof Element)) continue;
            const modal = added.matches?.(".sb-modal-centered")
              ? added
              : added.querySelector?.(".sb-modal-centered");
            if (modal) check(modal);
          }
        }
      }).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    });

    await runCommandViaPalette(page, "Navigate: Linked Mentions");
    await expect(
      page.locator(".sb-nav-root-modal .sb-nav-content"),
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);

    const r = await page.evaluate(() => ({
      bad: (globalThis as any).__bad as number,
      seen: (globalThis as any).__seen as number,
    }));
    // `bad === 0` is the load-bearing assertion. `seen` only rules out "the
    // modal never opened at all" -- which the `toBeVisible` above already
    // covers -- and does *not* prove the reveal instant itself was observed,
    // since it increments on any qualifying mutation while the modal is up.
    expect(r.seen).toBeGreaterThan(0);
    expect(r.bad).toBe(0);
  });
});

test.describe("title-bar buttons read as one set", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Target.md": "# Target\n",
      "Source.md": "mentions [[Target]]\n",
    },
  });

  const geometry = async (page: any, root: string) => {
    // Wait for all three buttons to exist before measuring. The panel root
    // becoming visible is not enough: the Copy button is rendered only once
    // the view's content has loaded (`content && !fatalError` in nav_root),
    // so measuring on visibility alone raced it and read a one-button row --
    // which is what made this flaky on WebKit, where the panel paints sooner
    // relative to the content load.
    await expect(
      page.locator(`${root} :is(.sb-nav-copy, .sb-dock-button, .sb-nav-close)`),
    ).toHaveCount(3);
    return await page.evaluate((sel: string) => {
      const w = document.querySelector(sel) as HTMLElement;
      return [
        ...w.querySelectorAll(".sb-nav-copy, .sb-dock-button, .sb-nav-close"),
      ].map((b) => {
        const r = b.getBoundingClientRect();
        const svg = b.querySelector("svg") as SVGElement | null;
        const sr = svg?.getBoundingClientRect();
        return {
          cy: r.top + r.height / 2,
          cx: r.left + r.width / 2,
          iconW: sr ? sr.width : 0,
          iconH: sr ? sr.height : 0,
        };
      });
    }, root);
  };

  const assertOneSet = (b: any[]) => {
    expect(b).toHaveLength(3);
    // A common vertical centre.
    const cys = b.map((x) => x.cy);
    expect(Math.max(...cys) - Math.min(...cys)).toBeLessThanOrEqual(1);
    // One rendered glyph size across all three.
    for (const x of b) {
      expect(x.iconW).toBeGreaterThan(0);
      expect(Math.abs(x.iconW - b[0].iconW)).toBeLessThanOrEqual(1);
      expect(Math.abs(x.iconH - b[0].iconH)).toBeLessThanOrEqual(1);
    }
    // Even horizontal spacing.
    const gaps = [b[1].cx - b[0].cx, b[2].cx - b[1].cx];
    expect(Math.abs(gaps[0] - gaps[1])).toBeLessThanOrEqual(1);
  };

  test("aligned in a page dock, and in the rhs panel", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Target");
    const widget = page.locator(
      '.sb-page-widget[data-view="std.linkedMentions"]',
    );
    await expect(widget).toBeVisible({ timeout: 30_000 });
    assertOneSet(
      await geometry(page, '.sb-page-widget[data-view="std.linkedMentions"]'),
    );

    await widget.locator(".sb-dock-button").click();
    await widget
      .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
      .click();
    await expect(page.locator(".sb-nav-root-rhs")).toBeVisible();
    assertOneSet(await geometry(page, ".sb-nav-root-rhs"));
  });
});

// Round 4: the *wiring* of the no-op refresh skip, not just the comparison.
// Both bugs that slipped through round 3 lived in the widget, not the helpers.
test.describe("a refresh that changes nothing changes nothing", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Typed.md": "# One\n\na\n\n# Two\n\nb\n\n# Three\n\ntail\n",
      "CONFIG.md": [
        "```space-lua",
        'config.set("view.docks", { ["std.toc"] = "page-top" })',
        "```",
        "",
      ].join("\n"),
    },
  });

  test("typing below the last header leaves the ToC untouched; adding a header redraws it", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Typed");
    await runCommandViaPalette(page, "Navigate: Table of Contents");
    const widget = page.locator('.sb-page-widget[data-view="std.toc"]');
    await expect(widget.locator(".sb-nav-row")).toHaveCount(3, {
      timeout: 30_000,
    });

    // Count every mutation inside the widget body, so a re-render that
    // produces identical markup still registers.
    const watch = () =>
      page.evaluate(() => {
        const body = document.querySelector(
          '.sb-page-widget[data-view="std.toc"] .sb-page-widget-body',
        ) as HTMLElement;
        (globalThis as any).__muts = 0;
        (globalThis as any).__obs?.disconnect();
        const obs = new MutationObserver((records) => {
          (globalThis as any).__muts += records.length;
        });
        obs.observe(body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        (globalThis as any).__obs = obs;
      });
    const muts = () =>
      page.evaluate(() => (globalThis as any).__muts as number);

    // Put the cursor at the very end -- past every header, so no header's text
    // *or* position changes.
    const lastLine = page.locator(".cm-line").last();
    await lastLine.click();
    await page.keyboard.press("End");

    await watch();
    await page.keyboard.type(" and more");
    // Comfortably past the 300ms refresh debounce.
    await page.waitForTimeout(1200);
    await expect(widget.locator(".sb-nav-row")).toHaveCount(3);
    expect(await muts()).toBe(0);

    // The contrast case, and the reason the assertion above is not vacuous: a
    // change the ToC *does* care about must still redraw it. Without this, a
    // refresh that silently stopped firing would pass the check above.
    await watch();
    await page.keyboard.press("Enter");
    await page.keyboard.type("# Four");
    await expect(widget.locator(".sb-nav-row")).toHaveCount(4, {
      timeout: 10_000,
    });
    expect(await muts()).toBeGreaterThan(0);
  });
});

test.describe("linked mentions / linked tasks page widgets", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Target.md": "# Target\n\nNothing links here yet.\n",
      "Source.md": "This page mentions [[Target]] right here.\n",
      "TaskTarget.md": "# Task Target\n",
      "TaskSource.md": "* [ ] Do the thing [[TaskTarget]]\n",
    },
  });

  test("linked mentions renders as a page-bottom widget; × hides it persistently; its command restores it", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Target");

    const widget = page.locator(
      '.sb-page-widget[data-view="std.linkedMentions"]',
    );
    await expect(widget).toBeVisible({ timeout: 30_000 });
    // It renders in the bottom slot, i.e. after the content
    await expect(
      page.locator(".sb-page-slot-page-bottom .sb-page-widget"),
    ).toBeVisible();

    // × hides it
    await widget.locator(".sb-nav-close").click();
    await expect(widget).toBeHidden();

    // A plain page.reload() loses the `?headless=1` the fixture booted with
    // (client-side navigation rewrites the URL without it), so re-navigate
    // through the fixture helper instead -- same effect as a reload, but it
    // preserves the runtime hooks the readiness wait depends on.
    await gotoSilverBulletPage(page, sbServer, "Target");
    // NOT a bare `toBeHidden()` here: right after a re-navigation the
    // page-bottom slot has not mounted its widgets yet, so that assertion
    // passes regardless -- deleting the `setOpen(name, false)` from
    // `closeView` still satisfied it. Waiting for the slot to settle is the
    // barrier that makes this absence mean something.
    await expectSlotSettled(page, "page-bottom");
    await expect(widget).toHaveCount(0);

    // The command restores it in the same dock
    await runCommandViaPalette(page, "Navigate: Linked Mentions");
    await expect(widget).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(".sb-page-slot-page-bottom .sb-page-widget"),
    ).toBeVisible();
  });

  test("linked tasks renders into the page-top slot", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "TaskTarget");

    await expect(
      page.locator(
        '.sb-page-slot-page-top .sb-page-widget[data-view="std.linkedTasks"]',
      ),
    ).toBeVisible({ timeout: 30_000 });
  });

  // Task 12: linked mentions/tasks are *content* views -- they render real
  // markdown through the same pipeline an inline Lua widget does, rather than
  // a list of rows.
  test("the mentions widget renders real markdown, with a wiki link that navigates", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Target");

    const body = page.locator(
      '.sb-page-widget[data-view="std.linkedMentions"] .sb-nav-content',
    );
    await expect(body).toBeVisible({ timeout: 30_000 });
    // Rendered markdown, not a row list: the mention's header is bold (the
    // `**[[page@pos]]**` the template emits) and the snippet renders below it.
    await expect(body.locator("strong a.wiki-link").first()).toBeVisible();
    await expect(body.locator(".sb-nav-row")).toHaveCount(0);

    const link = body.locator('a.wiki-link[data-ref^="Source@"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Source",
    );
  });

  test("a task checkbox in the widget ticks, and writes the new state to the page the task lives on", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "TaskTarget");

    const body = page.locator(
      '.sb-page-widget[data-view="std.linkedTasks"] .sb-nav-content',
    );
    await expect(body).toBeVisible({ timeout: 30_000 });

    // `templates.taskItem` gives every task a `[[page@pos]]` ref, which is
    // what makes the rendered checkbox write back rather than sit there inert.
    const task = body.locator("span[data-external-task-ref]").first();
    await expect(task).toBeVisible();
    const checkbox = task.locator('input[type="checkbox"]').first();
    await expect(checkbox).not.toBeChecked();

    await checkbox.click();

    // The task is on another page, so the write goes through the space rather
    // than the open editor -- poll the server's own copy for it.
    await expect
      .poll(
        async () => {
          const resp = await fetch(`${sbServer.url}/.fs/TaskSource.md`);
          return resp.ok ? await resp.text() : "";
        },
        { timeout: 20_000 },
      )
      .toContain("* [x] Do the thing");
  });

  // Two tests, deliberately. What the user asked for is "copy the markdown
  // source, like an inline Lua widget does" -- that is the *wiring*, and it is
  // verified on every browser below by intercepting the clipboard API the
  // product actually calls. The real end-to-end read is chromium-only purely
  // because of a harness limit (see its skip), so keeping only that one would
  // have left the behaviour unverified on two of the three engines.
  test("the Copy button hands the markdown source to the clipboard API", async ({
    page,
    sbServer,
  }) => {
    // Installed before any app code runs. `editor.copyToClipboard` ends in
    // `navigator.clipboard.writeText`, so this captures exactly what the
    // product tried to copy -- no permissions involved, and it behaves
    // identically on all three engines.
    await page.addInitScript(() => {
      (globalThis as unknown as { __copied: string[] }).__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            (globalThis as unknown as { __copied: string[] }).__copied.push(
              text,
            );
            return Promise.resolve();
          },
        },
      });
    });
    await gotoSilverBulletPage(page, sbServer, "Target");

    const widget = page.locator(
      '.sb-page-widget[data-view="std.linkedMentions"]',
    );
    await expect(widget.locator(".sb-nav-content")).toBeVisible({
      timeout: 30_000,
    });

    await widget.locator(".sb-nav-copy").click();

    const copied = () =>
      page.evaluate(
        () => (globalThis as unknown as { __copied: string[] }).__copied,
      );
    await expect.poll(copied, { timeout: 10_000 }).toHaveLength(1);
    const text = (await copied())[0];
    // The markdown *source*, exactly as `widgets.linkedMentionsMarkdown()`
    // built it -- not the HTML it rendered to.
    expect(text).toContain("**[[Source@");
    expect(text).not.toContain("<");
  });

  test("the copied text really reaches the system clipboard", async ({
    page,
    sbServer,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "Harness limit, not a gap in the feature: Playwright implements " +
        "grantPermissions(['clipboard-read']) on Chromium only -- on Firefox " +
        "and WebKit that call itself throws 'Unknown permission: " +
        "clipboard-read' before any product code runs, so " +
        "navigator.clipboard.readText() is unreachable there. The wiring and " +
        "the copied payload are covered on all three engines by the test " +
        "above; this adds the real round-trip where the harness allows it.",
    );
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: sbServer.url,
      });
    await gotoSilverBulletPage(page, sbServer, "Target");

    const widget = page.locator(
      '.sb-page-widget[data-view="std.linkedMentions"]',
    );
    await expect(widget.locator(".sb-nav-content")).toBeVisible({
      timeout: 30_000,
    });

    await widget.locator(".sb-nav-copy").click();

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("**[[Source@");
    expect(copied).not.toContain("<");
  });

  test("a page-docked view inherits the editor's font; the same view in a sidebar does not", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Target");

    const widget = page.locator(
      '.sb-page-widget[data-view="std.linkedMentions"]',
    );
    await expect(widget.locator(".sb-nav-content")).toBeVisible({
      timeout: 30_000,
    });

    const fontOf = (selector: string) =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).fontFamily : "";
      }, selector);

    const editorFont = await fontOf("#sb-editor .cm-content");
    expect(editorFont).not.toBe("");
    // The page slot declares no font of its own (that override is what made a
    // docked view clash with the page it sits in), so the widget body resolves
    // to the editor's own family.
    expect(
      await fontOf(
        '.sb-page-widget[data-view="std.linkedMentions"] .sb-nav-content',
      ),
    ).toBe(editorFont);

    await widget.locator(".sb-dock-button").click();
    await widget
      .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
      .click();
    await expect(
      page.locator(".sb-nav-root-rhs .sb-nav-content"),
    ).toBeVisible();

    // ...and in a sidebar the same view is panel-styled instead.
    const panelFont = await fontOf(".sb-nav-root-rhs .sb-nav-content");
    expect(panelFont).not.toBe(editorFont);
    expect(panelFont).toBe(await fontOf(".sb-nav-root-rhs .sb-nav-title"));
  });

  test("collapsing a page-docked widget hides its body and survives a reload", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Target");

    const widget = page.locator(
      '.sb-page-widget[data-view="std.linkedMentions"]',
    );
    await expect(widget.locator(".sb-page-widget-body")).toBeVisible({
      timeout: 30_000,
    });

    await widget.locator(".sb-page-widget-fold").click();
    // Collapsed rolls the widget up to its title bar: the bar stays (so it can
    // be expanded, moved or closed), the body is gone.
    await expect(widget.locator(".sb-page-widget-bar")).toBeVisible();
    await expect(widget.locator(".sb-page-widget-body")).toHaveCount(0);

    // A plain page.reload() drops the `?headless=1` the fixture booted with.
    await gotoSilverBulletPage(page, sbServer, "Target");
    await expect(widget.locator(".sb-page-widget-bar")).toBeVisible({
      timeout: 30_000,
    });
    await expect(widget.locator(".sb-page-widget-body")).toHaveCount(0);

    // The title is the same toggle. Expanding back is deliberately *not*
    // re-asserted across a reload: expanded is the default, so that assertion
    // passes just as well with persistence broken entirely. The collapse half
    // above is what carries this test; this only pins the second toggle
    // target.
    await widget.locator(".sb-page-widget-title").click();
    await expect(widget.locator(".sb-page-widget-body")).toBeVisible();
  });

  test("the same content view pinned to the right sidebar renders the same markdown", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Target");

    const widget = page.locator(
      '.sb-page-widget[data-view="std.linkedMentions"]',
    );
    // `toBeVisible` is not enough to measure against: the page dock's
    // `ContentNode` renders an empty `.sb-nav-content` while its async render
    // is pending, and that div
    // has padding, so it has a box and counts as visible. Wait for the
    // rendered wrapper `parseHtmlString` produces -- exactly one child.
    await expect(widget.locator(".sb-nav-content > *")).toHaveCount(1, {
      timeout: 30_000,
    });
    const inPage = await widget.locator(".sb-nav-content").innerHTML();

    await widget.locator(".sb-dock-button").click();
    await widget
      .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
      .click();

    const rhs = page.locator(".sb-nav-root-rhs");
    await expect(rhs).toBeVisible();
    await expect(rhs.locator(".sb-nav-title")).toHaveText("Linked Mentions");
    // Same renderer, same nodes: only the frame around it differs. Same
    // barrier as above -- comparing on visibility alone raced the panel's own
    // render and read an empty div (the Firefox flake).
    await expect(rhs.locator(".sb-nav-content > *")).toHaveCount(1);
    expect(await rhs.locator(".sb-nav-content").innerHTML()).toBe(inPage);
    // A content view has no rows to filter, so the panel offers no filter
    // input -- and it carries the same Copy button the page dock did.
    await expect(rhs.locator(".sb-nav-header.sb-nav-no-filter")).toHaveCount(1);
    await expect(rhs.locator(".sb-nav-copy")).toHaveCount(1);
    // Collapse is a page-dock affordance: a sidebar is already its own
    // container, and it builds its own header rather than `WidgetBar`.
    await expect(rhs.locator(".sb-page-widget-fold")).toHaveCount(0);
  });
});

test("opening a second rhs view displaces the first; closing it brings the first back", async ({
  sbPage,
}) => {
  // Pin the Table of Contents to the right sidebar (opens as a modal by
  // default).
  await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
  const modal = sbPage.locator(".sb-nav-root-modal");
  await expect(modal).toBeVisible();
  await modal.locator(".sb-dock-button").click();
  await modal
    .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
    .click();
  await expect(sbPage.locator(".sb-nav-root-modal")).toHaveCount(0);

  const rhs = sbPage.locator(".sb-nav-root-rhs");
  await expect(rhs).toBeVisible();
  await expect(rhs.locator(".sb-nav-title")).toHaveText("Table of Contents");

  // Opening the Mention Inbox (also an rhs-docked view) displaces the
  // outline: the slot now shows the inbox instead, one-deep (spec §4).
  await runCommandViaPalette(sbPage, "Navigate: Mentions");
  await expect(rhs.locator(".sb-nav-title")).toHaveText("Mention Inbox");

  // Closing the inbox via its × restores the view it displaced -- passively,
  // like a boot restore -- rather than leaving the slot empty.
  await rhs.locator(".sb-nav-close").click();
  await expect(rhs).toBeVisible();
  await expect(rhs.locator(".sb-nav-title")).toHaveText("Table of Contents");
});

test.describe("mobile presentation", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    spaceFiles: {
      "index.md": "Welcome",
      "Target.md": "# Target\n\nNothing links here yet.\n",
      "Source.md": "This page mentions [[Target]] right here.\n",
    },
  });

  test("a page-bottom widget stays in the reading flow on a narrow viewport", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Target");

    const widget = page.locator(
      '.sb-page-widget[data-view="std.linkedMentions"]',
    );
    await expect(widget).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(".sb-page-slot-page-bottom .sb-page-widget"),
    ).toBeVisible();

    // In flow, not an overlay: the narrow-screen block in main.scss only
    // absolutely-positions `.sb-nav-root-lhs/rhs` (the drawer test below),
    // and never touches page slots -- so this widget keeps its normal
    // static/relative position rather than becoming a full-bleed drawer.
    await expect(widget).not.toHaveCSS("position", "absolute");
  });

  test("a view pinned to the right sidebar presents as a full-screen drawer", async ({
    sbPage,
  }) => {
    // Opens as a modal by default; pin it to the right sidebar.
    await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
    const modal = sbPage.locator(".sb-nav-root-modal");
    await expect(modal).toBeVisible();
    await modal.locator(".sb-dock-button").click();
    await modal
      .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
      .click();
    await expect(sbPage.locator(".sb-nav-root-modal")).toHaveCount(0);

    const rhs = sbPage.locator(".sb-nav-root-rhs");
    await expect(rhs).toBeVisible();
    await expect(rhs.locator(".sb-nav-title")).toHaveText("Table of Contents");

    // The narrow-screen block in main.scss turns a window dock into a
    // full-screen drawer (`position: absolute; inset: 0`) rather than the
    // ~260px sidebar column it gets at desktop width.
    await expect(rhs).toHaveCSS("position", "absolute");
    const box = (await rhs.boundingBox())!;
    expect(box.width).toBeGreaterThan(350);
    expect(box.x).toBeLessThan(5);
  });
});

test.describe("custom Lua page-dock view", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      // Deliberately still `navigator.define`, not `view.define`: this is
      // the one test in the navigator suite exercising the `navigator.*`
      // alias end to end (it's a permanent alias, not deprecated, so this
      // has to keep passing).
      "CONFIG.md": [
        "```space-lua",
        "navigator.define {",
        '  name = "test.pageView",',
        '  title = "Test Widget",',
        '  dock = "page-bottom",',
        '  supportedDocks = { "page-bottom", "rhs", "modal" },',
        "  defaultOpen = true,",
        '  source = function() return { { name = "hello row" } } end,',
        "  onSelect = function() end,",
        "}",
        "```",
        "",
      ].join("\n"),
    },
  });

  test("a custom navigator.define page-dock view renders and re-docks via its dock menu (navigator.* alias)", async ({
    sbPage,
  }) => {
    const widget = sbPage.locator('.sb-page-widget[data-view="test.pageView"]');
    await expect(widget).toBeVisible({ timeout: 30_000 });
    await expect(widget.locator(".sb-nav-primary")).toHaveText("hello row");

    await widget.locator(".sb-dock-button").click();
    const menuItems = widget.locator(".sb-dock-menu-item");
    await expect(menuItems).toHaveCount(3);
    await expect(menuItems).toHaveText([
      "Bottom of page",
      "Right sidebar",
      "Modal only",
    ]);

    await menuItems.filter({ hasText: "Right sidebar" }).click();
    await expect(sbPage.locator(".sb-nav-root-rhs")).toBeVisible();
    await expect(sbPage.locator(".sb-nav-root-rhs .sb-nav-title")).toHaveText(
      "Test Widget",
    );
    // Leaving the page-bottom slot unmounts the widget there.
    await expect(widget).toHaveCount(0);
  });
});

test.describe("navigator.docks config fallback", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      // `view.docks` is the canonical config key; `navigator.docks` (the
      // pre-rename name) is read as a fallback when it's absent. No
      // `view.docks` here on purpose -- this is what proves the fallback,
      // not just that the old key is still accepted somewhere.
      "CONFIG.md": [
        "```space-lua",
        'config.set("navigator.docks", { ["std.toc"] = "rhs" })',
        "```",
        "",
      ].join("\n"),
    },
  });

  test("navigator.docks (with no view.docks set) still steers a view's default dock", async ({
    sbPage,
  }) => {
    // With std.toc's space-wide default coming from the legacy key, opening
    // it for the very first time (no per-view datastore override yet) lands
    // directly in the right sidebar instead of the view's own "modal"
    // default.
    await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
    const rhs = sbPage.locator(".sb-nav-root-rhs");
    await expect(rhs).toBeVisible();
    await expect(rhs.locator(".sb-nav-title")).toHaveText("Table of Contents");
    await expect(sbPage.locator(".sb-nav-root-modal")).toHaveCount(0);
  });
});

// `resolveSpaceDocks` (client_system.ts) isn't reachable from a unit test in
// isolation: importing client_system.ts pulls in client_code_widget.ts ->
// widget_sandbox_iframe.ts, which creates a DOM iframe at module load time
// (`document is not defined` under vitest's node environment) -- so this is
// the e2e case the round-3 brief allows in that situation.
test.describe("view.docks config (the canonical key)", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "CONFIG.md": [
        "```space-lua",
        'config.set("view.docks", { ["std.toc"] = "rhs" })',
        "```",
        "",
      ].join("\n"),
    },
  });

  test("view.docks alone steers a view's default dock", async ({ sbPage }) => {
    await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
    const rhs = sbPage.locator(".sb-nav-root-rhs");
    await expect(rhs).toBeVisible();
    await expect(rhs.locator(".sb-nav-title")).toHaveText("Table of Contents");
    await expect(sbPage.locator(".sb-nav-root-modal")).toHaveCount(0);
  });
});

test.describe("view.docks wins over navigator.docks when both are set", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      // Two different, both-supported docks so a test landing in the wrong
      // one is unambiguous, not just "happened to also work".
      "CONFIG.md": [
        "```space-lua",
        'config.set("view.docks", { ["std.toc"] = "lhs" })',
        'config.set("navigator.docks", { ["std.toc"] = "rhs" })',
        "```",
        "",
      ].join("\n"),
    },
  });

  test("view.docks (lhs) wins; navigator.docks (rhs) is ignored", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
    const lhs = sbPage.locator(".sb-nav-root-lhs");
    await expect(lhs).toBeVisible();
    await expect(lhs.locator(".sb-nav-title")).toHaveText("Table of Contents");
    await expect(sbPage.locator(".sb-nav-root-rhs")).toHaveCount(0);
    await expect(sbPage.locator(".sb-nav-root-modal")).toHaveCount(0);
  });
});

// The page slots are block decorations at the document's edges, and
// CodeMirror only materialises DOM for the viewport -- so on a page taller
// than viewport + render margin, a page-bottom widget has no element while
// you are scrolled at the top. The reveal must scroll CM to the slot's
// position (which is also what materialises it), not wait for an element
// that can never appear.
test.describe("the command reveals a page-bottom widget beyond the viewport", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Tall.md": `# Tall\n\n${Array.from({ length: 120 }, (_, i) => `Paragraph ${i}.\n`).join("\n")}`,
      "Source.md": "mentions [[Tall]]\n",
    },
  });

  test("running it while scrolled at the top scrolls the widget into view", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Tall");
    await expect(page.locator("#sb-editor .cm-editor")).toBeVisible();

    // Precondition that keeps this test honest: at the top of this page the
    // widget must not have DOM at all (that is the virtualisation this test
    // covers). If a future change renders slots eagerly, this fails loudly
    // and the test needs a taller page -- rather than passing without ever
    // exercising the reveal-by-scroll path.
    await page.waitForTimeout(1_000);
    await expect(
      page.locator('.sb-page-widget[data-view="std.linkedMentions"]'),
    ).toHaveCount(0);

    await runCommandViaPalette(page, "Navigate: Linked Mentions");

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const widget = document.querySelector(
              '.sb-page-widget[data-view="std.linkedMentions"]',
            );
            if (!widget) return "missing";
            const rect = widget.getBoundingClientRect();
            return rect.top < window.innerHeight && rect.bottom > 0
              ? "visible"
              : "offscreen";
          }),
        { timeout: 10_000 },
      )
      .toBe("visible");

    // And it got there by scrolling the page, not by shrinking it.
    expect(
      await page.evaluate(
        () => document.querySelector(".cm-scroller")!.scrollTop,
      ),
    ).toBeGreaterThan(0);
  });
});

// The regression behind this: docs/"Space Lua.md" transcludes the API page
// (`![[API]]`), so the mention snippet stored for that link was itself a
// transclusion -- and the content pipeline, which deliberately expands
// transclusions, inlined the entire API page (raw frontmatter first) into
// API's own Linked Mentions widget. Snippets now neutralise `![[` to `[[`
// at index time, and a transcluded page's frontmatter is stripped on splice.
test.describe("a mention that transcludes the page stays a link in the widget", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Target.md": "---\nreferences:\n- some/file.ts\n---\n# Target\nTarget body text.\n",
      "Source.md": "# Embeds\n![[Target]]\n",
    },
  });

  test("the snippet shows a link, not the inlined page", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Target");
    const widget = page.locator(
      '.sb-page-widget[data-view="std.linkedMentions"]',
    );
    await expect(widget.locator(".sb-nav-content > *")).toHaveCount(1, {
      timeout: 30_000,
    });
    const text = await widget.locator(".sb-nav-content").innerText();
    // The mention itself, as a link back to where it lives.
    expect(text).toContain("Source@");
    // Neither the raw frontmatter nor the transcluded body may appear --
    // either one means the snippet inlined the page again.
    expect(text).not.toContain("references:");
    expect(text).not.toContain("Target body text");
  });
});
