import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FrameLocator, Page } from "@playwright/test";
import { expect, gotoSilverBulletPage, mod, type SBServer, test } from "./fixtures.ts";
import {
  expectNavInputFocused,
  navigateViaPagePicker,
  runCommandViaPalette,
} from "./navigator-ui.ts";

const NAV_CONFIG = `# Nav test
\`\`\`space-lua
navigator.define {
  name = "pages",
  title = "Pages",
  command = "Navigator: Pages",
  dock = "modal",
  presentation = { mode = "list" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator._flakyCalls = navigator._flakyCalls or 0
navigator.define {
  name = "flaky",
  title = "Flaky",
  command = "Navigator: Flaky",
  dock = "modal",
  source = function()
    navigator._flakyCalls = navigator._flakyCalls + 1
    error("source exploded " .. navigator._flakyCalls)
  end,
}

navigator.define {
  name = "sidebar",
  title = "Sidebar",
  command = "Navigator: Sidebar",
  dock = "lhs",
  presentation = { mode = "list" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator.define {
  name = "sidebarjournal",
  title = "Sidebar Journal",
  command = "Navigator: Sidebar Journal",
  dock = "lhs",
  presentation = { mode = "list" },
  source = function()
    local out = {}
    for _, p in ipairs(query [[from index.tag "page" order by _.name]]) do
      if string.sub(p.name, 1, 8) == "Journal/" then out[#out + 1] = p end
    end
    return out
  end,
}

navigator.define {
  name = "modaltree",
  title = "Modal Tree",
  command = "Navigator: Modal Tree",
  dock = "modal",
  presentation = { mode = "tree" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator.define {
  name = "sidebartree",
  title = "Sidebar Tree",
  command = "Navigator: Sidebar Tree",
  dock = "rhs",
  followEditor = true,
  presentation = { mode = "tree" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator.define {
  name = "createlist",
  title = "Create List",
  command = "Navigator: Create List",
  dock = "modal",
  create = true,
  presentation = { mode = "list" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator.define {
  name = "createtree",
  title = "Create Tree",
  command = "Navigator: Create Tree",
  dock = "modal",
  presentation = { mode = "tree" },
  onCreate = function(name) editor.navigate(name) end,
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

-- Synthetic + tiny, so "does this phrase prune the tree to nothing" doesn't
-- depend on what the background indexer has delivered yet.
navigator.define {
  name = "createtreesmall",
  title = "Create Tree Small",
  command = "Navigator: Create Tree Small",
  dock = "modal",
  create = true,
  presentation = { mode = "tree" },
  source = function()
    return { { name = "Alpha", ref = "Alpha" }, { name = "Beta", ref = "Beta" } }
  end,
}

navigator.define {
  name = "keymaptree",
  title = "Keymap Tree",
  command = "Navigator: Keymap Tree",
  dock = "rhs",
  followEditor = true,
  presentation = { mode = "tree" },
  keymap = {
    [" "] = function(obj) editor.navigate(obj.ref or obj.name) end,
  },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator.define {
  name = "keymaplist",
  title = "Keymap List",
  command = "Navigator: Keymap List",
  dock = "modal",
  presentation = { mode = "list" },
  keymap = {
    [" "] = function(obj) editor.navigate(obj.ref or obj.name) end,
  },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator.define {
  name = "createbulk",
  title = "Create Bulk",
  command = "Navigator: Create Bulk",
  dock = "modal",
  create = true,
  presentation = { mode = "list" },
  source = function()
    local out = {}
    for i = 1, 120 do
      local n = string.format("Item%03d", i)
      out[#out + 1] = { name = n, ref = n }
    end
    return out
  end,
}

navigator.define {
  name = "expandalltree",
  title = "Expand All Tree",
  command = "Navigator: Expand All Tree",
  dock = "rhs",
  presentation = { mode = "tree", expandAll = true },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator.define {
  name = "labeltree",
  title = "Label Tree",
  command = "Navigator: Label Tree",
  dock = "modal",
  presentation = {
    mode = "tree",
    expandAll = true,
    row = { primary = "label", label = "label" },
  },
  source = function()
    return {
      { name = "Top", label = "Top/Level" },
      { name = "Top/Child", label = "Child @1" },
    }
  end,
}

-- Synthetic rows: enough of them to scroll, and identical across refreshes so
-- a scroll-stability assertion isn't confounded by the dataset changing.
navigator.define {
  name = "scrolltree",
  title = "Scroll Tree",
  command = "Navigator: Scroll Tree",
  dock = "rhs",
  presentation = { mode = "tree" },
  source = function()
    local out = {}
    for i = 1, 120 do
      local n = string.format("Bulk%03d", i)
      out[#out + 1] = { name = n, ref = n }
    end
    return out
  end,
}
\`\`\`
`;

// A recognizable, assertable space style: the panel iframes get the user's
// space CSS via `panelStyles()`, so a row's outline color is a direct probe
// for "did the space style reach this panel".
const SPACE_STYLE = `# Styles
\`\`\`space-style
.sb-nav-row { outline-color: rgb(1, 2, 3); }
\`\`\`
`;

// This suite reaches its views through the command palette, and asserts on
// the *mechanisms* rather than on the built-in pickers -- which get their own
// suite (`navigator-pickers.test.ts`), where `Cmd-k` and friends are asserted
// for real.
test.use({
  spaceFiles: {
    "index.md": "Welcome",
    "navtest.md": NAV_CONFIG,
    "navstyle.md": SPACE_STYLE,
    "Projects/Alpha.md": "# Alpha",
    "Projects/Beta.md": "# Beta",
    "Journal/Today.md": "# Today",
  },
});

async function runCommand(sbPage: Page, command: string) {
  await runCommandViaPalette(sbPage, command);
}

async function openNavigator(sbPage: Page) {
  await runCommand(sbPage, "Navigator: Pages");
  const frame = sbPage.frameLocator(".sb-modal iframe");
  // Rows only appear once the ready/activate handshake completes, and
  // background indexing can deliver them in batches — wait (with retries) for
  // a page we know the space contains rather than for "some row".
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }),
  ).toBeVisible();
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Beta" }),
  ).toBeVisible();
  // Wait for the view's own phrase-reset effect to have already landed, so a
  // caller's immediate `.fill()` can't race it.
  await expect(navInput(sbPage)).toHaveValue("", { timeout: 20_000 });
  return frame;
}

function navInput(sbPage: Page) {
  return sbPage.frameLocator(".sb-modal iframe").locator("input.sb-nav-input");
}

async function openNavigatorView(
  sbPage: Page,
  command: string,
  frameSelector = ".sb-modal iframe",
) {
  await runCommand(sbPage, command);
  const frame = sbPage.frameLocator(frameSelector);
  await expect(frame.locator("input.sb-nav-input")).toHaveValue("", {
    timeout: 20_000,
  });
  return frame;
}

// A `.sb-keyed-panel` wrapper never leaves the DOM when hidden -- it's
// toggled via a CSS class -- so asserting on it directly (not on a
// `:not(.sb-hidden)` class-presence query, which a CSS specificity bug can
// satisfy while the element is still visually rendered) is what actually
// catches a "closed but still showing" regression.
function sidebarTreePanel(sbPage: Page) {
  return sbPage.locator("#sb-main .sb-keyed-panel-rhs");
}

/**
 * Closing a sidebar is the header close button (or Escape on an empty
 * phrase) -- running the view's command again re-focuses it, it never
 * toggles the dock closed.
 */
async function closeSidebar(sbPage: Page, selector = ".sb-keyed-panel-rhs") {
  await sbPage
    .frameLocator(`${selector} iframe`)
    .locator(".sb-nav-close")
    .click();
}

/**
 * Where focus actually sits, on both sides of the frame boundary: an input
 * can be `document.activeElement` inside its own iframe while the host still
 * has focus somewhere else entirely, in which case keystrokes never reach it.
 */
function focusState(sbPage: Page, iframeSelector: string) {
  return sbPage.evaluate((sel) => {
    const f = document.querySelector(sel) as HTMLIFrameElement | null;
    return {
      frameFocused: !!f && document.activeElement === f,
      inner: f?.contentDocument?.activeElement?.className ?? null,
    };
  }, iframeSelector);
}

async function expectFilterInputFocused(sbPage: Page, iframeSelector: string) {
  await expect(async () => {
    expect(await focusState(sbPage, iframeSelector)).toEqual({
      frameFocused: true,
      inner: "sb-nav-input",
    });
  }).toPass();
}

test("opens with source-ordered rows and filters in-frame", async ({
  sbPage,
}) => {
  const frame = await openNavigator(sbPage);

  const primaries = await frame.locator(".sb-nav-primary").allInnerTexts();
  expect(primaries).toContain("Projects/Alpha");
  expect(primaries).toContain("Projects/Beta");
  // `order by _.name` is the source order, and an empty phrase preserves it
  expect([...primaries].sort()).toEqual(primaries);

  await navInput(sbPage).fill("alpha");
  // Fuzzy matching keeps loose subsequence hits, but the exact page wins and
  // the list shrinks — all without leaving the iframe.
  await expect(frame.locator(".sb-nav-primary").first()).toHaveText(
    "Projects/Alpha",
  );
  expect(await frame.locator(".sb-nav-row").count()).toBeLessThan(
    primaries.length,
  );

  await navInput(sbPage).fill("zzz-no-such-page");
  await expect(frame.locator(".sb-nav-empty")).toBeVisible();
});

test("Enter navigates to the selected page and closes the modal", async ({
  sbPage,
}) => {
  await openNavigator(sbPage);

  await navInput(sbPage).fill("alpha");
  await navInput(sbPage).press("Enter");

  await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Projects/Alpha",
  );
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);
});

test("arrow keys move the selection", async ({ sbPage }) => {
  const frame = await openNavigator(sbPage);
  await navInput(sbPage).fill("projects");

  const selected = frame.locator(".sb-nav-selected .sb-nav-primary");
  await expect(selected).toBeVisible();
  const first = await selected.innerText();

  await navInput(sbPage).press("ArrowDown");
  await expect(selected).not.toHaveText(first);
  const second = await selected.innerText();

  await navInput(sbPage).press("Control+p");
  await expect(selected).toHaveText(first);

  await navInput(sbPage).press("Control+n");
  await expect(selected).toHaveText(second);
});

test("Escape clears the phrase, then closes the panel", async ({ sbPage }) => {
  await openNavigator(sbPage);

  await navInput(sbPage).fill("beta");
  await navInput(sbPage).press("Escape");
  await expect(navInput(sbPage)).toHaveValue("");

  await navInput(sbPage).press("Escape");
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);
});

test("reopening reuses the same iframe and clears the stale phrase", async ({
  sbPage,
}) => {
  await openNavigator(sbPage);
  // Selecting closes the panel with the phrase still in the box
  await navInput(sbPage).fill("beta");
  await navInput(sbPage).press("Enter");
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);

  await sbPage.evaluate(() => {
    const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
    (f.contentWindow as any).__sameFrame = true;
  });

  await openNavigator(sbPage);

  const survived = await sbPage.evaluate(() => {
    const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
    return (f.contentWindow as any).__sameFrame === true;
  });
  expect(survived).toBe(true);
  await expect(navInput(sbPage)).toHaveValue("");
});

// Polish round review, C1 (critical): reopening a modal on the view it
// already displays took the `else if (!passive)` branch in `createActivate`,
// which never calls `setView`/`setBootError` -- so `NavRoot`'s paint-timed
// `useLayoutEffect([view, bootError])` never re-fires, `editor.panelReady`
// is never sent, and the only thing that ever revealed the panel was the
// 800ms fallback. Every view without `refreshOnOpen: true` hit this on
// every reopen -- which is the *default* (`builtins.ts`'s `baseMeta`), so
// every space-Lua-defined picker plus the built-in `std.anchors`/`std.tags`.
// A `refreshOnOpen: true` view (the page picker, command palette, outline
// picker) escaped only incidentally, because its background refresh
// produces a fresh `view` object and re-fires the effect anyway -- which is
// exactly why this bug shipped unnoticed: every one of the report's own
// measurements happened to use a `refreshOnOpen: true` view.
//
// Fixed by signalling readiness directly from the activation path itself
// (`createActivate`'s `signalReady`, `activation.ts`) for a reopen of an
// already-displayed view -- its content is already settled (nothing new is
// rendering), so there's nothing to wait for.
test("C1: reopening an already-displayed modal view reveals promptly, not via the 800ms fallback -- for both a refreshOnOpen view and a default (space-Lua) one", async ({
  sbPage,
}) => {
  const revealedWithin = async (run: () => Promise<unknown>) => {
    const start = Date.now();
    await run();
    await sbPage.waitForFunction(() => {
      const el = document.querySelector(".sb-modal");
      return !!el && !el.classList.contains("sb-modal-paint-pending");
    });
    return Date.now() - start;
  };
  const open = async (command: string) => {
    await sbPage.evaluate(
      (c) => (globalThis as any).client.runCommandByName(c),
      command,
    );
    // Escape below has to land on the panel's own keydown handler to close
    // it -- which needs actual DOM focus in the iframe, not just the modal
    // being visible. `runCommandByName`'s own promise resolves once the
    // *host* side of opening it is done; the panel's own `focusInput` is a
    // downstream hop through the activation event forwarding, not
    // necessarily settled yet by then.
    await expectNavInputFocused(sbPage);
  };
  const close = async () => {
    await sbPage.keyboard.press("Escape");
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
  };

  // View A: "Navigator: Pages" (NAV_CONFIG, space-Lua-defined, no
  // `refreshOnOpen` -- the default, `false`). This is the class C1 hit.
  const luaFirst = await revealedWithin(() => open("Navigator: Pages"));
  await close();

  const luaWarmReopen = await revealedWithin(() => open("Navigator: Pages"));
  await close();

  await open("Navigate: Page Picker"); // switch to a different view...
  await close();
  const luaReopenAfterSwitch = await revealedWithin(() =>
    open("Navigator: Pages")
  ); // ...and back.
  await close();

  // View B: "Navigate: Page Picker" (std.pages, TS builtin,
  // `refreshOnOpen: true`) -- was already fast before the fix, incidentally
  // (see the report's root-cause note above); pinned here too so a
  // regression in either path shows.
  const tsFirst = await revealedWithin(() => open("Navigate: Page Picker"));
  await close();
  const tsWarmReopen = await revealedWithin(() =>
    open("Navigate: Page Picker")
  );
  await close();
  await open("Navigator: Pages");
  await close();
  const tsReopenAfterSwitch = await revealedWithin(() =>
    open("Navigate: Page Picker")
  );

  console.log(
    `C1_MATRIX lua(first=${luaFirst}ms warm=${luaWarmReopen}ms afterSwitch=${luaReopenAfterSwitch}ms) ` +
      `ts(first=${tsFirst}ms warm=${tsWarmReopen}ms afterSwitch=${tsReopenAfterSwitch}ms)`,
  );

  // The regression guard: a reopen (warm, or after switching away and back)
  // must never fall back to the 800ms timeout, for either view type.
  for (
    const ms of [
      luaWarmReopen,
      luaReopenAfterSwitch,
      tsWarmReopen,
      tsReopenAfterSwitch,
    ]
  ) {
    expect(ms).toBeLessThan(400);
  }
});

test("first open of a never-preloaded dock still activates", async ({
  sbPage,
}) => {
  // Only the modal is preloaded, so opening an lhs view mounts the panel and
  // fires `navigator:activate` before the iframe can listen — the boot-time
  // `navigator:ready` pull is the only thing that populates it.
  await runCommand(sbPage, "Navigator: Sidebar");
  const frame = sbPage.frameLocator("#sb-main .sb-keyed-panel-lhs iframe");
  await expect(frame.locator(".sb-nav-title")).toHaveText("Sidebar");
  await expect(frame.locator(".sb-nav-primary").first()).toBeVisible();
});

test("a failing source renders an error and keeps retrying", async ({
  sbPage,
  sbServer,
}) => {
  await runCommand(sbPage, "Navigator: Flaky");
  const frame = sbPage.frameLocator(".sb-modal iframe");
  const error = frame.locator(".sb-nav-error");
  await expect(error).toContainText("source exploded");
  // The input stays usable while the error is showing
  await expect(navInput(sbPage)).toBeFocused();
  const firstAttempt = await error.innerText();

  // `editor:pageLoaded` is *not* a refresh trigger (it would re-run every
  // view's source on every navigation); an actual refreshOn event is --
  // "flaky" doesn't override refreshOn, so it inherits the default set,
  // which includes `file:changed`.
  await writeFile(join(sbServer.spaceDir, "Retry.md"), "# Retry");
  await expect(error).not.toHaveText(firstAttempt, { timeout: 5000 });
  await expect(error).toContainText("source exploded");
});

test("switching views in an already-open dock replaces the rows", async ({
  sbPage,
}) => {
  await runCommand(sbPage, "Navigator: Sidebar");
  const frame = sbPage.frameLocator("#sb-main .sb-keyed-panel-lhs iframe");
  await expect(frame.locator(".sb-nav-title")).toHaveText("Sidebar");
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }),
  ).toBeVisible();

  // The panel keeps focus once shown; hand it back so the palette hotkey lands
  await sbPage.locator("#sb-editor .cm-content").click();
  await runCommand(sbPage, "Navigator: Sidebar Journal");

  // Same panel, same iframe — only the view behind it changed
  await expect(frame.locator(".sb-nav-title")).toHaveText("Sidebar Journal");
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Journal/Today" }),
  ).toBeVisible();
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }),
  ).toHaveCount(0);
});

test("a keyed modal panel can be dismissed from outside its iframe", async ({
  sbPage,
}) => {
  // Without these the user is trapped behind the fixed backdrop whenever the
  // panel's iframe fails to boot, since only in-iframe code can hidePanel.
  await openNavigator(sbPage);
  await sbPage
    .locator(".sb-modal-backdrop")
    .click({ position: { x: 5, y: 5 } });
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);

  await openNavigator(sbPage);
  // Drop focus out of the iframe, as it would be if the bundle never ran
  await sbPage.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await sbPage.keyboard.press("Escape");
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);
});

test("re-evaluating the panel bundle reuses the booted singletons", async ({
  sbPage,
}) => {
  const frame = await openNavigator(sbPage);

  // The host re-posts `html` (re-running the bundle in a wiped body) whenever
  // the panel config changes. Handlers and the row cache must not be rebuilt.
  await sbPage.evaluate(() => {
    const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
    const w = f.contentWindow as any;
    w.__engineBefore = w.__navigatorEngine;
    const panel = (globalThis as any).client.ui.viewState.keyedPanels.find(
      (p: any) => p.key === "navigator:modal",
    );
    f.contentWindow!.postMessage({
      type: "html",
      html: panel.html,
      script: panel.script,
    });
  });

  // The app comes back up and still shows its view
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }),
  ).toBeVisible();

  const reused = await sbPage.evaluate(() => {
    const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
    const w = f.contentWindow as any;
    return {
      sameEngine: w.__navigatorEngine === w.__engineBefore,
      listening: w.__navigatorListening === true,
    };
  });
  expect(reused).toEqual({ sameEngine: true, listening: true });

  // And it still filters, so the fresh render is wired to the live handlers
  await navInput(sbPage).fill("alpha");
  await expect(frame.locator(".sb-nav-primary").first()).toHaveText(
    "Projects/Alpha",
  );
});

test("tree: folders collapse and expand", async ({ sbPage }) => {
  const frame = await openNavigatorView(sbPage, "Navigator: Modal Tree");
  await expect(frame.locator("[data-path='Projects']")).toBeVisible();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
  await expect(frame.locator("[data-path='Projects/Beta']")).toBeVisible();

  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);
});

test("tree: keyboard navigation expands and navigates", async ({ sbPage }) => {
  const frame = await openNavigatorView(sbPage, "Navigator: Modal Tree");
  const input = frame.locator("input.sb-nav-input");

  // The first visible row (the "Journal" folder) is selected by default,
  // same as list mode.
  await expect(frame.locator(".sb-nav-selected")).toHaveAttribute(
    "data-path",
    "Journal",
  );

  await input.press("ArrowRight"); // expand
  await expect(frame.locator("[data-path='Journal/Today']")).toBeVisible();

  await input.press("ArrowDown"); // step into the now-visible child
  await expect(frame.locator(".sb-nav-selected")).toHaveAttribute(
    "data-path",
    "Journal/Today",
  );

  await input.press("Enter");
  await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Journal/Today",
  );
});

test("tree: filtering prunes, highlights, and restores expansion", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(sbPage, "Navigator: Modal Tree");
  // Background indexing can deliver "Projects"'s children in batches (the
  // folder row itself appears as soon as either exists) -- wait for both,
  // same readiness concern openNavigator() documents for list mode, before
  // filtering on a name that only one of them has.
  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
  await expect(frame.locator("[data-path='Projects/Beta']")).toBeVisible();
  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

  const input = frame.locator("input.sb-nav-input");
  await input.fill("alpha");
  await expect(
    frame.locator("[data-path='Projects/Alpha'] mark"),
  ).toBeVisible();
  await expect(frame.locator("[data-path='Journal']")).toHaveCount(0);

  await input.press("Escape"); // clears the phrase, not the panel
  await expect(input).toHaveValue("");
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);
});

test("list: typing highlights the matched characters", async ({ sbPage }) => {
  const frame = await openNavigator(sbPage);
  const row = frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" });

  await navInput(sbPage).fill("alpha");
  await expect(row.locator("mark")).toBeVisible();
  await expect(row.locator("mark")).toHaveText("Alpha");

  // Same rule as the tree: cleared phrase, no mark.
  await navInput(sbPage).press("Escape");
  await expect(navInput(sbPage)).toHaveValue("");
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }).locator("mark"),
  ).toHaveCount(0);
});

test("sidebar: opens, persists across page navigation, follows editor", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator(".sb-tree")).toBeVisible();

  // Regression guard for a bug where the keyed panel's nested .sb-panel had
  // no flex container to grow inside, so its iframe collapsed to the
  // browser's ~150px replaced-element default instead of filling the
  // sidebar -- must never pass silently again.
  const iframeBox = await sbPage
    .locator(".sb-keyed-panel-rhs iframe")
    .boundingBox();
  const mainBox = await sbPage.locator("#sb-main").boundingBox();
  expect(iframeBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(Math.abs(iframeBox!.height - mainBox!.height)).toBeLessThan(5);

  // The panel keeps focus once shown; hand it back so the palette hotkey lands
  await sbPage.locator("#sb-editor .cm-content").click();

  // In-app navigation (page picker), not a full page reload, so the sidebar
  // panel's iframe survives and follow-editor reacts to `editor:pageLoaded`.
  await navigateViaPagePicker(sbPage, "Projects/Alpha");

  // The panel is still there (persisted across the navigation) and its tree
  // followed the editor: "Projects" auto-expanded and "Alpha" got selected.
  await expect(
    frame.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
  ).toBeVisible();
});

test("sidebar: reopens after being closed", async ({ sbPage }) => {
  await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await closeSidebar(sbPage);
  await expect(sidebarTreePanel(sbPage)).toBeHidden();

  await runCommand(sbPage, "Navigator: Sidebar Tree"); // reopens
  await expect(sidebarTreePanel(sbPage)).toBeVisible();
});

test("sidebar: follow-editor reveal survives being hidden, then reopened", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator(".sb-tree")).toBeVisible();

  await closeSidebar(sbPage);
  await expect(sidebarTreePanel(sbPage)).toBeHidden();

  // Navigate while the sidebar is hidden -- follow-editor must stash the
  // target instead of touching tree state, and apply it once shown again.
  await navigateViaPagePicker(sbPage, "Projects/Alpha");

  await runCommand(sbPage, "Navigator: Sidebar Tree"); // reopen
  await expect(
    frame.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
  ).toBeVisible();
});

test("sidebar: resize handle changes width, persists, and restores", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator(".sb-tree")).toBeVisible();

  const panel = sidebarTreePanel(sbPage);
  const before = (await panel.boundingBox())!;

  const handle = frame.locator(".sb-resizer-rhs");
  const handleBox = (await handle.boundingBox())!;
  await sbPage.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await sbPage.mouse.down();
  // rhs grows to the left: dragging left increases width.
  await sbPage.mouse.move(
    handleBox.x - 100,
    handleBox.y + handleBox.height / 2,
    {
      steps: 15,
    },
  );
  await sbPage.mouse.up();

  await expect(async () => {
    const after = (await panel.boundingBox())!;
    expect(after.width).toBeGreaterThan(before.width + 50);
  }).toPass();

  const widened = (await panel.boundingBox())!.width;

  // Close, then reopen: width should be restored from persistence, not reset
  // to the default.
  await closeSidebar(sbPage);
  await expect(sidebarTreePanel(sbPage)).toBeHidden();
  await runCommand(sbPage, "Navigator: Sidebar Tree");
  await expect(async () => {
    const restored = (await panel.boundingBox())!;
    expect(Math.abs(restored.width - widened)).toBeLessThan(10);
  }).toPass();
});

test("sidebar: the close button hides the panel", async ({ sbPage }) => {
  await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await closeSidebar(sbPage);
  await expect(sidebarTreePanel(sbPage)).toBeHidden();
  // A `.sb-keyed-panel.sb-hidden` that's actually still rendered (the C1
  // regression) would keep occupying its flex share, so the editor
  // wouldn't reclaim the full #sb-main width either.
  const editorBox = (await sbPage.locator("#sb-editor").boundingBox())!;
  const mainBox = (await sbPage.locator("#sb-main").boundingBox())!;
  expect(mainBox.width - editorBox.width).toBeLessThan(5);
});

test("tree: expandAll opens every depth, and a collapse survives a refresh", async ({
  sbPage,
  sbServer,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Expand All Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  // Nobody expanded anything: both depths are simply there.
  await expect(frame.locator("[data-path='Projects']")).toBeVisible({
    timeout: 20_000,
  });
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
  await expect(frame.locator("[data-path='Journal/Today']")).toBeVisible();

  // A manual collapse, which is the only thing the view now remembers.
  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

  // An out-of-band write refreshes the rows wholesale (see the watch test
  // below). The collapse has to survive it, and the folder that wasn't there
  // before has to arrive open rather than waiting to be found.
  await mkdir(join(sbServer.spaceDir, "Notes"), { recursive: true });
  await writeFile(join(sbServer.spaceDir, "Notes/Later.md"), "# Later");

  await expect(frame.locator("[data-path='Notes/Later']")).toBeVisible({
    timeout: 20_000,
  });
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);
  await expect(frame.locator("[data-path='Projects']")).toBeVisible();
});

test("tree: expandAll auto-expands while filtering, then gives the collapse back", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Expand All Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible({
    timeout: 20_000,
  });
  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

  const input = frame.locator("input.sb-nav-input");
  await input.fill("alpha");
  // A phrase force-expands the pruned tree whichever way the flag is set --
  // the collapsed set is not consulted while filtering.
  await expect(
    frame.locator("[data-path='Projects/Alpha'] mark"),
  ).toBeVisible();

  await input.press("Escape");
  await expect(input).toHaveValue("");
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);
});

test("tree: a row's label wins over its path segment", async ({ sbPage }) => {
  const frame = await openNavigatorView(sbPage, "Navigator: Label Tree");
  // The path nests the row; the label is what it reads as -- so a "/" and a
  // disambiguating suffix can live in one without showing up in the other.
  await expect(frame.locator("[data-path='Top'] .sb-nav-primary")).toHaveText(
    "Top/Level",
  );
  await expect(
    frame.locator("[data-path='Top/Child'] .sb-nav-primary"),
  ).toHaveText("Child @1");
});

test("watch: out-of-band page creation appears in sidebar tree, preserving expansion/selection", async ({
  sbPage,
  sbServer,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();

  // Select a node by path -- the refresh below must preserve both this
  // selection and the folder's expansion, since they're keyed by path, not
  // by index into the row array.
  await frame.locator("[data-path='Projects/Alpha']").click();
  await expect(
    frame.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
  ).toBeVisible();

  // A page written directly to disk, out-of-band -- not through the app.
  // Reaches the client via its file-watch/push path -> `file:changed` ->
  // forwarded -> debounced refresh (default refreshOn includes
  // `file:changed`; see `writeFile` usage in e2e/external-edit.test.ts for
  // why this is more reliable than the `.fs` HTTP endpoint under CI load).
  await writeFile(join(sbServer.spaceDir, "Projects/Gamma.md"), "# Gamma");

  await expect(frame.locator("[data-path='Projects/Gamma']")).toBeVisible({
    timeout: 20_000,
  });
  // The dataset swapped wholesale, but expansion and selection -- both
  // path-keyed -- survived it untouched.
  await expect(frame.locator("[data-path='Projects/Beta']")).toBeVisible();
  await expect(
    frame.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
  ).toBeVisible();
});

test("watch: hidden panel defers refresh, running the source once when shown", async ({
  sbPage,
  sbServer,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();

  await closeSidebar(sbPage); // hide
  await expect(sidebarTreePanel(sbPage)).toBeHidden();

  // The keyed panel wrapper (and its iframe/engine singleton) stays mounted
  // while hidden -- see the comment on `sidebarTreePanel` -- so refreshOn
  // events keep arriving at it. Count real `engine.refresh()` calls (i.e.
  // the source actually re-running), not just visible DOM state, so the
  // assertion below is about the mechanism, not a coincidence of timing.
  await sbPage.evaluate(() => {
    const f = document.querySelector(
      ".sb-keyed-panel-rhs iframe",
    ) as HTMLIFrameElement;
    const w = f.contentWindow as any;
    w.__refreshCalls = 0;
    const engine = w.__navigatorEngine;
    const orig = engine.refresh.bind(engine);
    engine.refresh = (...args: unknown[]) => {
      w.__refreshCalls++;
      return orig(...args);
    };
  });

  const refreshCalls = () =>
    sbPage.evaluate(() => {
      const f = document.querySelector(
        ".sb-keyed-panel-rhs iframe",
      ) as HTMLIFrameElement;
      return (f.contentWindow as any).__refreshCalls as number;
    });

  // A burst of out-of-band writes while hidden -- simulates the startup
  // indexing storm (mq:emptyQueue:indexQueue firing repeatedly) this
  // deferral exists for.
  for (let i = 0; i < 6; i++) {
    await writeFile(
      join(sbServer.spaceDir, `Projects/Storm${i}.md`),
      `# Storm ${i}`,
    );
    await sbPage.waitForTimeout(60);
  }
  // Give any debounce timer time to settle while still hidden.
  await sbPage.waitForTimeout(500);
  expect(await refreshCalls()).toBe(0);

  await runCommand(sbPage, "Navigator: Sidebar Tree"); // show again
  await expect(sidebarTreePanel(sbPage)).toBeVisible();

  // The single deferred refresh fires on `panel:shown`. Read the count the
  // moment it lands rather than after waiting for its rows to paint: an
  // indexing event arriving inside that (20s) window would be a second,
  // legitimate refresh, and what is asserted here is that the six writes
  // above collapsed into one.
  await expect
    .poll(refreshCalls, { intervals: [10], timeout: 20_000 })
    .toBeGreaterThan(0);
  expect(await refreshCalls()).toBe(1);

  await expect(frame.locator("[data-path='Projects/Storm0']")).toBeVisible({
    timeout: 20_000,
  });
  // Expansion survived the whole hidden period untouched, unprompted.
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
});

test("command open focuses the filter input in the modal dock", async ({
  sbPage,
}) => {
  await openNavigator(sbPage);
  await expectFilterInputFocused(sbPage, ".sb-modal iframe");

  // Focus that only exists inside the iframe's own document is useless -- type
  // into the *page* and check it lands in the filter box.
  await sbPage.keyboard.type("alpha", { delay: 20 });
  await expect(navInput(sbPage)).toHaveValue("alpha");
});

test("command open focuses the filter input in a sidebar dock", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator(".sb-tree")).toBeVisible();
  await expectFilterInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");

  // followEditor revealed the current page on open (see the re-reveal test).
  const selected = frame.locator(".sb-nav-selected");
  await expect(selected).toHaveAttribute("data-path", "index");

  // Arrow-key navigation is live without clicking anything first.
  await sbPage.keyboard.press("ArrowUp");
  await expect(selected).not.toHaveAttribute("data-path", "index");
});

test("re-running the command re-focuses the panel, never toggles it closed", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator(".sb-tree")).toBeVisible();

  // Leave the panel, and leave a stale phrase behind
  await frame.locator("input.sb-nav-input").fill("alpha");
  await sbPage.locator("#sb-editor .cm-content").click();
  await expect(sbPage.locator("#sb-editor .cm-content")).toBeFocused();

  await runCommand(sbPage, "Navigator: Sidebar Tree");

  await expect(sidebarTreePanel(sbPage)).toBeVisible();
  await expectFilterInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");
  // A docked view keeps its phrase (and the filtered state derived from it)
  // across a re-focus -- clearing is modal-only, and Escape stays the
  // explicit clear.
  await expect(frame.locator("input.sb-nav-input")).toHaveValue("alpha");
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
  await expect(frame.locator("[data-path='Journal']")).toHaveCount(0);

  await frame.locator("input.sb-nav-input").press("Escape");
  await expect(frame.locator("input.sb-nav-input")).toHaveValue("");
  await expect(frame.locator("[data-path='Journal']")).toBeVisible();
});

// Item 7 extension (polish round): the phrase itself still isn't cleared
// (see above) -- it's *selected*, so the refocus a user asks for reads as
// "let me replace this filter" rather than "resume typing into the middle
// of it". Arrow/Enter behavior is untouched by this -- selecting text in the
// input has nothing to do with `selectedIndex`/filtering.
test("re-focusing a docked view with a phrase selects it, so typing replaces it", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await frame.locator("input.sb-nav-input").fill("alpha");
  await sbPage.locator("#sb-editor .cm-content").click();

  await runCommand(sbPage, "Navigator: Sidebar Tree");
  await expectFilterInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");

  const input = frame.locator("input.sb-nav-input");
  await expect(input).toHaveValue("alpha");
  const selection = await input.evaluate((el: HTMLInputElement) => ({
    start: el.selectionStart,
    end: el.selectionEnd,
  }));
  expect(selection).toEqual({ start: 0, end: "alpha".length });

  // The actual payoff: the first keystroke replaces the whole phrase.
  await sbPage.keyboard.type("beta");
  await expect(input).toHaveValue("beta");
});

test("re-opening an unfiltered followEditor sidebar re-reveals the current page", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator(".sb-tree")).toBeVisible();

  await sbPage.locator("#sb-editor .cm-content").click();
  await navigateViaPagePicker(sbPage, "Projects/Alpha");
  await expect(
    frame.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
  ).toBeVisible();

  // Navigate the view away from the current page by hand: collapsing the
  // ancestor hides the revealed row entirely.
  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

  await sbPage.locator("#sb-editor .cm-content").click();
  await runCommand(sbPage, "Navigator: Sidebar Tree");

  // An explicit re-open of an unfiltered followEditor sidebar re-reveals:
  // ancestors expanded, current page selected, focus in the filter input.
  await expect(
    frame.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
  ).toBeVisible();
  await expectFilterInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");
});

test("re-opening a filtered followEditor sidebar keeps the filter and skips the reveal", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator(".sb-tree")).toBeVisible();
  await expect(frame.locator("[data-path='Journal']")).toBeVisible();

  // Current page is `index`, which the phrase below prunes away -- so a
  // reveal here would have to drag the selection outside the set the user
  // deliberately filtered down to.
  const input = frame.locator("input.sb-nav-input");
  await input.fill("today");
  await expect(frame.locator("[data-path='Journal/Today']")).toBeVisible();
  await expect(frame.locator("[data-path='Projects']")).toHaveCount(0);

  await sbPage.locator("#sb-editor .cm-content").click();
  await runCommand(sbPage, "Navigator: Sidebar Tree");

  await expectFilterInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");
  await expect(input).toHaveValue("today");
  await expect(frame.locator("[data-path='Journal/Today']")).toBeVisible();
  await expect(frame.locator("[data-path='Projects']")).toHaveCount(0);
  await expect(frame.locator("[data-path='index']")).toHaveCount(0);
});

test("keymap: a view key acts on the selected row without giving up focus", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Keymap Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator(".sb-tree")).toBeVisible();
  await expect(frame.locator("[data-path='Journal']")).toBeVisible();

  // followEditor already revealed the current page, so walk back to the top
  // of the tree first.
  const input = frame.locator("input.sb-nav-input");
  await input.press("Home");
  await expect(frame.locator(".sb-nav-selected")).toHaveAttribute(
    "data-path",
    "Journal",
  );
  await input.press("ArrowRight"); // expand "Journal"
  await expect(frame.locator("[data-path='Journal/Today']")).toBeVisible();
  await input.press("ArrowDown");
  await expect(frame.locator(".sb-nav-selected")).toHaveAttribute(
    "data-path",
    "Journal/Today",
  );

  await input.press(" ");

  await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Journal/Today",
  );
  // The whole point: `client.navigate` focuses the editor on its way out, and
  // the panel takes focus back so arrow-key browsing continues. The claimed
  // key is also swallowed rather than typed into the filter.
  await expectFilterInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");
  await expect(input).toHaveValue("");
});

test("create: a create row appears for an unmatched phrase and creates on Enter", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(sbPage, "Navigator: Create List");
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }),
  ).toBeVisible();
  const input = frame.locator("input.sb-nav-input");

  // No phrase, no create row
  await expect(frame.locator(".sb-nav-create")).toHaveCount(0);

  // A phrase matching an existing row exactly offers no create row either
  await input.fill("Projects/Alpha");
  await expect(frame.locator(".sb-nav-create")).toHaveCount(0);

  // A phrase that still fuzzy-matches existing rows: the best match leads and
  // the create row follows it, rather than being the only option
  await input.fill("Projects/Al");
  await expect(frame.locator(".sb-nav-create .sb-nav-primary")).toHaveText(
    "Projects/Al",
  );
  await expect(frame.locator(".sb-nav-create .sb-nav-chip-hint")).toHaveText(
    "Create",
  );
  await expect(frame.locator(".sb-nav-selected")).not.toHaveClass(
    /sb-nav-create/,
  );

  // Second, right under the top match -- so one ArrowDown lands on it
  await expect(frame.locator(".sb-nav-row").nth(1)).toHaveClass(
    /sb-nav-create/,
  );
  await input.press("ArrowDown");
  await expect(frame.locator(".sb-nav-create.sb-nav-selected")).toBeVisible();
  await input.press("Enter");

  await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Projects/Al",
  );
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);
});

test("create: Shift-Enter creates from anywhere in the list", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(sbPage, "Navigator: Create List");
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }),
  ).toBeVisible();

  const input = frame.locator("input.sb-nav-input");
  await input.fill("Projects/Be");
  // Selection is still on the first ranked row, not the create row
  await expect(frame.locator(".sb-nav-create")).toBeVisible();
  await expect(frame.locator(".sb-nav-create.sb-nav-selected")).toHaveCount(0);
  await input.press("Shift+Enter");

  await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Projects/Be",
  );
});

test("create: tree mode pins the create row below the tree", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(sbPage, "Navigator: Create Tree");
  await expect(frame.locator("[data-path='Projects']")).toBeVisible();
  const input = frame.locator("input.sb-nav-input");

  // A phrase that still leaves tree rows standing: the create row sits past
  // them, and End walks onto it.
  await input.fill("Projects/Al");
  await expect(
    frame.locator(".sb-nav-create.sb-nav-create-pinned .sb-nav-primary"),
  ).toHaveText("Projects/Al");
  await expect(frame.locator(".sb-nav-create.sb-nav-selected")).toHaveCount(0);
  await input.press("End");
  await expect(frame.locator(".sb-nav-create.sb-nav-selected")).toBeVisible();
  await input.press("Enter");

  await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Projects/Al",
  );
});

test("create: tree mode, Enter creates when the phrase pruned the tree away", async ({
  sbPage,
}) => {
  // The regression: with no tree rows left, the selection fell back to index
  // 0, which resolved to no node and no create row either -- the only thing on
  // screen looked actionable while Enter did nothing. No End press here: the
  // create row must already be the selection.
  const frame = await openNavigatorView(sbPage, "Navigator: Create Tree Small");
  await expect(frame.locator("[data-path='Alpha']")).toBeVisible();
  const input = frame.locator("input.sb-nav-input");

  await input.fill("zzz-nothing-matches-this");
  await expect(frame.locator(".sb-treeitem")).toHaveCount(0);
  await expect(
    frame.locator(".sb-nav-create.sb-nav-selected .sb-nav-primary"),
  ).toHaveText("zzz-nothing-matches-this");

  await input.press("Enter");
  await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
    "zzz-nothing-matches-this",
  );
});

test("create: list mode keeps the create row on screen however long the list", async ({
  sbPage,
}) => {
  // The reason it renders second rather than after the results: in a list
  // long enough to scroll, an appended create row starts far below the fold,
  // and `Shift-Enter` would then create a page the user never saw. Second, it
  // is on screen from the moment it exists.
  const frame = await openNavigatorView(sbPage, "Navigator: Create Bulk");
  await expect(frame.locator(".sb-nav-row").first()).toBeVisible();

  const input = frame.locator("input.sb-nav-input");
  await input.fill("Item0");
  const createRow = frame.locator(".sb-nav-create");
  await expect(createRow).toBeVisible();

  const body = frame.locator(".sb-nav-body");
  await expect(async () => {
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    );
  }).toPass();

  const withinContainer = () =>
    sbPage.evaluate(() => {
      const d = (
        document.querySelector(".sb-modal iframe") as HTMLIFrameElement
      ).contentDocument!;
      const row = d.querySelector(".sb-nav-create")!.getBoundingClientRect();
      const box = d.querySelector(".sb-nav-body")!.getBoundingClientRect();
      return row.top >= box.top - 1 && row.bottom <= box.bottom + 1;
    });

  // From the top of the list -- which is where a phrase edit leaves it.
  await body.evaluate((el) => {
    el.scrollTop = 0;
  });
  expect(await withinContainer()).toBe(true);
  await expect(frame.locator(".sb-nav-row").nth(1)).toHaveClass(
    /sb-nav-create/,
  );
});

test("create: a view without onCreate never grows a create row", async ({
  sbPage,
}) => {
  const frame = await openNavigator(sbPage);
  await navInput(sbPage).fill("Definitely Not A Page");
  await expect(frame.locator(".sb-nav-empty")).toBeVisible();
  await expect(frame.locator(".sb-nav-create")).toHaveCount(0);
});

test("scroll: a refresh leaves a manually scrolled tree exactly where it was", async ({
  sbPage,
  sbServer,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Scroll Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator("[data-path='Bulk001']")).toBeVisible();

  const body = frame.locator(".sb-nav-body");
  await body.evaluate((el) => {
    el.scrollTop = 600;
  });
  const scrolledTo = await body.evaluate((el) => el.scrollTop);
  expect(scrolledTo).toBeGreaterThan(0);

  // Count real source re-runs so a passing assertion can't just mean "no
  // refresh ever happened".
  await sbPage.evaluate(() => {
    const f = document.querySelector(
      ".sb-keyed-panel-rhs iframe",
    ) as HTMLIFrameElement;
    const w = f.contentWindow as any;
    w.__refreshCalls = 0;
    const engine = w.__navigatorEngine;
    const orig = engine.refresh.bind(engine);
    engine.refresh = (...args: unknown[]) => {
      w.__refreshCalls++;
      return orig(...args);
    };
  });

  await writeFile(join(sbServer.spaceDir, "Scrolled.md"), "# Scrolled");
  await expect(async () => {
    const calls = await sbPage.evaluate(() => {
      const f = document.querySelector(
        ".sb-keyed-panel-rhs iframe",
      ) as HTMLIFrameElement;
      return (f.contentWindow as any).__refreshCalls as number;
    });
    expect(calls).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });

  // The dataset was re-fetched and re-rendered underneath, but the user's
  // scroll position is untouched.
  expect(await body.evaluate((el) => el.scrollTop)).toBe(scrolledTo);
});

test("scroll: a follow-editor reveal never scrolls the host document", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(
    sbPage,
    "Navigator: Sidebar Tree",
    ".sb-keyed-panel-rhs iframe",
  );
  await expect(frame.locator(".sb-tree")).toBeVisible();

  await sbPage.locator("#sb-editor .cm-content").click();
  await navigateViaPagePicker(sbPage, "Projects/Alpha");
  await expect(
    frame.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
  ).toBeVisible();

  // `scrollIntoView` inside a same-origin iframe scrolls the host's scrollable
  // ancestors too; nothing outside the panel's own scroll container may move,
  // and no host container may end up overflowing.
  const host = await sbPage.evaluate(() => {
    const overflow = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return {
        scrollTop: el.scrollTop,
        overflowing: el.scrollHeight > el.clientHeight + 1,
      };
    };
    return {
      doc: {
        scrollTop: document.scrollingElement!.scrollTop,
        overflowing:
          document.documentElement.scrollHeight >
          document.documentElement.clientHeight + 1,
      },
      root: overflow("#sb-root"),
      main: overflow("#sb-main"),
      body: overflow("body"),
    };
  });
  expect(host.doc).toEqual({ scrollTop: 0, overflowing: false });
  expect(host.root).toEqual({ scrollTop: 0, overflowing: false });
  expect(host.main).toEqual({ scrollTop: 0, overflowing: false });
  expect(host.body).toEqual({ scrollTop: 0, overflowing: false });

  // And the panel document itself never scrolls -- only .sb-nav-body does.
  const panelDoc = await sbPage.evaluate(() => {
    const f = document.querySelector(
      ".sb-keyed-panel-rhs iframe",
    ) as HTMLIFrameElement;
    const d = f.contentDocument!;
    return {
      scrollTop: d.scrollingElement!.scrollTop,
      overflowing:
        d.documentElement.scrollHeight > d.documentElement.clientHeight + 1,
    };
  });
  expect(panelDoc).toEqual({ scrollTop: 0, overflowing: false });
});

test("rows are not selectable text", async ({ sbPage }) => {
  const frame = await openNavigator(sbPage);
  const userSelect = await frame
    .locator(".sb-nav-row")
    .first()
    .evaluate((el) => getComputedStyle(el).userSelect);
  expect(userSelect).toBe("none");
  // ...but the filter input still is
  const inputSelect = await frame
    .locator("input.sb-nav-input")
    .evaluate((el) => getComputedStyle(el).userSelect);
  expect(inputSelect).not.toBe("none");
});

test("hovering a row does not highlight it", async ({ sbPage }) => {
  // The highlight is the keyboard selection and nothing else: a second one
  // following the pointer reads as a second cursor. What the pointer does get
  // is the row's cursor affordance and its action buttons (below).
  const frame = await openNavigator(sbPage);
  const selected = frame.locator(".sb-nav-row.sb-nav-selected");
  await expect(selected).toBeVisible();

  const colors = (loc: typeof selected) =>
    loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    });

  const before = await colors(selected);
  await selected.hover();
  expect(await colors(selected)).toEqual(before);

  const other = frame.locator(".sb-nav-row:not(.sb-nav-selected)").first();
  const unhovered = await colors(other);
  await other.hover();
  expect(await colors(other)).toEqual(unhovered);
  // ...and it is still the selected row that carries the highlight.
  expect(await colors(selected)).toEqual(before);
});

test("panels get the space style, and follow a mid-session theme change", async ({
  sbPage,
}) => {
  const frame = await openNavigator(sbPage);

  // Space styles reach the (preloaded) modal panel even though the client
  // loads them un-awaited, racing the `editor:init` that triggers preload.
  await expect(async () => {
    const outline = await frame
      .locator(".sb-nav-row")
      .first()
      .evaluate((el) => getComputedStyle(el).outlineColor);
    expect(outline).toBe("rgb(1, 2, 3)");
  }).toPass({ timeout: 20_000 });

  const before = await sbPage.evaluate(() => {
    const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
    (f.contentWindow as any).__themeProbe = true;
    return f.contentDocument!.documentElement.dataset.theme;
  });

  await sbPage.evaluate(() => {
    (globalThis as any).client.ui.viewDispatch({
      type: "set-ui-option",
      key: "darkMode",
      value: true,
    });
  });

  await expect(async () => {
    const after = await sbPage.evaluate(() => {
      const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
      return {
        theme: f.contentDocument!.documentElement.dataset.theme,
        sameFrame: (f.contentWindow as any).__themeProbe === true,
      };
    });
    // Flipped in place: no iframe rebuild, so panel state survives.
    expect(after).toEqual({ theme: "dark", sameFrame: true });
  }).toPass();
  expect(before).not.toBe("dark");
});

test("keymap: a printable key types while typing and acts while navigating", async ({
  sbPage,
}) => {
  // A list view always has a real row selected, so the claimed " " is live
  // from the moment the panel opens -- which is exactly the state in which it
  // must NOT swallow spaces out of the phrase.
  const frame = await openNavigatorView(sbPage, "Navigator: Keymap List");
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }),
  ).toBeVisible();
  await expectFilterInputFocused(sbPage, ".sb-modal iframe");

  const input = frame.locator("input.sb-nav-input");
  const currentPage = sbPage.locator("#sb-current-page input.sb-input");
  await expect(currentPage).toHaveValue("index");

  // Typing mode: the space is text, not a command.
  await sbPage.keyboard.type("projects alpha", { delay: 20 });
  await expect(input).toHaveValue("projects alpha");
  await expect(currentPage).toHaveValue("index");

  // Navigating mode: now the same key runs the view's action.
  await input.press("ArrowDown");
  const target = await frame
    .locator(".sb-nav-selected .sb-nav-primary")
    .innerText();
  await input.press(" ");
  await expect(currentPage).toHaveValue(target);
  // ...without landing in the phrase, and without giving up focus.
  await expect(input).toHaveValue("projects alpha");
  await expectFilterInputFocused(sbPage, ".sb-modal iframe");

  // Editing the phrase puts it back in typing mode.
  await sbPage.keyboard.type("x", { delay: 20 });
  await expect(input).toHaveValue("projects alphax");
  await sbPage.keyboard.type(" y", { delay: 20 });
  await expect(input).toHaveValue("projects alphax y");
  await expect(currentPage).toHaveValue(target);
});

// `foldersFirst = false` deliberately (the shipped space tree uses it): drag
// and drop must not depend on folders being grouped at the top of a level.
const DND_CONFIG = `# Nav DnD test
\`\`\`space-lua
navigator.define {
  name = "movetree",
  title = "Move Tree",
  command = "Navigator: Move Tree",
  dock = "modal",
  presentation = { mode = "tree", foldersFirst = false },
  onMove = navigator.moveByRename,
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}
\`\`\`
`;

test.describe("dnd", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "navtest.md": DND_CONFIG,
      "Projects/Alpha.md": "# Alpha",
      "Journal/Today.md": "# Today",
      // Same last segment as Projects/Alpha: dropping it on Projects is the
      // collision case.
      "X/Alpha.md": "# Other Alpha",
      "Archive/Keep.md": "# Keep",
      // A page that is also a folder: moving it has to take both.
      "Notes.md": "# Notes",
      "Notes/Sub.md": "# Sub",
    },
  });

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A real HTML5 drag: `dragTo` drives actual mouse input, so the browser
   * starts (and ends) a native drag rather than us hand-rolling DragEvents
   * that would never prove the rows are `draggable` in the first place.
   */
  function dragRow(frame: FrameLocator, from: string, to: string) {
    return frame
      .locator(`[data-path='${from}']`)
      .dragTo(frame.locator(`[data-path='${to}']`));
  }

  test("drops a page onto a folder, renaming it", async ({
    sbPage,
    sbServer,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Move Tree");
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await frame.locator("[data-path='Journal'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Journal/Today']")).toBeVisible();

    await dragRow(frame, "Journal/Today", "Projects");

    // The drop expands the target folder, so the moved row is visible where
    // it landed rather than silently vanishing into a collapsed folder.
    await expect(frame.locator("[data-path='Projects/Today']")).toBeVisible({
      timeout: 20_000,
    });
    expect(await exists(join(sbServer.spaceDir, "Projects/Today.md"))).toBe(
      true,
    );
    expect(await exists(join(sbServer.spaceDir, "Journal/Today.md"))).toBe(
      false,
    );
  });

  test("aborts on a name collision, with a notification", async ({
    sbPage,
    sbServer,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Move Tree");
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await frame.locator("[data-path='X'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='X/Alpha']")).toBeVisible();

    await dragRow(frame, "X/Alpha", "Projects");

    await expect(sbPage.locator(".sb-notifications")).toContainText(
      "Projects/Alpha already exists",
    );
    // Nothing moved: no half-done rename, and the source is untouched.
    expect(await exists(join(sbServer.spaceDir, "X/Alpha.md"))).toBe(true);
    expect(await exists(join(sbServer.spaceDir, "Projects/Alpha.md"))).toBe(
      true,
    );
    await expect(frame.locator("[data-path='X/Alpha']")).toBeVisible();
  });

  test("drops a folder, moving its whole subtree", async ({
    sbPage,
    sbServer,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Move Tree");
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await expect(frame.locator("[data-path='Archive']")).toBeVisible();

    await dragRow(frame, "Projects", "Archive");

    await expect(frame.locator("[data-path='Archive/Projects']")).toBeVisible({
      timeout: 20_000,
    });
    expect(
      await exists(join(sbServer.spaceDir, "Archive/Projects/Alpha.md")),
    ).toBe(true);
    expect(await exists(join(sbServer.spaceDir, "Projects/Alpha.md"))).toBe(
      false,
    );
    // The folder it was dropped into kept its own contents.
    expect(await exists(join(sbServer.spaceDir, "Archive/Keep.md"))).toBe(true);
  });

  test("moves a page that is also a folder, page and subtree together", async ({
    sbPage,
    sbServer,
  }) => {
    // `renamePrefixCommand` only touches files under `Notes/`, so the dual
    // needs its own page rename on top of the prefix one.
    const frame = await openNavigatorView(sbPage, "Navigator: Move Tree");
    await expect(frame.locator("[data-path='Notes']")).toBeVisible();
    await expect(frame.locator("[data-path='Archive']")).toBeVisible();

    await dragRow(frame, "Notes", "Archive");

    await expect(frame.locator("[data-path='Archive/Notes']")).toBeVisible({
      timeout: 20_000,
    });
    expect(await exists(join(sbServer.spaceDir, "Archive/Notes.md"))).toBe(
      true,
    );
    expect(await exists(join(sbServer.spaceDir, "Archive/Notes/Sub.md"))).toBe(
      true,
    );
    expect(await exists(join(sbServer.spaceDir, "Notes.md"))).toBe(false);
    expect(await exists(join(sbServer.spaceDir, "Notes/Sub.md"))).toBe(false);
  });

  test("hovering a collapsed folder mid-drag springs it open", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Move Tree");
    const source = frame.locator("[data-path='Journal']");
    const target = frame.locator("[data-path='Archive']");
    await expect(source).toBeVisible();
    await expect(frame.locator("[data-path='Archive/Keep']")).toHaveCount(0);

    // A drag held over the target, rather than `dragTo`'s press-move-release:
    // the whole point is what happens while the pointer lingers.
    await source.hover();
    await sbPage.mouse.down();
    const box = (await target.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // Twice: the first move starts the drag, the second lands on the target.
    await sbPage.mouse.move(x, y, { steps: 5 });
    await sbPage.mouse.move(x, y + 1);
    try {
      await expect(frame.locator("[data-path='Archive/Keep']")).toBeVisible();
    } finally {
      await sbPage.mouse.up();
    }
  });

  test("dragging is off while a filter phrase prunes the tree", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Move Tree");
    const projects = frame.locator("[data-path='Projects']");
    await expect(projects).toHaveAttribute("draggable", "true");

    // A pruned tree isn't the real structure -- a folder on screen may be
    // missing most of its children -- so a drop into it would mean something
    // other than what the user sees.
    const input = frame.locator("input.sb-nav-input");
    // Retried, not raced: the modal's `panel:shown` reset can still land just
    // after the panel is populated, wiping a phrase typed that same instant.
    await expect(async () => {
      await input.fill("alpha");
      await expect(input).toHaveValue("alpha", { timeout: 1000 });
    }).toPass();
    await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
    await expect(projects).toHaveAttribute("draggable", "false");

    await input.fill("");
    await expect(projects).toHaveAttribute("draggable", "true");
  });
});

const ACTION_CONFIG = `# Nav actions test
\`\`\`space-lua
navigator.define {
  name = "actiontree",
  title = "Action Tree",
  command = "Navigator: Action Tree",
  dock = "rhs",
  presentation = { mode = "tree" },
  actions = {
    { icon = "edit-3", label = "Rename", run = function(obj)
        editor.flashNotification("action rename " .. obj.name)
      end },
    { icon = "trash-2", label = "Delete", confirm = "Delete %s?",
      run = function(obj)
        editor.flashNotification("action delete " .. obj.name)
      end },
    { icon = "folder-plus", label = "New page here",
      when = function(obj) return obj.isFolder == true end,
      run = function(obj)
        editor.flashNotification("action new " .. obj.name)
      end },
  },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator.define {
  name = "actionlist",
  title = "Action List",
  command = "Navigator: Action List",
  dock = "modal",
  presentation = { mode = "list" },
  actions = {
    { icon = "edit-3", label = "Rename", run = function(obj)
        editor.flashNotification("action rename " .. obj.name)
      end },
    { icon = "star", label = "Star",
      when = function(obj) return string.sub(obj.name, 1, 9) == "Projects/" end,
      run = function(obj)
        editor.flashNotification("action star " .. obj.name)
      end },
  },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator.define {
  name = "icontree",
  title = "Icon Tree",
  command = "Navigator: Icon Tree",
  dock = "rhs",
  presentation = {
    mode = "tree",
    row = {
      icon = function(obj)
        -- Namespaced form: equivalent to the bare "folder" name.
        if obj.isFolder then return "feather:folder" end
        if obj.name == "index" then
          return [[<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" data-raw="yes"><circle cx="12" cy="12" r="10"/></svg>]]
        end
        if obj.name == "Journal/Today" then return nil end
        -- The removed { svg = ... } table, returned at runtime rather than
        -- assigned statically -- navigator:rowState only admits a string
        -- result, so this row gets no icon, quietly.
        if obj.name == "Projects/Alpha" then
          return { svg = "<svg xmlns='http://www.w3.org/2000/svg'></svg>" }
        end
        return "file-text"
      end,
    },
  },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

-- An empty table is not an empty array once it crosses to the panel; both of
-- these used to take the whole view down with a TypeError.
navigator.define {
  name = "emptyextras",
  title = "Empty Extras",
  command = "Navigator: Empty Extras",
  dock = "modal",
  presentation = { mode = "list" },
  actions = {},
  keymap = {},
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator.define {
  name = "rotree",
  title = "RO Tree",
  command = "Navigator: RO Tree",
  dock = "rhs",
  create = true,
  presentation = { mode = "tree" },
  onMove = navigator.moveByRename,
  actions = {
    { icon = "eye", label = "Peek", run = function(obj)
        editor.flashNotification("action peek " .. obj.name)
      end },
    { icon = "trash-2", label = "Delete", requireMode = "rw",
      run = function(obj)
        editor.flashNotification("action delete " .. obj.name)
      end },
  },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}
\`\`\`
`;

test.describe("actions", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "navtest.md": ACTION_CONFIG,
      "Projects/Alpha.md": "# Alpha",
      "Journal/Today.md": "# Today",
      // A page that is also a folder: it heads a section *and* is navigable.
      "Notes.md": "# Notes",
      "Notes/Sub.md": "# Sub",
    },
  });

  const PANEL = ".sb-keyed-panel-rhs iframe";

  async function openTree(sbPage: Page, command: string) {
    const frame = await openNavigatorView(sbPage, command, PANEL);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await expect(frame.locator("[data-path='Notes']")).toBeVisible();
    return frame;
  }

  function action(frame: FrameLocator, path: string, label: string) {
    return frame.locator(
      `[data-path='${path}'] .sb-row-action[aria-label='${label}']`,
    );
  }

  test("hover reveals a row's actions; the selected row shows them without one", async ({
    sbPage,
  }) => {
    const frame = await openTree(sbPage, "Navigator: Action Tree");

    const projects = frame.locator("[data-path='Projects']");
    await expect(projects).not.toHaveClass(/sb-nav-selected/);
    const rename = action(frame, "Projects", "Rename");
    // Not in the DOM at all until the row is the selected or the hovered one:
    // a long list carries no buttons it isn't about to show.
    await expect(rename).toHaveCount(0);

    await projects.hover();
    await expect(rename).toBeVisible();
    // An icon, not the label-text fallback: numbered feather names ("edit-3")
    // are exactly what a naive kebab-to-Pascal conversion silently drops.
    await expect(rename.locator("svg")).toHaveCount(1);

    // The keyboard/touch path: the selected row shows its actions with the
    // pointer nowhere near it (it's on "Projects" right now).
    const selected = frame.locator(".sb-nav-row.sb-nav-selected");
    await expect(selected).not.toHaveAttribute("data-path", "Projects");
    await expect(selected.locator(".sb-row-action").first()).toBeVisible();
  });

  test("when() decides which actions a row offers", async ({ sbPage }) => {
    const frame = await openTree(sbPage, "Navigator: Action Tree");

    // Hovered, because that (or being selected) is what mounts them at all.
    const actionsOn = async (path: string) => {
      await frame.locator(`[data-path='${path}']`).hover();
      return frame.locator(`[data-path='${path}'] .sb-row-action`);
    };

    // Folder: all three, including the folders-only one.
    await expect(await actionsOn("Projects")).toHaveCount(3);
    // A page that is also a folder heads a section, so it gets it too.
    await expect(await actionsOn("Notes")).toHaveCount(3);
    // A plain page doesn't.
    await expect(await actionsOn("index")).toHaveCount(2);
    await expect(action(frame, "index", "New page here")).toHaveCount(0);
    await expect(action(frame, "index", "Rename")).toHaveCount(1);
  });

  test("list mode gets the same actions, per-row when() included", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Action List");
    const row = (text: string) =>
      frame.locator(".sb-nav-row", { hasText: text }).first();
    await expect(row("Projects/Alpha")).toBeVisible();

    await row("index").hover();
    await expect(row("index").locator(".sb-row-action")).toHaveCount(1);

    const star = row("Projects/Alpha").locator(
      ".sb-row-action[aria-label='Star']",
    );
    await row("Projects/Alpha").hover();
    await expect(row("Projects/Alpha").locator(".sb-row-action")).toHaveCount(
      2,
    );
    await expect(star).toBeVisible();
    await star.click();

    await expect(sbPage.locator(".sb-notifications")).toContainText(
      "action star Projects/Alpha",
    );
    // Clicking the button did not select the row out from under the user: the
    // modal is still open, on the same page.
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "index",
    );
    await expectFilterInputFocused(sbPage, ".sb-modal iframe");
  });

  test("clicking an action runs it on that row, keeping focus in the filter", async ({
    sbPage,
  }) => {
    const frame = await openTree(sbPage, "Navigator: Action Tree");

    const projects = frame.locator("[data-path='Projects']");
    await projects.hover();
    // Count real source re-runs: this action touches no file, so nothing else
    // would ever prompt a refresh -- yet a rename or delete action has to
    // leave the view showing what is actually there now.
    await sbPage.evaluate(() => {
      const f = document.querySelector(
        ".sb-keyed-panel-rhs iframe",
      ) as HTMLIFrameElement;
      const w = f.contentWindow as any;
      w.__refreshCalls = 0;
      const engine = w.__navigatorEngine;
      const orig = engine.refresh.bind(engine);
      engine.refresh = (...args: unknown[]) => {
        w.__refreshCalls++;
        return orig(...args);
      };
    });

    await action(frame, "Projects", "Rename").click();

    await expect(sbPage.locator(".sb-notifications")).toContainText(
      "action rename Projects",
    );
    // The row's own click handler never fired: the folder is still collapsed.
    await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);
    await expectFilterInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");

    await expect(async () => {
      const calls = await sbPage.evaluate(() => {
        const f = document.querySelector(
          ".sb-keyed-panel-rhs iframe",
        ) as HTMLIFrameElement;
        return (f.contentWindow as any).__refreshCalls as number;
      });
      expect(calls).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
  });

  test("a confirm-gated action asks first, and does nothing when declined", async ({
    sbPage,
  }) => {
    const frame = await openTree(sbPage, "Navigator: Action Tree");

    const index = frame.locator("[data-path='index']");
    await index.hover();
    await action(frame, "index", "Delete").click();

    const prompt = sbPage.locator(".sb-prompt");
    await expect(prompt).toContainText("Delete index?");
    await prompt.locator("button", { hasText: "Cancel" }).click();
    await expect(prompt).toHaveCount(0);

    // A notification the decline wrongly produced would race this assertion if
    // it were checked straight away, so anchor it behind a *later* observable
    // event: run a different action, wait for its notification, and only then
    // insist the declined one never appeared.
    const notifications = sbPage.locator(".sb-notifications");
    await frame.locator("[data-path='Projects']").hover();
    await action(frame, "Projects", "Rename").click();
    await expect(notifications).toContainText("action rename Projects");
    await expect(notifications).not.toContainText("action delete");

    await index.hover();
    await action(frame, "index", "Delete").click();
    await expect(prompt).toContainText("Delete index?");
    await prompt.locator("button", { hasText: "Ok" }).click();

    await expect(notifications).toContainText("action delete index");
    // The confirm dialog took focus on its way in; the panel takes it back.
    await expectFilterInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");
  });

  test("folder rows are styled as section headers, pages are not", async ({
    sbPage,
  }) => {
    const frame = await openTree(sbPage, "Navigator: Action Tree");

    const weight = (path: string) =>
      frame
        .locator(`[data-path='${path}']`)
        .evaluate((el) => getComputedStyle(el).fontWeight);
    const color = (path: string) =>
      frame
        .locator(`[data-path='${path}']`)
        .evaluate((el) => getComputedStyle(el).color);

    await expect(frame.locator("[data-path='Projects']")).toHaveClass(
      /sb-nav-folder/,
    );
    // A page that is also a folder heads a section too.
    await expect(frame.locator("[data-path='Notes']")).toHaveClass(
      /sb-nav-folder/,
    );
    await expect(frame.locator("[data-path='index']")).not.toHaveClass(
      /sb-nav-folder/,
    );

    const band = (path: string) =>
      frame
        .locator(`[data-path='${path}']`)
        .evaluate((el) => getComputedStyle(el).backgroundImage);

    const pageWeight = await weight("index");
    expect(await weight("Projects")).not.toBe(pageWeight);
    expect(await weight("Notes")).not.toBe(pageWeight);
    // Text color is *not* what distinguishes them: the band is.
    expect(await color("Projects")).toBe(await color("index"));
    expect(await band("index")).toBe("none");
    expect(await band("Projects")).not.toBe("none");
    expect(await band("Notes")).not.toBe("none");

    // The band is all a hover leaves alone: rows carry no hover highlight.
    const resting = await frame
      .locator("[data-path='Projects']")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await frame.locator("[data-path='Projects']").hover();
    expect(
      await frame
        .locator("[data-path='Projects']")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(resting);

    // The selection is its own opaque surface, band cleared, with the
    // contrast foreground its background is paired with.
    await frame.locator("[data-path='Projects']").click(); // selects + expands
    await expect(
      frame.locator("[data-path='Projects'].sb-nav-selected"),
    ).toBeVisible();
    expect(await band("Projects")).toBe("none");
    expect(await color("Projects")).not.toBe(await color("Projects/Alpha"));
  });

  test("row icons render per object, with a reserved slot for the ones without", async ({
    sbPage,
  }) => {
    const frame = await openTree(sbPage, "Navigator: Icon Tree");
    await frame.locator("[data-path='Journal'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Journal/Today']")).toBeVisible();
    await frame.locator("[data-path='Notes'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Notes/Sub']")).toBeVisible();

    const svg = (path: string) =>
      frame
        .locator(`[data-path='${path}'] .sb-nav-icon svg`)
        .evaluate((el) => el.outerHTML);

    // A folder is passed the synthetic folder object, so it can icon
    // differently from a page -- resolved through the client, not bundled.
    const folderIcon = await svg("Projects");
    const pageIcon = await svg("Notes/Sub");
    expect(folderIcon).toContain("<svg");
    expect(folderIcon).not.toBe(pageIcon);
    // The dual heads a section, so it icons as a folder.
    expect(await svg("Notes")).toBe(folderIcon);

    // Raw markup goes in verbatim.
    await expect(
      frame.locator("[data-path='index'] .sb-nav-icon svg[data-raw='yes']"),
    ).toHaveCount(1);

    // nil: the slot is still there, so rows at the same depth stay aligned.
    await expect(
      frame.locator("[data-path='Journal/Today'] .sb-nav-icon"),
    ).toHaveCount(1);
    await expect(
      frame.locator("[data-path='Journal/Today'] .sb-nav-icon svg"),
    ).toHaveCount(0);
    const left = (path: string) =>
      frame
        .locator(`[data-path='${path}'] .sb-nav-primary`)
        .evaluate((el) => el.getBoundingClientRect().left);
    expect(await left("Journal/Today")).toBe(await left("Notes/Sub"));
  });

  test("a row.icon function returning the removed { svg = ... } table draws nothing, quietly", async ({
    sbPage,
  }) => {
    const consoleErrors: string[] = [];
    sbPage.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const frame = await openTree(sbPage, "Navigator: Icon Tree");
    await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();

    // navigator:rowState only admits a string result, so a table return --
    // the pre-consolidation escape hatch, still reachable at runtime since
    // validateRowIcon can't see what a function will return -- leaves the
    // slot reserved but empty, same as a nil return.
    await expect(
      frame.locator("[data-path='Projects/Alpha'] .sb-nav-icon"),
    ).toHaveCount(1);
    await expect(
      frame.locator("[data-path='Projects/Alpha'] .sb-nav-icon svg"),
    ).toHaveCount(0);

    // A sibling row's icon still renders -- one bad row doesn't cost the
    // whole batch.
    await expect(
      frame.locator("[data-path='Projects'] .sb-nav-icon svg"),
    ).toHaveCount(1);

    expect(consoleErrors).toEqual([]);
  });

  test("a view without row icons gets no icon slot at all", async ({
    sbPage,
  }) => {
    const frame = await openTree(sbPage, "Navigator: Action Tree");
    await expect(frame.locator(".sb-nav-icon")).toHaveCount(0);
  });

  test("empty actions/keymap tables don't take the view down", async ({
    sbPage,
  }) => {
    // Lua's `{}` crosses as an object, not an array: `.some`/`.includes` on it
    // threw, which meant a boot error instead of a view, and a TypeError on
    // every keystroke.
    const frame = await openNavigatorView(sbPage, "Navigator: Empty Extras");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }),
    ).toBeVisible();
    await expect(frame.locator(".sb-nav-error")).toHaveCount(0);

    const input = frame.locator("input.sb-nav-input");
    await sbPage.keyboard.type("alpha", { delay: 20 });
    await expect(input).toHaveValue("alpha");
    await expect(frame.locator(".sb-nav-primary").first()).toHaveText(
      "Projects/Alpha",
    );
  });

  test("read-only mode hides every mutating affordance, live", async ({
    sbPage,
  }) => {
    const frame = await openTree(sbPage, "Navigator: RO Tree");
    const input = frame.locator("input.sb-nav-input");

    // Read-write baseline, so the assertions after the toggle can't pass
    // vacuously. Hovered, because that is what mounts a row's actions.
    await frame.locator("[data-path='Projects']").hover();
    await expect(action(frame, "Projects", "Delete")).toHaveCount(1);
    await expect(action(frame, "Projects", "Peek")).toHaveCount(1);
    await expect(frame.locator("[data-path='Projects']")).toHaveAttribute(
      "draggable",
      "true",
    );
    await input.fill("zzz-not-a-page");
    await expect(frame.locator(".sb-nav-create")).toBeVisible();
    await input.fill("");

    // The panel holds focus once shown; hand it back so the palette hotkey lands
    await sbPage.locator("#sb-editor .cm-content").click();
    await runCommand(sbPage, "Editor: Toggle Read Only Mode");
    await expect(sbPage.locator(".sb-notifications")).toContainText(
      "Read-only mode enabled",
    );

    // Live: the panel was never reopened. (The palette took the pointer out of
    // the panel, so hover the row again to mount what is left of its actions.)
    await frame.locator("[data-path='Projects']").hover();
    await expect(action(frame, "Projects", "Delete")).toHaveCount(0);
    // ...and only the rw-gated action went away.
    await expect(action(frame, "Projects", "Peek")).toHaveCount(1);
    await expect(frame.locator("[data-path='Projects']")).toHaveAttribute(
      "draggable",
      "false",
    );
    await input.fill("zzz-not-a-page");
    await expect(frame.locator(".sb-nav-create")).toHaveCount(0);
  });
});

test("activation: a stale out-of-order arrival can't clobber panel state", async ({
  sbPage,
}) => {
  // Each `open()` stamps a monotonic token, and one open reaches the panel
  // twice (pushed + pulled by the boot handshake). Plug invocations aren't
  // serialized, so two rapid opens can also arrive out of order -- an older
  // activation landing after a newer one must be dropped, not just a literal
  // duplicate of the newest.
  const dispatchActivate = (view: string, token: number) =>
    sbPage.evaluate(
      ({ view, token }) => {
        void (globalThis as any).client.eventHook.dispatchEvent(
          "navigator:activate",
          { slot: "modal", view, token },
        );
      },
      { view, token },
    );

  // Two real opens, so the handled token is above 1 and a stale arrival is
  // distinguishable from a duplicate of the current one.
  await openNavigator(sbPage);
  await navInput(sbPage).press("Escape"); // empty phrase: closes
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);
  // The panel hands focus back on its way out; take it explicitly so the
  // palette hotkey below can't race that round trip.
  await sbPage.locator("#sb-editor .cm-content").click();
  await openNavigator(sbPage);

  await navInput(sbPage).fill("alpha");
  await expect(navInput(sbPage)).toHaveValue("alpha");

  // Stale: must be ignored. (Under an equality-only check this passes the
  // guard and the activation tail clears the phrase.)
  await dispatchActivate("pages", 1);
  await sbPage.waitForTimeout(500);
  await expect(navInput(sbPage)).toHaveValue("alpha");

  // Positive control: a *newer* token still activates, so the assertion above
  // isn't just measuring a dead dispatch path.
  await dispatchActivate("pages", 9999);
  await expect(navInput(sbPage)).toHaveValue("");
  await expectFilterInputFocused(sbPage, ".sb-modal iframe");
});

const FILTER_CONFIG = `# Nav filter test
\`\`\`space-lua
-- Synthetic, so a segment's subset doesn't depend on what the background
-- indexer has delivered yet.
local function things()
  return {
    { name = "Alpha", ref = "Alpha", kind = "page" },
    { name = "Projects/Beta", ref = "Projects/Beta", kind = "page" },
    { name = "Projects/Gamma.png", ref = "Projects/Gamma.png", kind = "doc" },
    { name = "Settings", ref = "Settings", kind = "meta" },
  }
end

local kindSegments = {
  { label = "All", icon = "layers", default = true },
  { label = "Pages", icon = "file-text",
    where = function(obj) return obj.kind == "page" end },
  { label = "Docs", icon = "file",
    where = function(obj) return obj.kind == "doc" end },
}

navigator.define {
  name = "segmentlist",
  title = "Segment List",
  command = "Navigator: Segment List",
  dock = "modal",
  presentation = { mode = "list" },
  segments = kindSegments,
  source = things,
}

-- segmentlist, minus any refresh trigger. The syscall-counting test below
-- measures what a *keystroke* costs; a background indexing pass finishing
-- mid-test fires a legitimate refresh (two dispatches: rows + rowState) that
-- would otherwise be charged to the keyboard.
navigator.define {
  name = "norefresh",
  title = "No Refresh",
  command = "Navigator: No Refresh",
  dock = "modal",
  presentation = { mode = "list" },
  segments = kindSegments,
  refreshOn = { "navigator:test:neverFires" },
  source = things,
}

navigator.define {
  name = "segmenttree",
  title = "Segment Tree",
  command = "Navigator: Segment Tree",
  dock = "rhs",
  presentation = { mode = "tree" },
  segments = kindSegments,
  source = things,
}

-- A name far wider than the narrowest dock, on a row that also carries an
-- icon: the icon offsets the name, so a name allowed to take the row's whole
-- width ends up past the pane -- with its own ellipsis rendered off-screen.
navigator.define {
  name = "longnames",
  title = "Long Names",
  command = "Navigator: Long Names",
  dock = "rhs",
  presentation = {
    mode = "list",
    row = { icon = function() return "file-text" end },
  },
  source = function()
    return {
      { name = "Projects/Quarterly Planning Retrospective Notes",
        ref = "Projects/Quarterly Planning Retrospective Notes" },
    }
  end,
}

-- Label-only segments: they must never collapse to nothing, however narrow.
navigator.define {
  name = "filterplain",
  title = "Filter Plain",
  command = "Navigator: Filter Plain",
  dock = "rhs",
  presentation = { mode = "list" },
  segments = {
    { label = "Everything", default = true },
    { label = "Just pages",
      where = function(obj) return obj.kind == "page" end },
  },
  source = things,
}

-- A predicate that throws: fail-closed, and it must not take the pass whole.
navigator.define {
  name = "filterboom",
  title = "Filter Boom",
  command = "Navigator: Filter Boom",
  dock = "modal",
  presentation = { mode = "list" },
  segments = {
    { label = "All", default = true },
    { label = "Boom", where = function(obj)
        if obj.kind == "doc" then error("nope") end
        return obj.kind == "page"
      end },
  },
  source = things,
}

-- Both plausible spellings of "nothing here": an empty Lua table crosses as an
-- object, and neither field survives being taken at face value -- refreshOn is
-- spread into an event list, and empty filter fields would rank every row
-- against no field at all, emptying the list on the first keystroke.
navigator.define {
  name = "emptytables",
  title = "Empty Tables",
  command = "Navigator: Empty Tables",
  dock = "modal",
  presentation = { mode = "list" },
  refreshOn = {},
  filter = { fields = {} },
  source = things,
}

-- Definition-time validation: each of these must be rejected outright.
navigator._badIcons = {}
for _, case in ipairs({
  { what = "segment icon", spec = { name = "bad1", source = things,
      segments = { { label = "A", icon = 42 } } } },
  -- The old { svg = ... } escape hatch: an icon must be a string now.
  { what = "segment icon svg table", spec = { name = "bad2", source = things,
      segments = { { label = "A", icon = { svg = "<svg></svg>" } } } } },
  { what = "action icon", spec = { name = "bad3", source = things,
      actions = { { label = "A", icon = {}, run = function() end } } } },
  { what = "action icon svg table", spec = { name = "bad3b", source = things,
      actions = { { label = "A", icon = { svg = "<svg></svg>" }, run = function() end } } } },
  -- The old sibling svg attribute: removed outright, not just untyped.
  { what = "action svg", spec = { name = "bad4", source = things,
      actions = { { label = "A", svg = "<svg></svg>", run = function() end } } } },
  -- presentation.row.icon: same old escape hatch, its own validator.
  { what = "row icon svg table", spec = { name = "bad4b", source = things,
      presentation = { row = { icon = { svg = "<svg></svg>" } } } } },
  { what = "limit", spec = { name = "bad5", source = things,
      presentation = { limit = 0 } } },
  { what = "search", spec = { name = "bad6", source = things, search = "fts" } },
  { what = "duplicate label", spec = { name = "bad7", source = things,
      segments = { { label = "A" }, { label = "A" } } } },
  { what = "dock", spec = { name = "bad8", source = things, dock = "left" } },
  { what = "mode", spec = { name = "bad9", source = things,
      presentation = { mode = "table" } } },
  { what = "hierarchy", spec = { name = "bad10", source = things,
      presentation = { mode = "tree", hierarchy = {} } } },
}) do
  local ok = pcall(navigator.define, case.spec)
  navigator._badIcons[#navigator._badIcons + 1] = case.what .. "=" .. tostring(ok)
end

-- Reads the outcomes back out through the machinery under test.
navigator.define {
  name = "validation",
  title = "Validation",
  command = "Navigator: Validation",
  dock = "modal",
  presentation = { mode = "list" },
  source = function()
    local out = {}
    for _, line in ipairs(navigator._badIcons) do
      out[#out + 1] = { name = line, ref = line }
    end
    return out
  end,
}
\`\`\`
`;

test.describe("segments", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "navtest.md": FILTER_CONFIG,
      "Projects/Alpha.md": "# Alpha",
    },
  });

  const PANEL = ".sb-keyed-panel-rhs iframe";

  function segment(frame: FrameLocator, label: string) {
    return frame.locator(`.sb-segment[aria-label='${label}']`);
  }

  async function openSegmentList(sbPage: Page) {
    const frame = await openNavigatorView(sbPage, "Navigator: Segment List");
    await expect(segment(frame, "All")).toBeVisible();
    return frame;
  }

  test("segments subset the rows, and the phrase composes with them", async ({
    sbPage,
  }) => {
    const frame = await openSegmentList(sbPage);
    const primaries = () => frame.locator(".sb-nav-primary").allInnerTexts();

    // The default segment: `default = true`, i.e. everything.
    await expect(segment(frame, "All")).toHaveAttribute("aria-checked", "true");
    expect(await primaries()).toEqual([
      "Alpha",
      "Projects/Beta",
      "Projects/Gamma.png",
      "Settings",
    ]);

    await segment(frame, "Pages").click();
    await expect(segment(frame, "Pages")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(segment(frame, "All")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(await primaries()).toEqual(["Alpha", "Projects/Beta"]);
    // Clicking a segment hands focus straight back to the phrase input.
    await expectFilterInputFocused(sbPage, ".sb-modal iframe");

    // The segment subsets, the phrase ranks what is left.
    await navInput(sbPage).fill("beta");
    expect(await primaries()).toEqual(["Projects/Beta"]);
    // ...and it cannot reach a row the segment excluded, however well it
    // matches.
    await navInput(sbPage).fill("gamma");
    await expect(frame.locator(".sb-nav-empty")).toBeVisible();

    await segment(frame, "Docs").click();
    expect(await primaries()).toEqual(["Projects/Gamma.png"]);
  });

  // Segment counts (`presentation.filterCounts`) were removed before release
  // -- the coverage that lived here (totals shown only while the phrase is
  // empty, hidden rather than removed to keep the control's width) went with
  // it.

  test("Ctrl-Arrow cycles the segments, wrapping both ways", async ({
    sbPage,
  }) => {
    const frame = await openSegmentList(sbPage);
    const active = frame.locator(".sb-segment[aria-checked='true']");

    await expect(active).toHaveText(/All/);
    await navInput(sbPage).press("Control+ArrowRight");
    await expect(active).toHaveText(/Pages/);
    await navInput(sbPage).press("Control+ArrowRight");
    await expect(active).toHaveText(/Docs/);
    // Wraps around...
    await navInput(sbPage).press("Control+ArrowRight");
    await expect(active).toHaveText(/All/);
    // ...in both directions.
    await navInput(sbPage).press("Control+ArrowLeft");
    await expect(active).toHaveText(/Docs/);
    // Shift is ignored, so the macOS-safe chord works too.
    await navInput(sbPage).press("Control+Shift+ArrowLeft");
    await expect(active).toHaveText(/Pages/);

    // The chord is not text: the phrase is untouched and typing still types.
    await expect(navInput(sbPage)).toHaveValue("");
    await sbPage.keyboard.type("alpha", { delay: 20 });
    await expect(navInput(sbPage)).toHaveValue("alpha");
  });

  test("the active segment is remembered per view", async ({ sbPage }) => {
    const frame = await openSegmentList(sbPage);
    await segment(frame, "Docs").click();
    await expect(segment(frame, "Docs")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await navInput(sbPage).press("Escape");
    await expect(
      sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
    ).toHaveCount(0);
    // The panel hands focus back on its way out; take it explicitly so the
    // palette hotkey below can't race that round trip.
    await sbPage.locator("#sb-editor .cm-content").click();

    const reopened = await openSegmentList(sbPage);
    await expect(segment(reopened, "Docs")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(await reopened.locator(".sb-nav-primary").allInnerTexts()).toEqual([
      "Projects/Gamma.png",
    ]);
  });

  test("a tree segment subsets the rows and keeps their ancestors", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(
      sbPage,
      "Navigator: Segment Tree",
      PANEL,
    );
    await expect(frame.locator("[data-path='Alpha']")).toBeVisible();
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();

    await frame.locator(".sb-segment[aria-label='Docs']").click();
    // The folder its only match hangs off is rebuilt; the pages are gone.
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await expect(frame.locator("[data-path='Alpha']")).toHaveCount(0);
    await expect(frame.locator("[data-path='Settings']")).toHaveCount(0);
    await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await expect(
      frame.locator("[data-path='Projects/Gamma.png']"),
    ).toBeVisible();
    await expect(frame.locator("[data-path='Projects/Beta']")).toHaveCount(0);
  });

  test("a throwing predicate drops its row, not the whole pass", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Filter Boom");
    await expect(frame.locator(".sb-segment[aria-label='Boom']")).toBeVisible();
    await frame.locator(".sb-segment[aria-label='Boom']").click();

    // The pages the predicate answered for are there; the document it threw on
    // is not, and the view is not in an error state.
    expect(await frame.locator(".sb-nav-primary").allInnerTexts()).toEqual([
      "Alpha",
      "Projects/Beta",
    ]);
    await expect(frame.locator(".sb-nav-error")).toHaveCount(0);
  });

  test("segments keep working in read-only mode", async ({ sbPage }) => {
    // A sidebar rather than the modal: the toggle goes through the command
    // palette, which a modal panel's backdrop would swallow.
    const frame = await openNavigatorView(
      sbPage,
      "Navigator: Segment Tree",
      PANEL,
    );
    await expect(frame.locator("[data-path='Alpha']")).toBeVisible();

    await sbPage.locator("#sb-editor .cm-content").click();
    await runCommand(sbPage, "Editor: Toggle Read Only Mode");
    await expect(sbPage.locator(".sb-notifications")).toContainText(
      "Read-only mode enabled",
    );

    // Reads, all of them -- nothing here needs the space to be writable.
    await frame.locator(".sb-segment[aria-label='Pages']").click();
    await expect(frame.locator("[data-path='Alpha']")).toBeVisible();
    await expect(frame.locator("[data-path='Settings']")).toHaveCount(0);
  });

  test("typing costs no syscalls, and a switch costs only its persistence", async ({
    sbPage,
  }) => {
    // The refresh-free twin of segmentlist -- see norefresh in the config: a
    // background refresh landing mid-test is legitimate, but it is not
    // something a keystroke paid for, and this counts every syscall the panel
    // makes over a window several seconds wide.
    const frame = await openNavigatorView(sbPage, "Navigator: No Refresh");
    await expect(segment(frame, "All")).toBeVisible();
    await expect(frame.locator(".sb-nav-row")).toHaveCount(4);

    // Count everything crossing the panel's syscall bridge -- the only way out
    // of the iframe there is.
    const counted = () =>
      sbPage.evaluate(() => (globalThis as any).__navSyscalls as string[]);
    await sbPage.evaluate(() => {
      const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
      const w = f.contentWindow as any;
      const log: string[] = [];
      (globalThis as any).__navSyscalls = log;
      const orig = w.syscall;
      w.syscall = (name: string, ...args: any[]) => {
        log.push(name);
        return orig(name, ...args);
      };
    });

    // The load-bearing contract: ranking, filtering and rendering all happen
    // inside the iframe, so a keystroke never leaves it.
    await sbPage.keyboard.type("alpha", { delay: 60 });
    await expect(navInput(sbPage)).toHaveValue("alpha");
    await expect(frame.locator(".sb-nav-primary").first()).toHaveText("Alpha");
    expect(await counted()).toEqual([]);

    // A segment switch is masks-only too -- no source re-run, no rowState
    // batch. It does persist the choice, which is one write and nothing else.
    await frame.locator(".sb-segment[aria-label='Pages']").click();
    await expect(segment(frame, "Pages")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(async () => {
      expect(await counted()).toEqual(["datastore.set"]);
    }).toPass();

    // ...and typing after the switch is still free.
    await sbPage.keyboard.type("bet", { delay: 60 });
    await expect(navInput(sbPage)).toHaveValue("alphabet");
    expect(await counted()).toEqual(["datastore.set"]);
  });

  test("a segment whose predicates never arrived says so", async ({
    sbPage,
  }) => {
    const frame = await openSegmentList(sbPage);
    await frame.locator(".sb-segment[aria-label='Pages']").click();
    await expect(frame.locator(".sb-nav-row")).toHaveCount(2);

    // Break the batch that carries the `where` results, then refresh.
    await sbPage.evaluate(() => {
      const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
      const w = f.contentWindow as any;
      const orig = w.syscall;
      w.syscall = (name: string, ...args: any[]) => {
        if (name === "event.dispatch" && args[0] === "navigator:rowState") {
          return Promise.reject(new Error("no state for you"));
        }
        return orig(name, ...args);
      };
      w.__navigatorHooks.refresh();
    });

    // Fail-closed leaves the segment empty, which on its own is
    // indistinguishable from "nothing matched" -- so it says which it is.
    await expect(frame.locator(".sb-nav-notice")).toBeVisible();
    await expect(frame.locator(".sb-nav-row")).toHaveCount(0);

    // The pass-through segment still works, and the notice goes with it.
    await frame.locator(".sb-segment[aria-label='All']").click();
    await expect(frame.locator(".sb-nav-row")).toHaveCount(4);
    await expect(frame.locator(".sb-nav-notice")).toHaveCount(0);
  });

  test("empty refreshOn and filter.fields tables mean 'none', not 'broken'", async ({
    sbPage,
  }) => {
    // `refreshOn = {}` used to reach the plug as an object and fail the open
    // outright (`object is not iterable`); `filter = { fields = {} }` used to
    // survive as a truthy field map and rank every row 0.
    const frame = await openNavigatorView(sbPage, "Navigator: Empty Tables");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(4);

    await navInput(sbPage).fill("beta");
    await expect(frame.locator(".sb-nav-primary").first()).toHaveText(
      "Projects/Beta",
    );
  });

  test("bad icons, limits, modes and labels are rejected at define time", async ({
    sbPage,
  }) => {
    // Every one of these would otherwise cross to the panel and quietly draw
    // nothing (or, for the duplicate label, persist ambiguously).
    const frame = await openNavigatorView(sbPage, "Navigator: Validation");
    await expect(frame.locator(".sb-nav-row").first()).toBeVisible();
    expect(await frame.locator(".sb-nav-primary").allInnerTexts()).toEqual([
      "segment icon=false",
      "segment icon svg table=false",
      "action icon=false",
      "action icon svg table=false",
      "action svg=false",
      "row icon svg table=false",
      "limit=false",
      "search=false",
      "duplicate label=false",
      "dock=false",
      "mode=false",
      "hierarchy=false",
    ]);
  });

  test("a narrow dock collapses iconed segments to icons alone", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(
      sbPage,
      "Navigator: Segment Tree",
      PANEL,
    );
    await expect(frame.locator(".sb-segment").first()).toBeVisible();

    const label = frame
      .locator(".sb-segment[aria-label='Pages'] .sb-segment-label")
      .first();
    const icon = frame
      .locator(".sb-segment[aria-label='Pages'] .sb-segment-icon")
      .first();

    // Widened: labels fit, so they show.
    await dragSidebar(sbPage, frame, -220);
    await expect(label).toBeVisible();
    await expect(icon).toBeVisible();

    // Squeezed to the minimum: the icon carries the segment, the label lives
    // on as the tooltip and the accessible name.
    await dragSidebar(sbPage, frame, 400);
    await expect(label).toBeHidden();
    await expect(icon).toBeVisible();
    await expect(
      frame.locator(".sb-segment[aria-label='Pages']").first(),
    ).toHaveAttribute("title", "Pages");
  });

  // "a dock too narrow even for the icons drops the counts, never wraps" is
  // gone: segment counts (`presentation.filterCounts`) were removed before
  // release, and that test's whole premise was the responsive-fit tier that
  // dropped them.

  test("a name too long for its dock ellipsizes inside it", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(
      sbPage,
      "Navigator: Long Names",
      PANEL,
    );
    await expect(frame.locator(".sb-nav-row").first()).toBeVisible();
    await dragSidebar(sbPage, frame, 400);

    // A name wider than the dock used to run past the pane and stop
    // mid-glyph, its own ellipsis rendered off-screen where nothing could see
    // it. Every row's name now ends inside the panel.
    const overrun = await frame.locator(".sb-nav-body").evaluate((body) => {
      const limit = body.getBoundingClientRect().right;
      return [...body.querySelectorAll(".sb-nav-primary")].filter(
        (el) => el.getBoundingClientRect().right > limit + 1,
      ).length;
    });
    expect(overrun).toBe(0);
  });

  test("segments without an icon keep their label at any width", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(
      sbPage,
      "Navigator: Filter Plain",
      PANEL,
    );
    const label = frame
      .locator(".sb-segment[aria-label='Just pages'] .sb-segment-label")
      .first();
    await expect(label).toBeVisible();

    await dragSidebar(sbPage, frame, 400);
    await expect(label).toBeVisible();
  });
});

/** Drags the rhs sidebar's resize handle by `dx` (positive = narrower). */
async function dragSidebar(sbPage: Page, frame: FrameLocator, dx: number) {
  const handle = frame.locator(".sb-resizer-rhs");
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  await sbPage.mouse.move(box.x + box.width / 2, y);
  await sbPage.mouse.down();
  await sbPage.mouse.move(box.x + box.width / 2 + dx, y, { steps: 10 });
  await sbPage.mouse.up();
  // Park the pointer away from the panel: a resize that leaves it hovering a
  // row would mount that row's actions and confuse a later count.
  await sbPage.mouse.move(5, 5);
}

const SOURCE_CONFIG = `# Nav source-mode test
\`\`\`space-lua
local NAMES = { "Anchor", "Bluebird", "Blueprint", "Cobalt", "Delta" }

local function pick(ctx)
  local out = {}
  for _, name in ipairs(NAMES) do
    if ctx.segment ~= "Blue" or string.sub(name, 1, 4) == "Blue" then
      out[#out + 1] = { name = name, ref = name }
    end
  end
  return out
end

navigator.define {
  name = "sourcesearch",
  title = "Source Search",
  command = "Navigator: Source Search",
  dock = "modal",
  search = "source",
  presentation = { mode = "list" },
  segments = {
    { label = "All", default = true },
    -- In source mode the label is what reaches the source; a \`where\` left
    -- over from a client-mode view is ignored, not applied on top.
    { label = "Blue",
      where = function(obj) return string.sub(obj.name, 1, 4) == "Blue" end },
  },
  source = function(ctx)
    local objs = pick(ctx)
    -- A phrase this source cannot handle: it must not cost the user the rows
    -- already on screen.
    if string.sub(ctx.phrase, 1, 4) == "boom" then error("kaboom") end
    if ctx.phrase == "" then return objs end
    local matches = {}
    for _, obj in ipairs(objs) do
      if string.find(string.lower(obj.name), string.lower(ctx.phrase), 1, true) then
        matches[#matches + 1] = obj
      end
    end
    local ranked = search.rank(matches, ctx.phrase, { fields = { name = 1.0 } })
    -- Deliberately handed back worst-first: the panel must show the source's
    -- order, not one of its own.
    local out = {}
    for i = #ranked, 1, -1 do out[#out + 1] = ranked[i] end
    return out
  end,
}

-- The same data, ranked by the panel: the control for the ordering assertion.
navigator.define {
  name = "clientsearch",
  title = "Client Search",
  command = "Navigator: Client Search",
  dock = "modal",
  presentation = { mode = "list" },
  source = function()
    local out = {}
    for _, name in ipairs(NAMES) do out[#out + 1] = { name = name, ref = name } end
    return out
  end,
}
\`\`\`
`;

test.describe("source mode", () => {
  test.use({
    spaceFiles: { "index.md": "Welcome", "navtest.md": SOURCE_CONFIG },
  });

  test("the source answers each phrase, and its order is authoritative", async ({
    sbPage,
  }) => {
    // The control: the same data, ranked by the panel itself.
    const client = await openNavigatorView(sbPage, "Navigator: Client Search");
    await expect(
      client.locator(".sb-nav-row", { hasText: "Anchor" }),
    ).toBeVisible();
    await navInput(sbPage).fill("blue");
    await expect(client.locator(".sb-nav-row")).toHaveCount(2);
    const clientOrder = await client.locator(".sb-nav-primary").allInnerTexts();
    // First Escape clears the phrase, second closes the panel.
    await navInput(sbPage).press("Escape");
    await expect(navInput(sbPage)).toHaveValue("");
    await navInput(sbPage).press("Escape");
    await expect(
      sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
    ).toHaveCount(0);
    // The panel hands focus back on its way out; take it explicitly so the
    // palette hotkey below can't race that round trip.
    await sbPage.locator("#sb-editor .cm-content").click();

    const frame = await openNavigatorView(sbPage, "Navigator: Source Search");
    // No phrase: the source's plain listing.
    await expect(frame.locator(".sb-nav-row")).toHaveCount(5);

    // The phrase is the source's input now: it answers with the subset it
    // found and ranked itself.
    await navInput(sbPage).fill("blue");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(2);
    // ...and the panel shows that answer in the order it arrived. The source
    // hands back what search.rank produced, reversed; had the panel re-ranked,
    // this would equal clientOrder instead.
    expect(await frame.locator(".sb-nav-primary").allInnerTexts()).toEqual(
      [...clientOrder].reverse(),
    );

    await navInput(sbPage).fill("cobalt");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(1);
    await expect(frame.locator(".sb-nav-primary")).toHaveText("Cobalt");
  });

  // "counts are suppressed in source mode, even when asked for" is gone:
  // segment counts (`presentation.filterCounts`) were removed before release.

  test("the active segment reaches the source as a label", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Source Search");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(5);

    await frame.locator(".sb-segment[aria-label='Blue']").click();
    await expect(frame.locator(".sb-nav-row")).toHaveCount(2);
    expect(await frame.locator(".sb-nav-primary").allInnerTexts()).toEqual([
      "Bluebird",
      "Blueprint",
    ]);
    await expectFilterInputFocused(sbPage, ".sb-modal iframe");
  });

  test("a response overtaken by a newer one is dropped", async ({ sbPage }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Source Search");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(5);

    // Stall the source for one specific phrase, at the panel's own syscall
    // bridge -- so the request is issued (and tokened) first, and only its
    // response is late.
    await sbPage.evaluate(() => {
      const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
      const w = f.contentWindow as any;
      const orig = w.syscall;
      w.syscall = async (name: string, ...args: any[]) => {
        const result = await orig(name, ...args);
        if (
          name === "event.dispatch" &&
          args[0] === "navigator:rows" &&
          args[1]?.ctx?.phrase === "blue"
        ) {
          await new Promise((r) => setTimeout(r, 3000));
        }
        return result;
      };
    });

    await navInput(sbPage).fill("blue");
    // Outstanding long enough to say so.
    await expect(frame.locator(".sb-nav-spinner")).toBeVisible();

    await navInput(sbPage).fill("cobalt");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(1);
    await expect(frame.locator(".sb-nav-primary")).toHaveText("Cobalt");
    await expect(frame.locator(".sb-nav-spinner")).toBeHidden();

    // The stalled response lands about here: it must not replace what the
    // newer phrase produced.
    await sbPage.waitForTimeout(3500);
    await expect(frame.locator(".sb-nav-row")).toHaveCount(1);
    await expect(frame.locator(".sb-nav-primary")).toHaveText("Cobalt");
    await expect(navInput(sbPage)).toHaveValue("cobalt");
  });

  test("a source that throws keeps the rows already on screen", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Source Search");
    await navInput(sbPage).fill("blue");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(2);

    // The source cannot answer this phrase at all.
    await navInput(sbPage).fill("boom");
    await expect(frame.locator(".sb-nav-error-inline")).toContainText("kaboom");
    // ...and the rows the user was reading are still there, not an empty panel.
    await expect(frame.locator(".sb-nav-row")).toHaveCount(2);
    expect(await frame.locator(".sb-nav-primary").allInnerTexts()).toEqual(
      expect.arrayContaining(["Bluebird", "Blueprint"]),
    );

    // A phrase it can answer clears the banner. (Count first: a text
    // assertion over the two rows still on screen is a strict-mode error,
    // which does not retry.)
    await navInput(sbPage).fill("cobalt");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(1);
    await expect(frame.locator(".sb-nav-primary")).toHaveText("Cobalt");
    await expect(frame.locator(".sb-nav-error-inline")).toHaveCount(0);
  });
});

const BULK_CONFIG = `# Nav bulk test
\`\`\`space-lua
local function bulk()
  local out = {}
  for i = 1, 5000 do
    local n = string.format("Bulk/Item %04d", i)
    out[#out + 1] = { name = n, ref = n, even = i % 2 == 0 }
  end
  return out
end

-- Everything that costs something per row, at once: icons, an action gated by
-- when(), and a filter segment gated by where().
navigator.define {
  name = "bulklist",
  title = "Bulk List",
  command = "Navigator: Bulk List",
  dock = "modal",
  presentation = { mode = "list", row = { icon = "file-text" } },
  segments = {
    { label = "All", icon = "layers", default = true },
    { label = "Even", icon = "hash", where = function(obj) return obj.even end },
  },
  actions = {
    { icon = "edit-3", label = "Rename", run = function() end },
    { icon = "star", label = "Star", when = function(obj) return obj.even end,
      run = function() end },
  },
  source = bulk,
}

-- Ten well-separated names: "matches exactly one" has to survive the ranker's
-- typo tolerance, which numbered siblings (Item01/Item02/...) do not.
-- A deep, wide tree: a phrase that matches everything auto-expands the lot,
-- which is the shape a hover transition is most expensive over.
navigator.define {
  name = "bulktree",
  title = "Bulk Tree",
  command = "Navigator: Bulk Tree",
  dock = "modal",
  presentation = { mode = "tree", limit = 5000, row = { icon = "file-text" } },
  actions = {
    { icon = "edit-3", label = "Rename", run = function() end },
    { icon = "star", label = "Star", when = function(obj) return obj.even end,
      run = function() end },
  },
  source = function()
    local out = {}
    for i = 1, 2000 do
      local n = string.format("Folder%02d/Item %04d", i % 40, i)
      out[#out + 1] = { name = n, ref = n, even = i % 2 == 0 }
    end
    return out
  end,
}

-- The load path rather than the keystroke path: every refresh re-runs the
-- source, re-batches when()/where()/icon over all 5000 objects, and re-renders.
-- Row 1's name carries the invocation count, so a test can see a refresh land
-- in the DOM rather than guess at when it did.
navigator._refreshCalls = 0
navigator.define {
  name = "bulkrefresh",
  title = "Bulk Refresh",
  command = "Navigator: Bulk Refresh",
  dock = "modal",
  presentation = { mode = "list", row = { icon = function(obj)
    if obj.even then return "check" else return "circle" end
  end } },
  segments = {
    { label = "All", icon = "layers", default = true },
    { label = "Even", icon = "hash", where = function(obj) return obj.even end },
  },
  actions = {
    { icon = "edit-3", label = "Rename", run = function() end },
    { icon = "star", label = "Star", when = function(obj) return obj.even end,
      run = function() end },
  },
  source = function()
    navigator._refreshCalls = navigator._refreshCalls + 1
    local out = { { name = "Marker " .. navigator._refreshCalls, ref = "marker" } }
    for i = 1, 4999 do
      local n = string.format("Bulk/Item %04d", i)
      out[#out + 1] = { name = n, ref = n, even = i % 2 == 0 }
    end
    return out
  end,
}

navigator.define {
  name = "smalllimit",
  title = "Small Limit",
  command = "Navigator: Small Limit",
  dock = "modal",
  presentation = { mode = "list", limit = 3 },
  source = function()
    local out = {}
    for _, n in ipairs({ "Alpha", "Bravo", "Charlie", "Delta", "Echo",
                         "Foxtrot", "Golf", "Hotel", "India", "Juliet" }) do
      out[#out + 1] = { name = n, ref = n }
    end
    return out
  end,
}
\`\`\`
`;

test.describe("render cap", () => {
  test.use({
    spaceFiles: { "index.md": "Welcome", "navtest.md": BULK_CONFIG },
  });

  /**
   * How long a keystroke takes to reach the screen, measured inside the panel:
   * the input event, then the two frames a preact re-render settles in.
   */
  function typeAndSettle(frame: FrameLocator, phrase: string): Promise<number> {
    return frame
      .locator("input.sb-nav-input")
      .evaluate(async (input: HTMLInputElement, text: string) => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        const started = performance.now();
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return performance.now() - started;
      }, phrase);
  }

  test("presentation.limit caps the rendered rows, footer and all", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Small Limit");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Alpha" }),
    ).toBeVisible();

    // Three of ten, plus the footer -- which is not one of the rows the
    // selection can reach.
    await expect(frame.locator(".sb-nav-list .sb-nav-row")).toHaveCount(3);
    await expect(frame.locator(".sb-nav-more")).toHaveText(
      "7 more matches — keep typing",
    );

    // End lands on the last *rendered* row, not on the 10th match.
    await navInput(sbPage).press("End");
    await expect(frame.locator(".sb-nav-row.sb-nav-selected")).toHaveText(
      /Charlie/,
    );

    // Narrow it down and the footer goes away.
    await navInput(sbPage).fill("Foxtrot");
    await expect(frame.locator(".sb-nav-list .sb-nav-row")).toHaveCount(1);
    await expect(frame.locator(".sb-nav-more")).toHaveCount(0);
  });

  test("@slow 5000 rows: a keystroke stays inside the budget", async ({
    sbPage,
  }) => {
    test.setTimeout(180_000);
    const frame = await openNavigatorView(sbPage, "Navigator: Bulk List");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Item 0001" }),
    ).toBeVisible();

    // The default cap, not 5000 rows of markup.
    await expect(frame.locator(".sb-nav-list .sb-nav-row")).toHaveCount(200);
    await expect(frame.locator(".sb-nav-more")).toContainText("4800 more");
    // Actions are mounted for the selected row alone until something is
    // hovered -- 5000 rows' worth of buttons is exactly what this avoids.
    await expect(frame.locator(".sb-row-action")).toHaveCount(1);

    // Warm the ranker's index, then measure a few keystrokes of narrowing.
    await typeAndSettle(frame, "i");
    const samples: number[] = [];
    for (const phrase of ["it", "ite", "item", "item 1", "item 12"]) {
      samples.push(await typeAndSettle(frame, phrase));
    }
    const worst = Math.max(...samples);
    console.log(
      `navigator 5k keystroke settle: ${samples
        .map((s) => Math.round(s))
        .join("ms, ")}ms (worst ${Math.round(worst)}ms)`,
    );

    // Generously above what the mitigations measure at (see the round's
    // report): this is a guard against an order-of-magnitude regression, not a
    // millisecond-accurate budget.
    const budget = process.env.CI ? 2400 : 800;
    expect(worst).toBeLessThan(budget);

    // Switching segments is masks-only: no source re-run and no rowState
    // batch, just the one datastore write that persists the choice.
    const switched = await frame
      .locator(".sb-segment[aria-label='Even']")
      .evaluate(async (button: HTMLElement) => {
        const started = performance.now();
        button.click();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return performance.now() - started;
      });
    console.log(`navigator 5k segment switch: ${Math.round(switched)}ms`);
    expect(switched).toBeLessThan(budget);

    // The ranker on its own, so the attribution in the report is measured
    // rather than inferred: this is the bulk of a keystroke's cost.
    // The same keystroke measured as work rather than as frames: microtasks
    // (preact flushes its render queue in one) plus a forced layout read. The
    // settle figure above includes up to two frames of cadence -- ~33ms of
    // waiting that happens whether or not the panel did anything.
    const work = await frame
      .locator("input.sb-nav-input")
      .evaluate(async (input: HTMLInputElement) => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        const started = performance.now();
        setter.call(input, "item 123");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        for (let i = 0; i < 5; i++) await Promise.resolve();
        void input.ownerDocument.body.offsetHeight;
        return performance.now() - started;
      });
    console.log(`navigator 5k keystroke work: ${Math.round(work)}ms`);
    expect(work).toBeLessThan(budget);

    const ranking = await frame
      .locator("input.sb-nav-input")
      .evaluate((input: HTMLInputElement) => {
        const engine = (input.ownerDocument.defaultView as any)
          .__navigatorEngine;
        const state = engine.activeState();
        const started = performance.now();
        engine.rankRows(state.rows, "item 12", state.meta);
        return performance.now() - started;
      });
    console.log(`navigator 5k rank() alone: ${Math.round(ranking)}ms`);
  });

  test("@slow 5000 rows: a refresh stays inside the budget", async ({
    sbPage,
  }) => {
    test.setTimeout(180_000);
    const frame = await openNavigatorView(sbPage, "Navigator: Bulk Refresh");
    const marker = frame.locator(".sb-nav-list .sb-nav-row").first();
    await expect(marker).toContainText("Marker ");

    /**
     * One end-to-end refresh: the source re-runs, every `when`/`where`/`icon`
     * is re-batched over all 5000 objects, and the capped list re-renders.
     * Measured from the DOM, since that is where the user sees it land -- less
     * the debounce the trigger deliberately waits out first.
     */
    const REFRESH_DEBOUNCE_MS = 300;
    async function refreshAndSettle(): Promise<number> {
      const before = await marker.innerText();
      const started = Date.now();
      await frame
        .locator("input.sb-nav-input")
        .evaluate(() => (globalThis as any).__navigatorHooks.refresh());
      await expect(marker).not.toHaveText(before);
      return Date.now() - started - REFRESH_DEBOUNCE_MS;
    }

    // Warm (first refresh also resolves the two icons), then measure three.
    await refreshAndSettle();
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) samples.push(await refreshAndSettle());
    const worst = Math.max(...samples);
    console.log(
      `navigator 5k refresh (source + rowState + render): ${samples
        .map((s) => Math.round(s))
        .join("ms, ")}ms (worst ${Math.round(worst)}ms)`,
    );

    // The source's own half, for attribution: the query, the row build, and
    // the batched predicate/icon pass, without the render.
    const engineOnly = await frame
      .locator("input.sb-nav-input")
      .evaluate(async () => {
        const engine = (globalThis as any).__navigatorEngine;
        const started = performance.now();
        await engine.refresh();
        return performance.now() - started;
      });
    console.log(
      `navigator 5k refresh, engine only: ${Math.round(engineOnly)}ms`,
    );

    // The refresh path is explicitly allowed to be slow -- it happens off the
    // interaction path -- so this is a guard against an order-of-magnitude
    // regression (a comparator-driven sort creeping back in, a per-row round
    // trip), not a millisecond budget.
    expect(worst).toBeLessThan(process.env.CI ? 9000 : 3000);
  });

  test("@slow 2000-node tree: a hover transition stays inside the budget", async ({
    sbPage,
  }) => {
    test.setTimeout(180_000);
    const frame = await openNavigatorView(sbPage, "Navigator: Bulk Tree");
    await expect(frame.locator("[data-path='Folder01']")).toBeVisible();

    // A phrase every row matches: the filtered tree auto-expands all of them,
    // which is the widest the hover path ever has to work over.
    await navInput(sbPage).fill("item");
    await expect(frame.locator(".sb-tree [data-path]")).toHaveCount(2040);

    const move = (from: number, to: number) =>
      frame.locator(".sb-tree").evaluate(
        async (ul: HTMLElement, [a, b]: number[]) => {
          const rows = [...ul.querySelectorAll("[data-path]")] as HTMLElement[];
          const over = (el: HTMLElement) => {
            const box = el.getBoundingClientRect();
            el.dispatchEvent(
              new PointerEvent("pointerover", {
                bubbles: true,
                clientX: box.x + 5,
                clientY: box.y + 5,
              }),
            );
          };
          // Microtasks plus a forced layout read, not animation frames: two
          // rAFs are ~33ms of frame cadence on their own, which would swamp
          // the very work this is measuring.
          const settle = async () => {
            for (let i = 0; i < 5; i++) await Promise.resolve();
            void ul.offsetHeight;
          };
          over(rows[a]);
          await settle();
          const started = performance.now();
          over(rows[b]);
          await settle();
          return performance.now() - started;
        },
        [from, to],
      );

    // Warm, then five row-to-row transitions.
    await move(3, 4);
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) samples.push(await move(10 + i, 11 + i));
    const worst = Math.max(...samples);
    console.log(
      `navigator 2k-node tree hover transition: ${samples
        .map((s) => Math.round(s))
        .join("ms, ")}ms (worst ${Math.round(worst)}ms)`,
    );
    expect(worst).toBeLessThan(process.env.CI ? 600 : 200);

    // The transition did what it is for: exactly one hovered row carries
    // buttons, alongside the selected one.
    await expect(frame.locator(".sb-tree .sb-row-action")).toHaveCount(2);
  });

  test("keyboard scrolling re-answers what the parked pointer is over", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Bulk List");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Item 0001" }),
    ).toBeVisible();

    const rows = frame.locator(".sb-nav-list .sb-nav-row");
    // An even-numbered item, so `when` keeps both of its actions.
    await rows.nth(5).hover();
    const parked = await rows.nth(5).innerText();
    await expect(rows.nth(5).locator(".sb-row-action")).toHaveCount(2);

    // The pointer does not move; the rows do.
    await navInput(sbPage).press("PageDown");
    await navInput(sbPage).press("PageDown");
    await navInput(sbPage).press("PageDown");

    // Whatever is under the pointer now is what carries the buttons -- and it
    // is not the row that was there before.
    const hovered = frame.locator(
      ".sb-nav-list .sb-nav-row:has(.sb-row-action):not(.sb-nav-selected)",
    );
    await expect(hovered).toHaveCount(1);
    expect(await hovered.innerText()).not.toBe(parked);
  });

  test("actions are mounted for the selected and hovered rows only", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Bulk List");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Item 0001" }),
    ).toBeVisible();

    const rows = frame.locator(".sb-nav-list .sb-nav-row");
    // The selected row (the first, an odd-numbered item, so `when` keeps one
    // of its two actions) carries them with no pointer near it.
    await expect(rows.nth(0).locator(".sb-row-action")).toHaveCount(1);
    await expect(rows.nth(3).locator(".sb-row-action")).toHaveCount(0);

    // An even-numbered item: both actions.
    await rows.nth(3).hover();
    await expect(rows.nth(3).locator(".sb-row-action")).toHaveCount(2);
    await expect(rows.nth(3).locator(".sb-row-action").first()).toBeVisible();
    // Still only those two rows' worth in the whole list.
    await expect(frame.locator(".sb-row-action")).toHaveCount(3);

    // Leaving the list takes them back down.
    await frame.locator("input.sb-nav-input").hover();
    await expect(rows.nth(3).locator(".sb-row-action")).toHaveCount(0);
  });
});

// A space whose shape exercises every default the built-in views ship with: a
// pure folder (Diagrams), a page that is also a folder (Projects), documents
// of two kinds, and a meta page for the Meta segment.
// A plain modal view of the space, defined here rather than reached for
// among the shipped ones: the built-in pickers live in the plug now, so a
// Lua-registered `Navigator: ...` command is the thing these tests can drive
// without asserting anything about which registry answers.
const MODAL_VIEW = `# Modal view
\`\`\`space-lua
navigator.define {
  name = "test.pagesModal",
  title = "Pages Modal",
  command = "Navigator: Pages Modal",
  dock = "modal",
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}
\`\`\`
`;

const BUILTIN_FILES = {
  "index.md": "Welcome",
  "Projects.md": "# Projects",
  "Projects/Alpha.md": "# Alpha",
  "Projects/notes.txt": "plain text",
  "Diagrams/flow.png": "not really a png",
  "Templates/Thing.md": "---\ntags: meta\n---\n# Thing",
  "modalview.md": MODAL_VIEW,
};

/** The visible (non-hidden) sidebar panel's iframe, whichever side it is on. */
function sidebarFrame(sbPage: Page, side: "lhs" | "rhs" = "lhs") {
  return sbPage.frameLocator(`.sb-keyed-panel-${side} iframe`);
}

/**
 * Reboot the client, then wait until boot has reached the navigator's
 * `editor:init` handler -- which preloads the hidden modal panel and *then*
 * restores whatever docks were remembered. The modal panel appearing in the
 * DOM is the signal that the restore either happened or decided not to, which
 * is what "it did not restore" has to be asserted behind.
 *
 * A plain `page.reload()` will not do: navigating inside the app rewrites the
 * URL without the `?headless=1` the fixture booted with, so a reload lands on
 * a client with no runtime hooks and no readiness signal.
 */
async function reboot(sbPage: Page, sbServer: SBServer, pagePath = "") {
  await gotoSilverBulletPage(sbPage, sbServer, pagePath);
  await expect(
    sbPage.locator(".sb-modal-backdrop .sb-keyed-panel"),
  ).toHaveCount(1);
}

/**
 * A barrier for asserting that a dock did *not* come back: run a navigator
 * command and wait for its panel. The plug can only serve that after the
 * `editor:init` handler that would have restored the dock has run to
 * completion -- which is a positive signal, unlike waiting a fixed while and
 * hoping.
 */
async function waitPastRestore(sbPage: Page) {
  const modal = await openNavigatorView(sbPage, "Navigator: Pages Modal");
  await expect(modal.locator(".sb-nav-row").first()).toBeVisible();
}

test.describe("built-in views", () => {
  test.use({ spaceFiles: BUILTIN_FILES });

  async function openSpaceTree(sbPage: Page) {
    await runCommand(sbPage, "Navigator: Tree");
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await expect(frame.locator("[data-path='Diagrams']")).toBeVisible();
    return frame;
  }

  test("the space tree lists pages and documents in one hierarchy", async ({
    sbPage,
  }) => {
    const frame = await openSpaceTree(sbPage);

    await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await frame.locator("[data-path='Diagrams'] .sb-nav-chevron").click();

    // The display rule, pinned: a page shows without its ".md", a document
    // shows with the extension its name actually carries. Neither is stripped
    // or appended by the view -- that is how the index names them.
    await expect(
      frame.locator("[data-path='Projects/Alpha'] .sb-nav-primary"),
    ).toHaveText("Alpha");
    await expect(
      frame.locator("[data-path='Projects/notes.txt'] .sb-nav-primary"),
    ).toHaveText("notes.txt");
    await expect(
      frame.locator("[data-path='Diagrams/flow.png'] .sb-nav-primary"),
    ).toHaveText("flow.png");
  });

  test("default row icons distinguish folders, pages, documents and images", async ({
    sbPage,
  }) => {
    const frame = await openSpaceTree(sbPage);
    await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await frame.locator("[data-path='Diagrams'] .sb-nav-chevron").click();

    const iconOf = async (path: string) =>
      await frame.locator(`[data-path='${path}'] .sb-nav-icon svg`).innerHTML();

    const folder = await iconOf("Diagrams");
    const page = await iconOf("Projects/Alpha");
    const document = await iconOf("Projects/notes.txt");
    const image = await iconOf("Diagrams/flow.png");

    // Four distinct feather icons: folder / file-text / file / image.
    expect(new Set([folder, page, document, image]).size).toBe(4);
    // A page that is also a folder is drawn as the folder it heads.
    expect(await iconOf("Projects")).toBe(folder);
  });

  test("a page/folder dual is navigable, a pure folder is not", async ({
    sbPage,
  }) => {
    const frame = await openSpaceTree(sbPage);

    // A dual carries a class of its own, as a styling hook -- but nothing is
    // drawn from it: a dual looks exactly like any other folder heading, and
    // the difference is what its label *does*.
    await expect(frame.locator("[data-path='Projects']")).toHaveClass(
      /sb-nav-dual/,
    );
    await expect(frame.locator("[data-path='Diagrams']")).not.toHaveClass(
      /sb-nav-dual/,
    );

    // Which is the whole of it: the dual's label opens its page, where the
    // pure folder's only expands.
    await frame.locator("[data-path='Diagrams'] .sb-nav-primary").click();
    await expect(
      frame.locator("[data-path='Diagrams/flow.png']"),
    ).toBeVisible();
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "index",
    );

    await frame.locator("[data-path='Projects'] .sb-nav-primary").click();
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Projects",
    );
  });

  test("selecting a document opens it", async ({ sbPage }) => {
    const frame = await openSpaceTree(sbPage);
    await frame.locator("[data-path='Diagrams'] .sb-nav-chevron").click();
    await frame.locator("[data-path='Diagrams/flow.png']").click();

    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Diagrams/flow.png",
    );
  });

  // Polish round item 6: reopening a *closed* dock is a fresh activation,
  // which (unlike a merely-hidden one, see "sidebar: follow-editor reveal
  // survives being hidden, then reopened" above) re-fetches the persisted
  // expansion snapshot -- a sibling async round trip to the reveal's own
  // ancestor-expansion, with no fixed order between them. Manually expanding
  // an unrelated folder first gives that snapshot real content (an empty one
  // happens to not reproduce the race), so this is a real regression guard,
  // not a coincidence of a pristine space.
  test("space tree: reopening a closed dock reveals the current page even with an unrelated folder remembered as expanded", async ({
    sbPage,
  }) => {
    const frame = await openSpaceTree(sbPage);
    await frame.locator("[data-path='Diagrams'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Diagrams/flow.png']")).toBeVisible();

    await closeSidebar(sbPage, ".sb-keyed-panel-lhs");
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeHidden();

    await navigateViaPagePicker(sbPage, "Projects/Alpha");

    await runCommand(sbPage, "Navigator: Tree");
    const reopened = sidebarFrame(sbPage);
    await expect(
      reopened.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
    ).toBeVisible();
    // The remembered folder survives too: the fix merges the reveal's
    // ancestors into the persisted snapshot rather than picking one over the
    // other.
    await expect(
      reopened.locator("[data-path='Diagrams/flow.png']"),
    ).toBeVisible();
  });

  // Polish round item 7 (Addendum 4): the real Cmd-o binding, all three
  // transitions -- closed -> open+focus and visible-but-unfocused -> refocus
  // are the pre-existing behavior; focused -> hide is new (see `show`'s
  // toggle branch in navigator.ts).
  test("Cmd-o toggles the tree dock: closed -> open+focus, unfocused -> refocus, focused -> hide", async ({
    sbPage,
  }) => {
    await sbPage.keyboard.press(`${mod}+o`);
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await expectNavInputFocused(sbPage, ".sb-keyed-panel-lhs iframe");

    // Steal focus back to the editor without closing the dock, then press
    // Cmd-o again on the now-unfocused-but-visible dock.
    await sbPage.locator("#sb-editor .cm-content").click();
    await sbPage.keyboard.press(`${mod}+o`);
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeVisible();
    await expectNavInputFocused(sbPage, ".sb-keyed-panel-lhs iframe");

    // Focused: the same key now hides it.
    await sbPage.keyboard.press(`${mod}+o`);
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeHidden();
  });

  // Polish round review, I2: `editor.getFocusedPanelSlot` used to detect a
  // slot from an ancestor class only the sidebar wrapper carries
  // (`sb-keyed-panel-lhs`/`-rhs`) -- the modal wrapper renders plain
  // `sb-keyed-panel`, so a focused modal picker always answered `undefined`,
  // contradicting the syscall's own four-slot contract. Fixed via a
  // `data-slot` attribute the iframe itself carries, on every render path.
  test("editor.getFocusedPanelSlot reports the modal, not just lhs/rhs sidebars", async ({
    sbPage,
  }) => {
    const getFocusedSlot = () =>
      sbPage.evaluate(() =>
        (globalThis as any).client.clientSystem.localSyscall(
          "editor.getFocusedPanelSlot",
          [],
        ),
      );

    expect(await getFocusedSlot()).toBeUndefined();

    await sbPage.keyboard.press(`${mod}+o`);
    await expectNavInputFocused(sbPage, ".sb-keyed-panel-lhs iframe");
    expect(await getFocusedSlot()).toBe("lhs");

    await sbPage.locator("#sb-editor .cm-content").click();
    await runCommand(sbPage, "Navigator: Pages Modal");
    await expectNavInputFocused(sbPage, ".sb-modal iframe");
    expect(await getFocusedSlot()).toBe("modal");
  });

  test("the segments subset the space", async ({ sbPage }) => {
    const frame = await openSpaceTree(sbPage);
    const segments = frame.locator(".sb-segment");
    await expect(segments).toHaveCount(4);

    // Folder rows are a header by weight and tint, not by case: their names
    // are the folder's own, verbatim.
    const folder = frame.locator("[data-path='Projects'] .sb-nav-primary");
    await expect(folder).toHaveText("Projects");
    expect(
      await folder.evaluate((el) => [
        getComputedStyle(el).textTransform,
        getComputedStyle(el.parentElement!).textTransform,
      ]),
    ).toEqual(["none", "none"]);

    await frame.locator(".sb-segment[aria-label='Docs']").click();
    // Subsetting rebuilds the tree from the rows that survived, so the folders
    // those documents live in come back on their own -- but a segment is not a
    // phrase, so nothing is auto-expanded.
    await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await expect(
      frame.locator("[data-path='Projects/notes.txt']"),
    ).toBeVisible();
    // The pages under that same folder are gone.
    await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

    await frame.locator(".sb-segment[aria-label='Meta']").click();
    await frame.locator("[data-path='Templates'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Templates/Thing']")).toBeVisible();
    await expect(frame.locator("[data-path='Projects']")).toHaveCount(0);

    // The default segment leaves everything in -- and expansion is the view's,
    // not the segment's, so Projects is still open from above.
    await frame.locator(".sb-segment[aria-label='All']").click();
    await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
    await expect(
      frame.locator("[data-path='Projects/notes.txt']"),
    ).toBeVisible();
  });

  test("Space peeks at a row without giving up the panel's focus", async ({
    sbPage,
  }) => {
    const frame = await openSpaceTree(sbPage);
    const input = frame.locator("input.sb-nav-input");

    // Prune to one page, so which row the arrow lands on is not a question of
    // how many library pages the space happens to hold.
    await expect(async () => {
      await input.fill("Projects/Alpha");
      await expect(input).toHaveValue("Projects/Alpha", { timeout: 1000 });
    }).toPass();
    // Arrow first: a printable key only acts once the selection has been
    // moved deliberately (see the typing-vs-navigating contract) -- and the
    // top row of the pruned tree is the folder, not the page.
    await input.press("ArrowDown");
    await expect(frame.locator(".sb-nav-selected")).toHaveAttribute(
      "data-path",
      "Projects/Alpha",
    );

    await input.press(" ");
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Projects/Alpha",
    );
    // Peeking, not leaving: the phrase and the focus are both still here.
    await expect(input).toHaveValue("Projects/Alpha");
    await expectFilterInputFocused(sbPage, ".sb-keyed-panel-lhs iframe");
  });

  test("row actions rename a page and delete a document", async ({
    sbPage,
    sbServer,
  }) => {
    const frame = await openSpaceTree(sbPage);
    await frame.locator("[data-path='Diagrams'] .sb-nav-chevron").click();
    const doc = frame.locator("[data-path='Diagrams/flow.png']");
    await expect(doc).toBeVisible();

    // Pure folders offer "New page here" and "Rename", never "Delete": a
    // subtree deletion is not a hover button.
    await frame.locator("[data-path='Diagrams']").hover();
    const folderActions = frame.locator(
      "[data-path='Diagrams'] .sb-row-action",
    );
    await expect(folderActions).toHaveCount(2);
    await expect(
      frame.locator(
        "[data-path='Diagrams'] .sb-row-action[aria-label='Delete']",
      ),
    ).toHaveCount(0);

    await doc.hover();
    await doc.locator(".sb-row-action[aria-label='Delete']").click();
    const prompt = sbPage.locator(".sb-prompt");
    await expect(prompt).toContainText("Delete Diagrams/flow.png?");
    await prompt.locator("button", { hasText: "Ok" }).click();

    await expect(frame.locator("[data-path='Diagrams/flow.png']")).toHaveCount(
      0,
      { timeout: 20_000 },
    );
    const gone = await fetch(`${sbServer.url}/.fs/Diagrams/flow.png`);
    expect(gone.ok).toBe(false);
  });

  // onMove, through the TS builtin's own dispatch (`navigator:move` ->
  // `moveByRename` in builtins.ts) -- the generic drag mechanism is already
  // covered against a synthetic Lua fixture in the "dnd" suite below; this is
  // the one drop that has to prove the real `std.spaceTree` wiring, document
  // rename included.
  test("dragging a document onto a folder renames it through the built-in's own onMove", async ({
    sbPage,
    sbServer,
  }) => {
    const frame = await openSpaceTree(sbPage);
    await frame.locator("[data-path='Diagrams'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Diagrams/flow.png']")).toBeVisible();

    await frame
      .locator("[data-path='Diagrams/flow.png']")
      .dragTo(frame.locator("[data-path='Projects']"));

    await expect(frame.locator("[data-path='Projects/flow.png']")).toBeVisible(
      { timeout: 20_000 },
    );
    const moved = await fetch(`${sbServer.url}/.fs/Projects/flow.png`);
    expect(moved.ok).toBe(true);
    const gone = await fetch(`${sbServer.url}/.fs/Diagrams/flow.png`);
    expect(gone.ok).toBe(false);
  });
});

test.describe("boot restore", () => {
  test.use({ spaceFiles: BUILTIN_FILES });

  test("a docked view comes back on the next boot, passively", async ({
    sbPage,
    sbServer,
  }) => {
    await runCommand(sbPage, "Navigator: Tree");
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    // Give the "which view is docked here" write its round trip.
    await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();

    await reboot(sbPage, sbServer);

    const restored = sidebarFrame(sbPage);
    await expect(restored.locator("[data-path='Projects']")).toBeVisible();
    // No focus steal: the editor holds focus, as it does on any other boot.
    // (The panel's own boot focus is skipped for a passive restore -- see
    // ui/index.tsx.)
    expect(
      await sbPage.evaluate(
        () => document.activeElement?.tagName.toLowerCase() ?? "",
      ),
    ).not.toBe("iframe");
  });

  // Polish round item 6, the boot-restore half: unlike the command/Cmd-o
  // active-open path fixed above, a passive restore deliberately does not
  // reveal (activation.ts: "a boot restore isn't an ask") -- pinned here so
  // that stays a decision, not a drift.
  test("a docked view's selection is not auto-revealed on a passive boot restore, by design", async ({
    sbPage,
    sbServer,
  }) => {
    await runCommand(sbPage, "Navigator: Tree");
    const frame = sidebarFrame(sbPage);
    await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await frame.locator("[data-path='Projects/Alpha'] .sb-nav-primary").click();
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Projects/Alpha",
    );
    await expect(
      frame.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
    ).toBeVisible();

    await reboot(sbPage, sbServer, "Projects/Alpha");

    const restored = sidebarFrame(sbPage);
    await expect(restored.locator("[data-path='Projects']")).toBeVisible();
    await expect(
      restored.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
    ).toHaveCount(0);
  });

  test("closing a dock un-remembers it", async ({ sbPage, sbServer }) => {
    await runCommand(sbPage, "Navigator: Tree");
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();

    await sbPage
      .frameLocator(".sb-keyed-panel-lhs iframe")
      .locator(".sb-nav-close")
      .click();
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeHidden();

    await reboot(sbPage, sbServer);
    await waitPastRestore(sbPage);

    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toHaveCount(0);
  });

  // Boot restore is name-keyed and content-agnostic -- std.toc, a TS builtin,
  // has nothing special to ask of it, and this is the proof.
  test("a docked outline (std.toc, a TS builtin) comes back on the next boot, passively", async ({
    sbPage,
    sbServer,
  }) => {
    await runCommand(sbPage, "Navigator: Table of Contents");
    const frame = sidebarFrame(sbPage, "rhs");
    await expect(frame.locator(".sb-nav-title")).toHaveText("Outline");

    await reboot(sbPage, sbServer);

    const restored = sidebarFrame(sbPage, "rhs");
    await expect(restored.locator(".sb-nav-title")).toHaveText("Outline");
  });
});

const STARTUP_CONFIG = `# Nav startup test
\`\`\`space-lua
navigator.define {
  name = "startupsidebar",
  title = "Startup Sidebar",
  command = "Navigator: Startup Sidebar",
  dock = "rhs",
  openOnStart = true,
  presentation = { mode = "list" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
}

navigator._openOnStartRejected = false
local ok = pcall(function()
  navigator.define {
    name = "startupmodal",
    dock = "modal",
    openOnStart = true,
    source = function() return {} end,
  }
end)
navigator._openOnStartRejected = not ok
\`\`\`
`;

test.describe("openOnStart", () => {
  test.use({
    spaceFiles: { "index.md": "Welcome", "navtest.md": STARTUP_CONFIG },
  });

  test("a declared view opens at boot, and a modal one is rejected", async ({
    sbPage,
    sbServer,
  }) => {
    // The first load is what indexes navtest.md, so the declaration only
    // exists from the boot after it.
    await reboot(sbPage, sbServer);

    const frame = sidebarFrame(sbPage, "rhs");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "index" }),
    ).toBeVisible();
    expect(
      await sbPage.evaluate(
        () => document.activeElement?.tagName.toLowerCase() ?? "",
      ),
    ).not.toBe("iframe");

    // openOnStart is only meaningful on a dock that can stay open.
    const rejected = await sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua("navigator._openOnStartRejected"),
    );
    expect(rejected).toBe(true);
  });
});

test.describe("mobile", () => {
  test.use({
    spaceFiles: BUILTIN_FILES,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("a sidebar dock is a full-width drawer below the top bar", async ({
    sbPage,
  }) => {
    await runCommand(sbPage, "Navigator: Tree");
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();

    const drawer = (await sbPage
      .locator("#sb-main .sb-keyed-panel-lhs")
      .boundingBox())!;
    const top = (await sbPage.locator("#sb-top").boundingBox())!;
    const viewport = sbPage.viewportSize()!;

    expect(drawer.width).toBe(viewport.width);
    // ...and so is the panel inside it, all the way down to the iframe. The
    // width a sidebar remembers belongs to the desktop column; a drawer that
    // kept it would leave the editor showing through beside the navigator.
    const panel = (await sbPage
      .locator("#sb-main .sb-keyed-panel-lhs .sb-panel")
      .boundingBox())!;
    const inner = (await sbPage
      .locator("#sb-main .sb-keyed-panel-lhs iframe")
      .boundingBox())!;
    expect(Math.round(panel.width)).toBe(viewport.width);
    expect(Math.round(inner.width)).toBe(viewport.width);
    // Full height below the top bar, which stays visible above it.
    expect(Math.round(drawer.y)).toBe(Math.round(top.y + top.height));
    expect(Math.round(drawer.y + drawer.height)).toBe(viewport.height);
    await expect(sbPage.locator("#sb-top")).toBeVisible();

    // Nothing to drag: the drawer is already as wide as the screen.
    await expect(frame.locator(".sb-resizer")).toHaveCount(0);
  });

  test("selecting closes the drawer and navigates", async ({ sbPage }) => {
    await runCommand(sbPage, "Navigator: Tree");
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();

    await frame.locator("[data-path='Projects'] .sb-nav-primary").click();

    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Projects",
    );
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeHidden();
  });

  test("a keyed modal keeps the narrow-screen inset", async ({ sbPage }) => {
    // Any modal view will do; this one is defined by this suite, so it does
    // not depend on which registry the built-in pickers live in.
    const frame = await openNavigatorView(sbPage, "Navigator: Pages Modal");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Projects" }).first(),
    ).toBeVisible();

    const modal = (await sbPage.locator(".sb-modal").boundingBox())!;
    const viewport = sbPage.viewportSize()!;
    // main.scss overrides the plug's own inset below 600px.
    expect(Math.round(modal.x)).toBe(8);
    expect(Math.round(modal.width)).toBe(viewport.width - 16);
  });

  test("drawers never restore on boot", async ({ sbPage, sbServer }) => {
    await runCommand(sbPage, "Navigator: Tree");
    await expect(
      sidebarFrame(sbPage).locator("[data-path='Projects']"),
    ).toBeVisible();

    await reboot(sbPage, sbServer);
    await waitPastRestore(sbPage);
    // A drawer covers the editor whole; restoring one would hide the page the
    // user just opened.
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toHaveCount(0);
  });
});

const PREFIX_CONFIG = `# Nav prefix test
\`\`\`space-lua
-- Synthetic, so what a prefix narrows to doesn't depend on what the
-- background indexer has delivered yet.
local function things()
  return {
    { name = "Alpha", ref = "Alpha", tags = { "work" } },
    { name = "Projects/Beta", ref = "Projects/Beta", tags = { "work", "meeting" } },
    { name = "Projects/Beta/Deep", ref = "Projects/Beta/Deep" },
    { name = "Settings", ref = "Settings", kind = "meta" },
  }
end

local function isMeta(obj) return obj.kind == "meta" end

navigator.define {
  name = "prefixhost",
  title = "Prefix Host",
  command = "Navigator: Prefix Host",
  dock = "modal",
  create = true,
  presentation = { mode = "list" },
  filter = {
    pathCompletion = true,
    hashtagFilter = true,
  },
  segments = {
    { label = "All", default = true },
    { label = "Meta", prefix = "^", where = isMeta },
  },
  prefixViews = { ["$"] = "prefixchild" },
  source = things,
}

-- No command of its own: the only way in is the host's "$" prefix, which is
-- exactly what makes this a routing assertion rather than an open assertion.
navigator.define {
  name = "prefixchild",
  title = "Prefix Child",
  dock = "modal",
  presentation = { mode = "list" },
  source = function()
    return {
      { name = "anchor-one", ref = "anchor-one" },
      { name = "anchor-two", ref = "anchor-two" },
    }
  end,
}

-- A sidebar host: the child docks "modal", so routing from here proves the
-- hop takes over the *invoking* slot rather than the target's own.
navigator.define {
  name = "prefixside",
  title = "Prefix Side",
  command = "Navigator: Prefix Side",
  dock = "lhs",
  presentation = { mode = "list" },
  prefixViews = { ["$"] = "prefixchild" },
  source = things,
}

-- Path completion next to a keymap that claims Space: the two must not fight.
navigator.define {
  name = "prefixspace",
  title = "Prefix Space",
  command = "Navigator: Prefix Space",
  dock = "modal",
  presentation = { mode = "list" },
  filter = { pathCompletion = true },
  keymap = {
    [" "] = function(obj) editor.navigate(obj.ref or obj.name) end,
  },
  source = things,
}

-- Definition-time validation: each of these must be rejected outright.
navigator._badPrefixes = {}
for _, case in ipairs({
  { what = "two chars", spec = { name = "pbad1", source = things,
      segments = { { label = "A", prefix = "^^" } } } },
  { what = "not a string", spec = { name = "pbad2", source = things,
      segments = { { label = "A", prefix = 42 } } } },
  { what = "whitespace", spec = { name = "pbad3", source = things,
      segments = { { label = "A", prefix = " " } } } },
  { what = "claimed twice", spec = { name = "pbad4", source = things,
      segments = { { label = "A", prefix = "^" } },
      prefixViews = { ["^"] = "prefixchild" } } },
  { what = "keymap collision", spec = { name = "pbad5", source = things,
      segments = { { label = "A", prefix = "r" } },
      keymap = { r = function() end } } },
  { what = "view not a name", spec = { name = "pbad6", source = things,
      prefixViews = { ["$"] = 7 } } },
  -- ...and a legitimate one, so the cases above aren't passing by accident.
  { what = "good", spec = { name = "pgood", source = things,
      segments = { { label = "A", prefix = "^" } },
      prefixViews = { ["$"] = "prefixchild" }, keymap = { r = function() end } } },
}) do
  local ok = pcall(navigator.define, case.spec)
  navigator._badPrefixes[#navigator._badPrefixes + 1] = case.what .. "=" .. tostring(ok)
end

navigator.define {
  name = "prefixvalidation",
  title = "Prefix Validation",
  command = "Navigator: Prefix Validation",
  dock = "modal",
  presentation = { mode = "list" },
  source = function()
    local out = {}
    for _, line in ipairs(navigator._badPrefixes) do
      out[#out + 1] = { name = line, ref = line }
    end
    return out
  end,
}
\`\`\`
`;

test.describe("prefixes and completion", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "navtest.md": PREFIX_CONFIG,
      "Projects/Alpha.md": "# Alpha",
    },
  });

  function segment(frame: FrameLocator, label: string) {
    return frame.locator(`.sb-segment[aria-label='${label}']`);
  }

  // The create row is a `.sb-nav-row` with a `.sb-nav-primary` of its own, so
  // an unqualified primary query counts it as a result.
  function rows(frame: FrameLocator) {
    return frame.locator(".sb-nav-row:not(.sb-nav-create) .sb-nav-primary");
  }

  async function openHost(sbPage: Page) {
    const frame = await openNavigatorView(sbPage, "Navigator: Prefix Host");
    await expect(segment(frame, "All")).toBeVisible();
    await expect(rows(frame)).toHaveCount(4);
    return frame;
  }

  test("a segment prefix activates its segment and never enters the phrase", async ({
    sbPage,
  }) => {
    const frame = await openHost(sbPage);
    const input = navInput(sbPage);

    await sbPage.keyboard.type("^");
    await expect(segment(frame, "Meta")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // The character is consumed, not filtered on -- a phrase of "^" would
    // match nothing at all.
    await expect(input).toHaveValue("");
    await expect(rows(frame)).toHaveText(["Settings"]);

    // Whatever is typed after it is an ordinary phrase within the segment.
    await sbPage.keyboard.type("set", { delay: 20 });
    await expect(input).toHaveValue("set");
    await expect(rows(frame)).toHaveText(["Settings"]);
  });

  test("Backspace on an empty phrase leaves a prefixed segment", async ({
    sbPage,
  }) => {
    const frame = await openHost(sbPage);
    const input = navInput(sbPage);

    await sbPage.keyboard.type("^se", { delay: 20 });
    await expect(segment(frame, "Meta")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(input).toHaveValue("se");

    // Deleting the phrase itself is ordinary editing...
    await input.press("Backspace");
    await input.press("Backspace");
    await expect(input).toHaveValue("");
    await expect(segment(frame, "Meta")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // ...and only the one past the start undoes the prefix.
    await input.press("Backspace");
    await expect(segment(frame, "All")).toHaveAttribute("aria-checked", "true");
    await expect(rows(frame)).toHaveCount(4);
  });

  test("a prefix character only routes as the first character", async ({
    sbPage,
  }) => {
    const frame = await openHost(sbPage);
    const input = navInput(sbPage);

    await sbPage.keyboard.type("a^b", { delay: 20 });
    await expect(input).toHaveValue("a^b");
    await expect(segment(frame, "All")).toHaveAttribute("aria-checked", "true");
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Host");
  });

  test("a prefix view swaps the view in-slot, carrying the phrase", async ({
    sbPage,
  }) => {
    const frame = await openHost(sbPage);
    const input = navInput(sbPage);

    // Pasted rather than typed, so the "carry the rest" half is exercised in
    // the one input event a paste produces.
    await input.fill("$two");
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Child");
    await expect(input).toHaveValue("two");
    await expect(rows(frame)).toHaveText(["anchor-two"]);
    // The child has no segments of its own; the host's segmented control goes
    // with the host.
    await expect(frame.locator(".sb-segment")).toHaveCount(0);
  });

  test("Backspace on an empty phrase steps back to the invoking view", async ({
    sbPage,
  }) => {
    const frame = await openHost(sbPage);
    const input = navInput(sbPage);

    await sbPage.keyboard.type("$");
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Child");
    await expect(rows(frame)).toHaveCount(2);

    await input.press("Backspace");
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Host");
    await expect(rows(frame)).toHaveCount(4);
    await expect(segment(frame, "All")).toBeVisible();
    await expectFilterInputFocused(sbPage, ".sb-modal iframe");
  });

  test("a hop takes over the invoking dock, not the target's own", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(
      sbPage,
      "Navigator: Prefix Side",
      ".sb-keyed-panel-lhs iframe",
    );
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Side");

    await frame.locator("input.sb-nav-input").press("$");
    // prefixchild docks "modal", but a hop is a swap in place.
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Child");
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeVisible();
    // The modal dock is preloaded (hidden) from boot, so what matters is that
    // the hop did not surface it.
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
  });

  test("Space on an empty phrase completes the current folder", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Projects/Alpha");
    const frame = await openHost(sbPage);
    const input = navInput(sbPage);

    await sbPage.keyboard.press(" ");
    await expect(input).toHaveValue("Projects/");
    await expect(rows(frame)).toHaveText([
      "Projects/Beta",
      "Projects/Beta/Deep",
    ]);

    // Only on an *empty* phrase: a space mid-phrase is a space.
    await sbPage.keyboard.type("Beta D", { delay: 20 });
    await expect(input).toHaveValue("Projects/Beta D");
  });

  test("Alt-Space walks the path one segment at a time", async ({ sbPage }) => {
    const frame = await openHost(sbPage);
    const input = navInput(sbPage);

    await sbPage.keyboard.type("proj", { delay: 20 });
    await expect(rows(frame).first()).toHaveText("Projects/Beta");

    await input.press("Alt+ ");
    await expect(input).toHaveValue("Projects");
    await input.press("Alt+ ");
    await expect(input).toHaveValue("Projects/Beta");
    // ...and keeps going. "Projects/Beta" is now its own best match, so the
    // top-ranked row has nothing left to offer; the walk moves on to the best
    // row that can actually extend the phrase rather than stalling there.
    await input.press("Alt+ ");
    await expect(input).toHaveValue("Projects/Beta/Deep");
    // Nothing deeper: the walk stops when no row extends the phrase.
    await input.press("Alt+ ");
    await expect(input).toHaveValue("Projects/Beta/Deep");
  });

  test("Space completes while typing and runs the keymap while navigating", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Projects/Alpha");
    const frame = await openNavigatorView(sbPage, "Navigator: Prefix Space");
    await expect(rows(frame)).toHaveCount(4);
    const input = navInput(sbPage);

    // Typing mode (a fresh open): Space is the completion's.
    await sbPage.keyboard.press(" ");
    await expect(input).toHaveValue("Projects/");

    // Back to an empty phrase, then into navigating mode: Space is the
    // keymap's, and the phrase is left alone.
    await input.press("Backspace");
    await input.fill("");
    await expect(input).toHaveValue("");
    await input.press("ArrowDown");
    await input.press(" ");
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Projects/Beta",
    );
    await expect(input).toHaveValue("");
  });

  test("Space still completes after arrowing in a view that claims no keys", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Projects/Alpha");
    await openHost(sbPage);
    const input = navInput(sbPage);

    // Navigating mode, which is only a yield-to-the-keymap condition -- and
    // this view claims nothing, so there is nothing to yield to.
    await input.press("ArrowDown");
    await input.press(" ");
    await expect(input).toHaveValue("Projects/");
  });

  test("a prefix hop keeps the panel running rather than rebooting it", async ({
    sbPage,
  }) => {
    const frame = await openHost(sbPage);
    const input = navInput(sbPage);

    // Two probes, because a reboot and a rebuild fail differently: the host
    // wipes `document.body` and re-evals the bundle on an html re-post (which
    // bumps the boot count but keeps `globalThis`), and replaces the iframe
    // outright on a key/content change (which resets both). The
    // `navigator:ready` pull would repopulate the panel either way, so
    // asserting on what is on screen proves nothing about continuity.
    const probe = () =>
      sbPage.evaluate(() => {
        const f = document.querySelector(
          ".sb-modal iframe",
        ) as HTMLIFrameElement;
        const w = f.contentWindow as any;
        return { boots: w.__navBootCount, sentinel: w.__navSentinel ?? null };
      });
    await sbPage.evaluate(() => {
      const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
      (f.contentWindow as any).__navSentinel = "alive";
    });
    // The baseline is captured, not asserted: opening a preloaded modal for
    // the first time legitimately re-posts its html once (the space-style
    // preamble is only known by then), so what matters is that the hop adds
    // nothing to it.
    const before = await probe();
    expect(before.sentinel).toBe("alive");
    expect(typeof before.boots).toBe("number");

    // A -> B ...
    await sbPage.keyboard.type("$");
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Child");
    expect(await probe()).toEqual(before);

    // ... and back again.
    await input.press("Backspace");
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Host");
    await expect(segment(frame, "All")).toBeVisible();
    expect(await probe()).toEqual(before);
  });

  test("a #tag in the phrase filters by tag instead of matching names", async ({
    sbPage,
  }) => {
    const frame = await openHost(sbPage);
    const input = navInput(sbPage);

    await sbPage.keyboard.type("#work", { delay: 20 });
    await expect(input).toHaveValue("#work");
    await expect(rows(frame)).toHaveText(["Alpha", "Projects/Beta"]);

    // The tag is taken out of the phrase before ranking, so what is left
    // ranks on its own -- and a second tag narrows further.
    await input.fill("#work #meeting");
    await expect(rows(frame)).toHaveText(["Projects/Beta"]);
    await input.fill("#work alpha");
    await expect(rows(frame)).toHaveText(["Alpha"]);

    // ...including for the create row, which offers the stripped phrase.
    await input.fill("#work brand new");
    await expect(frame.locator(".sb-nav-create .sb-nav-primary")).toHaveText(
      "brand new",
    );
  });

  test("bad prefixes are rejected at define time", async ({ sbPage }) => {
    const frame = await openNavigatorView(
      sbPage,
      "Navigator: Prefix Validation",
    );
    await expect(frame.locator(".sb-nav-row").first()).toBeVisible();
    expect(await rows(frame).allInnerTexts()).toEqual([
      "two chars=false",
      "not a string=false",
      "whitespace=false",
      "claimed twice=false",
      "keymap collision=false",
      "view not a name=false",
      "good=true",
    ]);
  });
});

// The four things a picker over the space needs that a query alone can't give
// it, composed exactly the way a replacement picker will compose them.
const SOURCE_DATA_CONFIG = `# Nav source data test
\`\`\`space-lua
navigator.define {
  name = "spacepicker",
  title = "Space Picker",
  command = "Navigator: Space Picker",
  dock = "modal",
  presentation = {
    mode = "list",
    row = {
      description = function(obj)
        if obj.tag == "aspiring-page" then return "aspiring" end
        if obj.tag == "document" then
          return obj.viewable and "viewable" or "not viewable"
        end
        return "page"
      end,
    },
  },
  segments = {
    { label = "Visible", default = true,
      where = function(obj) return not obj.hidden end },
    { label = "All" },
  },
  source = function()
    local opened = editor.getLastOpenedMap()
    local viewable = {}
    for _, ext in ipairs(editor.getViewableExtensions()) do
      viewable[ext] = true
    end

    local out = {}
    for _, page in ipairs(query [[from index.tag "page"]]) do
      -- Hidden pages are dropped in the source, and kept only by a segment
      -- that asks for them -- the way the built-in pickers do it.
      page.hidden = (page.pageDecoration or {}).hide == true
      out[#out + 1] = page
    end
    for _, doc in ipairs(query [[from index.tag "document"]]) do
      doc.viewable = viewable[doc.extension] == true
      out[#out + 1] = doc
    end
    table.sort(out, function(a, b)
      local ao, bo = opened[a.name], opened[b.name]
      -- Anything opened in this client outranks anything merely modified.
      if ao and bo then return ao > bo end
      if ao or bo then return ao ~= nil end
      -- A document that can't be opened sorts behind one that can.
      if (a.viewable == false) ~= (b.viewable == false) then
        return b.viewable == false
      end
      return (a.lastModified or "") > (b.lastModified or "")
    end)

    -- Broken links, last: picking one creates the page.
    for _, aspiring in ipairs(query [[from index.aspiringPages()]]) do
      out[#out + 1] = aspiring
    end
    return out
  end,
}
\`\`\`
`;

test.describe("source-side picker data", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "navtest.md": SOURCE_DATA_CONFIG,
      "Projects/Alpha.md": "# Alpha\n\nA link to [[Nowhere]].\n",
      "Projects/Beta.md": "# Beta",
      "Secret.md": "---\npageDecoration:\n  hide: true\n---\n# Secret",
      "Diagrams/flow.png": "not really a png",
      "Diagrams/notes.xyz": "no editor knows this one",
    },
  });

  function row(frame: FrameLocator, primary: string) {
    return frame.locator(".sb-nav-row", { hasText: primary }).first();
  }

  async function openPicker(sbPage: Page) {
    const frame = await openNavigatorView(sbPage, "Navigator: Space Picker");
    await expect(row(frame, "Projects/Beta")).toBeVisible();
    return frame;
  }

  test("lastOpened ranks the pages this client has actually opened", async ({
    sbPage,
    sbServer,
  }) => {
    // Two navigations, so the order is recency and not something the index
    // happens to agree with.
    await gotoSilverBulletPage(sbPage, sbServer, "Projects/Beta");
    await gotoSilverBulletPage(sbPage, sbServer, "Projects/Alpha");

    const frame = await openPicker(sbPage);
    await expect(async () => {
      const primaries = await frame
        .locator(".sb-nav-row:not(.sb-nav-create) .sb-nav-primary")
        .allInnerTexts();
      expect(primaries.slice(0, 2)).toEqual([
        "Projects/Alpha",
        "Projects/Beta",
      ]);
    }).toPass();
  });

  test("aspiring pages come along as rows of their own", async ({ sbPage }) => {
    const frame = await openPicker(sbPage);
    // `[[Nowhere]]` in Projects/Alpha, indexed as an aspiring page.
    await expect(row(frame, "Nowhere")).toBeVisible();
    await expect(row(frame, "Nowhere")).toContainText("aspiring");
  });

  test("hidden pages are dropped in the source and kept by a segment", async ({
    sbPage,
  }) => {
    const frame = await openPicker(sbPage);
    await expect(row(frame, "Secret")).toHaveCount(0);

    await frame.locator(".sb-segment[aria-label='All']").click();
    await expect(row(frame, "Secret")).toBeVisible();
  });

  test("documents know whether this client can open them", async ({
    sbPage,
  }) => {
    const frame = await openPicker(sbPage);
    // png has an editor (the image viewer ships with the client); xyz has none.
    await expect(row(frame, "Diagrams/flow.png")).toContainText("viewable");
    await expect(row(frame, "Diagrams/notes.xyz")).toContainText(
      "not viewable",
    );

    // ...and the one nothing can open sorts behind the one something can.
    const primaries = await frame
      .locator(".sb-nav-row:not(.sb-nav-create) .sb-nav-primary")
      .allInnerTexts();
    expect(primaries.indexOf("Diagrams/flow.png")).toBeLessThan(
      primaries.indexOf("Diagrams/notes.xyz"),
    );
  });
});
