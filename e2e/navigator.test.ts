import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FrameLocator, Page } from "@playwright/test";
import {
  expect,
  gotoSilverBulletPage,
  mod,
  type SBServer,
  test,
} from "./fixtures.ts";
import {
  closePicker,
  expectNavInputFocused,
  expectNavRow,
  navigateViaPagePicker,
  openPicker,
  runCommandViaPalette,
} from "./navigator-ui.ts";

const NAV_CONFIG = `# Nav test
\`\`\`space-lua
navigator.define {
  name = "pages",
  title = "Pages",
  command = "Navigator: Pages",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "list" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator._flakyCalls = navigator._flakyCalls or 0
navigator.define {
  name = "flaky",
  title = "Flaky",
  command = "Navigator: Flaky",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  source = function()
    navigator._flakyCalls = navigator._flakyCalls + 1
    error("source exploded " .. navigator._flakyCalls)
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "sidebar",
  title = "Sidebar",
  command = "Navigator: Sidebar",
  dock = "lhs",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "list" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "sidebarjournal",
  title = "Sidebar Journal",
  command = "Navigator: Sidebar Journal",
  dock = "lhs",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "list" },
  source = function()
    local out = {}
    for _, p in ipairs(query [[from index.tag "page" order by _.name]]) do
      if string.sub(p.name, 1, 8) == "Journal/" then out[#out + 1] = p end
    end
    return out
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "modaltree",
  title = "Modal Tree",
  command = "Navigator: Modal Tree",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "tree" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "sidebartree",
  title = "Sidebar Tree",
  command = "Navigator: Sidebar Tree",
  dock = "rhs",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  followEditor = true,
  presentation = { mode = "tree" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "createlist",
  title = "Create List",
  command = "Navigator: Create List",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  onCreate = function(name) editor.navigate(name) end,
  presentation = { mode = "list" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "createtree",
  title = "Create Tree",
  command = "Navigator: Create Tree",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "tree" },
  onCreate = function(name) editor.navigate(name) end,
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

-- Synthetic + tiny, so "does this phrase prune the tree to nothing" doesn't
-- depend on what the background indexer has delivered yet.
navigator.define {
  name = "createtreesmall",
  title = "Create Tree Small",
  command = "Navigator: Create Tree Small",
  dock = "modal",
  onCreate = function(name) editor.navigate(name) end,
  presentation = { mode = "tree" },
  source = function()
    return { { name = "Alpha", ref = "Alpha" }, { name = "Beta", ref = "Beta" } }
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "keymaptree",
  title = "Keymap Tree",
  command = "Navigator: Keymap Tree",
  dock = "rhs",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  followEditor = true,
  presentation = { mode = "tree" },
  keymap = {
    [" "] = function(obj) editor.navigate(obj.ref or obj.name) end,
  },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "keymaplist",
  title = "Keymap List",
  command = "Navigator: Keymap List",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "list" },
  keymap = {
    [" "] = function(obj) editor.navigate(obj.ref or obj.name) end,
  },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "createbulk",
  title = "Create Bulk",
  command = "Navigator: Create Bulk",
  dock = "modal",
  onCreate = function(name) editor.navigate(name) end,
  presentation = { mode = "list" },
  source = function()
    local out = {}
    for i = 1, 120 do
      local n = string.format("Item%03d", i)
      out[#out + 1] = { name = n, ref = n }
    end
    return out
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "expandalltree",
  title = "Expand All Tree",
  command = "Navigator: Expand All Tree",
  dock = "rhs",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "tree", expandAll = true },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

-- Synthetic rows: enough of them to scroll, and identical across refreshes so
-- a scroll-stability assertion isn't confounded by the dataset changing.
navigator.define {
  name = "scrolltree",
  title = "Scroll Tree",
  command = "Navigator: Scroll Tree",
  dock = "rhs",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "tree" },
  source = function()
    local out = {}
    for i = 1, 120 do
      local n = string.format("Bulk%03d", i)
      out[#out + 1] = { name = n, ref = n }
    end
    return out
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}
\`\`\`
`;

const SPACE_STYLE = `# Styles
\`\`\`space-style
.sb-nav-row { outline-color: rgb(1, 2, 3); }
\`\`\`
`;

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
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }),
  ).toBeVisible();
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Beta" }),
  ).toBeVisible();
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

// Asserts on the class directly, not a :not(.sb-hidden) query, which a CSS specificity bug can satisfy while still visually rendered.
function sidebarTreePanel(sbPage: Page) {
  return sbPage.locator("#sb-main .sb-keyed-panel-rhs");
}

async function closeSidebar(sbPage: Page, selector = ".sb-keyed-panel-rhs") {
  await sbPage
    .frameLocator(`${selector} iframe`)
    .locator(".sb-nav-close")
    .click();
}

// An input can be document.activeElement inside its iframe while the host has focus elsewhere, so keystrokes never reach it.
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
  expect([...primaries].sort()).toEqual(primaries);

  await navInput(sbPage).fill("alpha");
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

test("Escape closes the modal even with a phrase typed", async ({ sbPage }) => {
  await openNavigator(sbPage);

  await navInput(sbPage).fill("beta");
  await navInput(sbPage).press("Escape");
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);
});

test("reopening reuses the same iframe and clears the stale phrase", async ({
  sbPage,
}) => {
  await openNavigator(sbPage);
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

// Reopening an already-displayed view took the `else if (!passive)` branch in `createActivate`, which never called `setView`, so only the 800ms fallback ever revealed the panel.
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
    await expectNavInputFocused(sbPage);
  };
  const close = async () => {
    await sbPage.keyboard.press("Escape");
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
  };

  const luaFirst = await revealedWithin(() => open("Navigator: Pages"));
  await close();

  const luaWarmReopen = await revealedWithin(() => open("Navigator: Pages"));
  await close();

  await open("Navigate: Page Picker");
  await close();
  const luaReopenAfterSwitch = await revealedWithin(() =>
    open("Navigator: Pages"),
  );
  await close();

  const tsFirst = await revealedWithin(() => open("Navigate: Page Picker"));
  await close();
  const tsWarmReopen = await revealedWithin(() =>
    open("Navigate: Page Picker"),
  );
  await close();
  await open("Navigator: Pages");
  await close();
  const tsReopenAfterSwitch = await revealedWithin(() =>
    open("Navigate: Page Picker"),
  );

  console.log(
    `C1_MATRIX lua(first=${luaFirst}ms warm=${luaWarmReopen}ms afterSwitch=${luaReopenAfterSwitch}ms) ` +
      `ts(first=${tsFirst}ms warm=${tsWarmReopen}ms afterSwitch=${tsReopenAfterSwitch}ms)`,
  );

  for (const ms of [
    luaWarmReopen,
    luaReopenAfterSwitch,
    tsWarmReopen,
    tsReopenAfterSwitch,
  ]) {
    expect(ms).toBeLessThan(400);
  }
});

test("first open of a never-preloaded dock still activates", async ({
  sbPage,
}) => {
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
  await expect(navInput(sbPage)).toBeFocused();
  const firstAttempt = await error.innerText();

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

  await sbPage.locator("#sb-editor .cm-content").click();
  await runCommand(sbPage, "Navigator: Sidebar Journal");

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
  // Without these the user is trapped behind the fixed backdrop whenever the panel's iframe fails to boot, since only in-iframe code can hidePanel.
  await openNavigator(sbPage);
  await sbPage
    .locator(".sb-modal-backdrop")
    .click({ position: { x: 5, y: 5 } });
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);

  await openNavigator(sbPage);
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

  await expect(frame.locator(".sb-nav-selected")).toHaveAttribute(
    "data-path",
    "Journal",
  );

  await input.press("ArrowRight");
  await expect(frame.locator("[data-path='Journal/Today']")).toBeVisible();

  await input.press("ArrowDown");
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

  await input.fill("");
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);
});

test("list: typing highlights the matched characters", async ({ sbPage }) => {
  const frame = await openNavigator(sbPage);
  const row = frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" });

  await navInput(sbPage).fill("alpha");
  await expect(row.locator("mark")).toBeVisible();
  await expect(row.locator("mark")).toHaveText("Alpha");

  await navInput(sbPage).fill("");
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

  // Regression guard: the keyed panel's nested .sb-panel once had no flex container to grow inside, so its iframe collapsed to the browser's ~150px replaced-element default instead of filling the sidebar.
  const iframeBox = await sbPage
    .locator(".sb-keyed-panel-rhs iframe")
    .boundingBox();
  const mainBox = await sbPage.locator("#sb-main").boundingBox();
  expect(iframeBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(Math.abs(iframeBox!.height - mainBox!.height)).toBeLessThan(5);

  await sbPage.locator("#sb-editor .cm-content").click();

  await navigateViaPagePicker(sbPage, "Projects/Alpha");

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

  await runCommand(sbPage, "Navigator: Sidebar Tree");
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

  await navigateViaPagePicker(sbPage, "Projects/Alpha");

  await runCommand(sbPage, "Navigator: Sidebar Tree");
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
  // A .sb-keyed-panel.sb-hidden that's actually still rendered (the C1 regression) would keep occupying its flex share, so the editor wouldn't reclaim the full #sb-main width.
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
  await expect(frame.locator("[data-path='Projects']")).toBeVisible({
    timeout: 20_000,
  });
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
  await expect(frame.locator("[data-path='Journal/Today']")).toBeVisible();

  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

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
  await expect(
    frame.locator("[data-path='Projects/Alpha'] mark"),
  ).toBeVisible();

  await input.fill("");
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);
});

test("tree: a row's label wins over its path segment", async ({ sbPage }) => {
  const frame = await openNavigatorView(sbPage, "Navigator: Label Tree");
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

  // Selection and expansion are keyed by path, not by index into the row array, so the refresh below must preserve both.
  await frame.locator("[data-path='Projects/Alpha']").click();
  await expect(
    frame.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
  ).toBeVisible();

  // writeFile (not the .fs HTTP endpoint) matches e2e/external-edit.test.ts, which found it more reliable under CI load.
  await writeFile(join(sbServer.spaceDir, "Projects/Gamma.md"), "# Gamma");

  await expect(frame.locator("[data-path='Projects/Gamma']")).toBeVisible({
    timeout: 20_000,
  });
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

  await closeSidebar(sbPage);
  await expect(sidebarTreePanel(sbPage)).toBeHidden();

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

  // Simulates the startup indexing storm (mq:emptyQueue:indexQueue firing repeatedly) this deferral exists for.
  for (let i = 0; i < 6; i++) {
    await writeFile(
      join(sbServer.spaceDir, `Projects/Storm${i}.md`),
      `# Storm ${i}`,
    );
    await sbPage.waitForTimeout(60);
  }
  await sbPage.waitForTimeout(500);
  expect(await refreshCalls()).toBe(0);

  await runCommand(sbPage, "Navigator: Sidebar Tree");
  await expect(sidebarTreePanel(sbPage)).toBeVisible();

  // Reads the count the moment it lands rather than after waiting for rows to paint: an indexing event inside that window would be a second, legitimate refresh, muddying whether the six writes collapsed into one.
  await expect
    .poll(refreshCalls, { intervals: [10], timeout: 20_000 })
    .toBeGreaterThan(0);
  expect(await refreshCalls()).toBe(1);

  await expect(frame.locator("[data-path='Projects/Storm0']")).toBeVisible({
    timeout: 20_000,
  });
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
});

test("command open focuses the filter input in the modal dock", async ({
  sbPage,
}) => {
  await openNavigator(sbPage);
  await expectFilterInputFocused(sbPage, ".sb-modal iframe");

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

  const selected = frame.locator(".sb-nav-selected");
  await expect(selected).toHaveAttribute("data-path", "index");

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

  await frame.locator("input.sb-nav-input").fill("alpha");
  await sbPage.locator("#sb-editor .cm-content").click();
  await expect(sbPage.locator("#sb-editor .cm-content")).toBeFocused();

  await runCommand(sbPage, "Navigator: Sidebar Tree");

  await expect(sidebarTreePanel(sbPage)).toBeVisible();
  await expectFilterInputFocused(sbPage, ".sb-keyed-panel-rhs iframe");
  await expect(frame.locator("input.sb-nav-input")).toHaveValue("alpha");
  await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
  await expect(frame.locator("[data-path='Journal']")).toHaveCount(0);

  await frame.locator("input.sb-nav-input").fill("");
  await expect(frame.locator("[data-path='Journal']")).toBeVisible();
});

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

  await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
  await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

  await sbPage.locator("#sb-editor .cm-content").click();
  await runCommand(sbPage, "Navigator: Sidebar Tree");

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

  const input = frame.locator("input.sb-nav-input");
  await input.press("Home");
  await expect(frame.locator(".sb-nav-selected")).toHaveAttribute(
    "data-path",
    "Journal",
  );
  await input.press("ArrowRight");
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

  await expect(frame.locator(".sb-nav-create")).toHaveCount(0);

  await input.fill("Projects/Alpha");
  await expect(frame.locator(".sb-nav-create")).toHaveCount(0);

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
  // With no tree rows left, selection used to fall back to index 0, which resolved to no node and no create row -- Enter did nothing. No End press here: the create row must already be the selection.
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
  // If appended after the results, the create row would start far below the fold in a long list, so Shift-Enter could create a page the user never saw.
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

  // scrollIntoView inside a same-origin iframe scrolls the host's scrollable ancestors too, so nothing outside the panel's own scroll container may move.
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
  const inputSelect = await frame
    .locator("input.sb-nav-input")
    .evaluate((el) => getComputedStyle(el).userSelect);
  expect(inputSelect).not.toBe("none");
});

test("hovering a row does not highlight it", async ({ sbPage }) => {
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
  expect(await colors(selected)).toEqual(before);
});

test("panels get the space style, and follow a mid-session theme change", async ({
  sbPage,
}) => {
  const frame = await openNavigator(sbPage);

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
    expect(after).toEqual({ theme: "dark", sameFrame: true });
  }).toPass();
  expect(before).not.toBe("dark");
});

test("keymap: a printable key types while typing and acts while navigating", async ({
  sbPage,
}) => {
  const frame = await openNavigatorView(sbPage, "Navigator: Keymap List");
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Projects/Alpha" }),
  ).toBeVisible();
  await expectFilterInputFocused(sbPage, ".sb-modal iframe");

  const input = frame.locator("input.sb-nav-input");
  const currentPage = sbPage.locator("#sb-current-page input.sb-input");
  await expect(currentPage).toHaveValue("index");

  await sbPage.keyboard.type("projects alpha", { delay: 20 });
  await expect(input).toHaveValue("projects alpha");
  await expect(currentPage).toHaveValue("index");

  await input.press("ArrowDown");
  const target = await frame
    .locator(".sb-nav-selected .sb-nav-primary")
    .innerText();
  await input.press(" ");
  await expect(currentPage).toHaveValue(target);
  await expect(input).toHaveValue("projects alpha");
  await expectFilterInputFocused(sbPage, ".sb-modal iframe");

  await sbPage.keyboard.type("x", { delay: 20 });
  await expect(input).toHaveValue("projects alphax");
  await sbPage.keyboard.type(" y", { delay: 20 });
  await expect(input).toHaveValue("projects alphax y");
  await expect(currentPage).toHaveValue(target);
});

const DND_CONFIG = `# Nav DnD test
\`\`\`space-lua
navigator.define {
  name = "movetree",
  title = "Move Tree",
  command = "Navigator: Move Tree",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "tree", foldersFirst = false },
  onMove = navigator.moveByRename,
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
      "X/Alpha.md": "# Other Alpha",
      "Archive/Keep.md": "# Keep",
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
    expect(await exists(join(sbServer.spaceDir, "Archive/Keep.md"))).toBe(true);
  });

  test("moves a page that is also a folder, page and subtree together", async ({
    sbPage,
    sbServer,
  }) => {
    // renamePrefixCommand only touches files under Notes/, so the dual move needs its own page rename on top of the prefix one.
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

    await source.hover();
    await sbPage.mouse.down();
    const box = (await target.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
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

    const input = frame.locator("input.sb-nav-input");
    // Retried, not raced: the modal's panel:shown reset can still land just after the panel is populated, wiping a phrase typed that same instant.
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
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "tree" },
  actions = {
    { icon = "edit-3", label = "Rename", run = function(obj)
        editor.flashNotification("action rename " .. obj.name)
      end },
    { icon = "trash-2", label = "Delete",
      run = function(obj)
        if not editor.confirm("Delete " .. obj.name .. "?") then return end
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "actionlist",
  title = "Action List",
  command = "Navigator: Action List",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "icontree",
  title = "Icon Tree",
  command = "Navigator: Icon Tree",
  dock = "rhs",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
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
        -- assigned statically -- the rowState hook only admits a string
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

-- An empty table is not an empty array once it crosses to the panel; both of
-- these used to take the whole view down with a TypeError.
navigator.define {
  name = "emptyextras",
  title = "Empty Extras",
  command = "Navigator: Empty Extras",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "list" },
  actions = {},
  keymap = {},
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "rotree",
  title = "RO Tree",
  command = "Navigator: RO Tree",
  dock = "rhs",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  onCreate = function(name) editor.navigate(name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
    // Not in the DOM at all until the row is the selected or hovered one, not merely CSS-hidden: a long list carries no buttons it isn't about to show.
    await expect(rename).toHaveCount(0);

    await projects.hover();
    await expect(rename).toBeVisible();
    // Numbered feather names ("edit-3") are exactly what a naive kebab-to-Pascal icon conversion silently drops.
    await expect(rename.locator("svg")).toHaveCount(1);

    const selected = frame.locator(".sb-nav-row.sb-nav-selected");
    await expect(selected).not.toHaveAttribute("data-path", "Projects");
    await expect(selected.locator(".sb-row-action").first()).toBeVisible();
  });

  test("when() decides which actions a row offers", async ({ sbPage }) => {
    const frame = await openTree(sbPage, "Navigator: Action Tree");

    const actionsOn = async (path: string) => {
      await frame.locator(`[data-path='${path}']`).hover();
      return frame.locator(`[data-path='${path}'] .sb-row-action`);
    };

    await expect(await actionsOn("Projects")).toHaveCount(3);
    await expect(await actionsOn("Notes")).toHaveCount(3);
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

    // A notification the decline wrongly produced would race an immediate check, so anchor it behind a later observable event (a different action's own notification) before insisting the declined one never appeared.
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
    expect(await color("Projects")).toBe(await color("index"));
    expect(await band("index")).toBe("none");
    expect(await band("Projects")).not.toBe("none");
    expect(await band("Notes")).not.toBe("none");

    const resting = await frame
      .locator("[data-path='Projects']")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await frame.locator("[data-path='Projects']").hover();
    expect(
      await frame
        .locator("[data-path='Projects']")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(resting);

    await frame.locator("[data-path='Projects']").click();
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

    const folderIcon = await svg("Projects");
    const pageIcon = await svg("Notes/Sub");
    expect(folderIcon).toContain("<svg");
    expect(folderIcon).not.toBe(pageIcon);
    expect(await svg("Notes")).toBe(folderIcon);

    await expect(
      frame.locator("[data-path='index'] .sb-nav-icon svg[data-raw='yes']"),
    ).toHaveCount(1);

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

    // The rowState hook only admits a string result; a table return (the pre-consolidation escape hatch) is still reachable at runtime since validateRowIcon can't see what a function will return.
    await expect(
      frame.locator("[data-path='Projects/Alpha'] .sb-nav-icon"),
    ).toHaveCount(1);
    await expect(
      frame.locator("[data-path='Projects/Alpha'] .sb-nav-icon svg"),
    ).toHaveCount(0);

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
    // Lua's {} crosses as an object, not an array: .some/.includes on it threw, meaning a boot error instead of a view, and a TypeError on every keystroke.
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

    await sbPage.locator("#sb-editor .cm-content").click();
    await runCommand(sbPage, "Editor: Toggle Read Only Mode");
    await expect(sbPage.locator(".sb-notifications")).toContainText(
      "Read-only mode enabled",
    );

    await frame.locator("[data-path='Projects']").hover();
    await expect(action(frame, "Projects", "Delete")).toHaveCount(0);
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
  // An older activation landing after a newer one must be dropped by token order, not merely deduped as a literal duplicate of the newest.
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

  await openNavigator(sbPage);
  await navInput(sbPage).press("Escape");
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);
  await sbPage.locator("#sb-editor .cm-content").click();
  await openNavigator(sbPage);

  await navInput(sbPage).fill("alpha");
  await expect(navInput(sbPage)).toHaveValue("alpha");

  // Under an equality-only check this stale dispatch would pass the guard and the activation tail would clear the phrase.
  await dispatchActivate("pages", 1);
  await sbPage.waitForTimeout(500);
  await expect(navInput(sbPage)).toHaveValue("alpha");

  // Positive control: a newer token still activates, proving the assertion above isn't just measuring a dead dispatch path.
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
  { label = "Documents", icon = "file",
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "segmenttree",
  title = "Segment Tree",
  command = "Navigator: Segment Tree",
  dock = "rhs",
  presentation = { mode = "tree" },
  segments = kindSegments,
  source = things,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator._badIcons = {}
-- Every case also carries a no-op onSelect, so what actually rejects each one
-- is the field under test, not the separate "onSelect is required" check.
for _, case in ipairs({
  { what = "segment icon", spec = { name = "bad1", source = things,
      onSelect = function() end,
      segments = { { label = "A", icon = 42 } } } },
  -- The old { svg = ... } escape hatch: an icon must be a string now.
  { what = "segment icon svg table", spec = { name = "bad2", source = things,
      onSelect = function() end,
      segments = { { label = "A", icon = { svg = "<svg></svg>" } } } } },
  { what = "action icon", spec = { name = "bad3", source = things,
      onSelect = function() end,
      actions = { { label = "A", icon = {}, run = function() end } } } },
  { what = "action icon svg table", spec = { name = "bad3b", source = things,
      onSelect = function() end,
      actions = { { label = "A", icon = { svg = "<svg></svg>" }, run = function() end } } } },
  -- presentation.row.icon: same old escape hatch, its own validator.
  { what = "row icon svg table", spec = { name = "bad4b", source = things,
      onSelect = function() end,
      presentation = { row = { icon = { svg = "<svg></svg>" } } } } },
  { what = "limit", spec = { name = "bad5", source = things,
      onSelect = function() end,
      presentation = { limit = 0 } } },
  { what = "search", spec = { name = "bad6", source = things, search = "fts",
      onSelect = function() end } },
  { what = "duplicate label", spec = { name = "bad7", source = things,
      onSelect = function() end,
      segments = { { label = "A" }, { label = "A" } } } },
  { what = "dock", spec = { name = "bad8", source = things, dock = "left",
      onSelect = function() end } },
  { what = "mode", spec = { name = "bad9", source = things,
      onSelect = function() end,
      presentation = { mode = "table" } } },
  { what = "hierarchy", spec = { name = "bad10", source = things,
      onSelect = function() end,
      presentation = { mode = "tree", hierarchy = {} } } },
  -- \`onSelect\` is required at define time now.
  { what = "missing onSelect", spec = { name = "bad13", source = things } },
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
    await expectFilterInputFocused(sbPage, ".sb-modal iframe");

    await navInput(sbPage).fill("beta");
    expect(await primaries()).toEqual(["Projects/Beta"]);
    await navInput(sbPage).fill("gamma");
    await expect(frame.locator(".sb-nav-empty")).toBeVisible();

    await segment(frame, "Documents").click();
    expect(await primaries()).toEqual(["Projects/Gamma.png"]);
  });

  test("Ctrl-Arrow cycles the segments, wrapping both ways", async ({
    sbPage,
  }) => {
    const frame = await openSegmentList(sbPage);
    const active = frame.locator(".sb-segment[aria-checked='true']");

    await expect(active).toHaveText(/All/);
    await navInput(sbPage).press("Control+ArrowRight");
    await expect(active).toHaveText(/Pages/);
    await navInput(sbPage).press("Control+ArrowRight");
    await expect(active).toHaveText(/Documents/);
    await navInput(sbPage).press("Control+ArrowRight");
    await expect(active).toHaveText(/All/);
    await navInput(sbPage).press("Control+ArrowLeft");
    await expect(active).toHaveText(/Documents/);
    await navInput(sbPage).press("Control+Shift+ArrowLeft");
    await expect(active).toHaveText(/Pages/);

    await expect(navInput(sbPage)).toHaveValue("");
    await sbPage.keyboard.type("alpha", { delay: 20 });
    await expect(navInput(sbPage)).toHaveValue("alpha");
  });

  test("the active segment is remembered per view", async ({ sbPage }) => {
    const frame = await openSegmentList(sbPage);
    await segment(frame, "Documents").click();
    await expect(segment(frame, "Documents")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await navInput(sbPage).press("Escape");
    await expect(
      sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
    ).toHaveCount(0);
    await sbPage.locator("#sb-editor .cm-content").click();

    const reopened = await openSegmentList(sbPage);
    await expect(segment(reopened, "Documents")).toHaveAttribute(
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

    await frame.locator(".sb-segment[aria-label='Documents']").click();
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

    expect(await frame.locator(".sb-nav-primary").allInnerTexts()).toEqual([
      "Alpha",
      "Projects/Beta",
    ]);
    await expect(frame.locator(".sb-nav-error")).toHaveCount(0);
  });

  test("segments keep working in read-only mode", async ({ sbPage }) => {
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

    await frame.locator(".sb-segment[aria-label='Pages']").click();
    await expect(frame.locator("[data-path='Alpha']")).toBeVisible();
    await expect(frame.locator("[data-path='Settings']")).toHaveCount(0);
  });

  test("typing costs no syscalls, and a switch costs only its persistence", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: No Refresh");
    await expect(segment(frame, "All")).toBeVisible();
    await expect(frame.locator(".sb-nav-row")).toHaveCount(4);

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

    await sbPage.keyboard.type("alpha", { delay: 60 });
    await expect(navInput(sbPage)).toHaveValue("alpha");
    await expect(frame.locator(".sb-nav-primary").first()).toHaveText("Alpha");
    expect(await counted()).toEqual([]);

    await frame.locator(".sb-segment[aria-label='Pages']").click();
    await expect(segment(frame, "Pages")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(async () => {
      expect(await counted()).toEqual(["datastore.set"]);
    }).toPass();

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

    await sbPage.evaluate(() => {
      const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
      const w = f.contentWindow as any;
      const orig = w.syscall;
      w.syscall = (name: string, ...args: any[]) => {
        if (name === "navigator.handle" && args[0]?.hook === "rowState") {
          return Promise.reject(new Error("no state for you"));
        }
        return orig(name, ...args);
      };
      w.__navigatorHooks.refresh();
    });

    await expect(frame.locator(".sb-nav-notice")).toBeVisible();
    await expect(frame.locator(".sb-nav-row")).toHaveCount(0);

    await frame.locator(".sb-segment[aria-label='All']").click();
    await expect(frame.locator(".sb-nav-row")).toHaveCount(4);
    await expect(frame.locator(".sb-nav-notice")).toHaveCount(0);
  });

  test("empty refreshOn and filter.fields tables mean 'none', not 'broken'", async ({
    sbPage,
  }) => {
    // refreshOn = {} used to reach the panel as an object and fail the open outright ("object is not iterable"); filter = { fields = {} } used to survive as a truthy field map and rank every row 0.
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
    const frame = await openNavigatorView(sbPage, "Navigator: Validation");
    await expect(frame.locator(".sb-nav-row").first()).toBeVisible();
    expect(await frame.locator(".sb-nav-primary").allInnerTexts()).toEqual([
      "segment icon=false",
      "segment icon svg table=false",
      "action icon=false",
      "action icon svg table=false",
      "row icon svg table=false",
      "limit=false",
      "search=false",
      "duplicate label=false",
      "dock=false",
      "mode=false",
      "hierarchy=false",
      "missing onSelect=false",
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

    await dragSidebar(sbPage, frame, -220);
    await expect(label).toBeVisible();
    await expect(icon).toBeVisible();

    await dragSidebar(sbPage, frame, 400);
    await expect(label).toBeHidden();
    await expect(icon).toBeVisible();
    await expect(
      frame.locator(".sb-segment[aria-label='Pages']").first(),
    ).toHaveAttribute("title", "Pages");
  });

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

    // A name wider than the dock used to run past the pane and stop mid-glyph, its own ellipsis rendered off-screen where nothing could see it.
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

async function dragSidebar(sbPage: Page, frame: FrameLocator, dx: number) {
  const handle = frame.locator(".sb-resizer-rhs");
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  await sbPage.mouse.move(box.x + box.width / 2, y);
  await sbPage.mouse.down();
  await sbPage.mouse.move(box.x + box.width / 2 + dx, y, { steps: 10 });
  await sbPage.mouse.up();
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
    const client = await openNavigatorView(sbPage, "Navigator: Client Search");
    await expect(
      client.locator(".sb-nav-row", { hasText: "Anchor" }),
    ).toBeVisible();
    await navInput(sbPage).fill("blue");
    await expect(client.locator(".sb-nav-row")).toHaveCount(2);
    const clientOrder = await client.locator(".sb-nav-primary").allInnerTexts();
    await navInput(sbPage).press("Escape");
    await expect(
      sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
    ).toHaveCount(0);
    await sbPage.locator("#sb-editor .cm-content").click();

    const frame = await openNavigatorView(sbPage, "Navigator: Source Search");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(5);

    await navInput(sbPage).fill("blue");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(2);
    // The source hands back what search.rank produced, reversed; had the panel re-ranked instead, this would equal clientOrder.
    expect(await frame.locator(".sb-nav-primary").allInnerTexts()).toEqual(
      [...clientOrder].reverse(),
    );

    await navInput(sbPage).fill("cobalt");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(1);
    await expect(frame.locator(".sb-nav-primary")).toHaveText("Cobalt");
  });

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

    await sbPage.evaluate(() => {
      const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
      const w = f.contentWindow as any;
      const orig = w.syscall;
      w.syscall = async (name: string, ...args: any[]) => {
        const result = await orig(name, ...args);
        if (
          name === "navigator.handle" &&
          args[0]?.hook === "rows" &&
          args[0]?.args?.ctx?.phrase === "blue"
        ) {
          await new Promise((r) => setTimeout(r, 3000));
        }
        return result;
      };
    });

    await navInput(sbPage).fill("blue");
    await expect(frame.locator(".sb-nav-spinner")).toBeVisible();

    await navInput(sbPage).fill("cobalt");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(1);
    await expect(frame.locator(".sb-nav-primary")).toHaveText("Cobalt");
    await expect(frame.locator(".sb-nav-spinner")).toBeHidden();

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

    await navInput(sbPage).fill("boom");
    await expect(frame.locator(".sb-nav-error-inline")).toContainText("kaboom");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(2);
    expect(await frame.locator(".sb-nav-primary").allInnerTexts()).toEqual(
      expect.arrayContaining(["Bluebird", "Blueprint"]),
    );

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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}
\`\`\`
`;

test.describe("render cap", () => {
  test.use({
    spaceFiles: { "index.md": "Welcome", "navtest.md": BULK_CONFIG },
  });

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

    await expect(frame.locator(".sb-nav-list .sb-nav-row")).toHaveCount(3);
    await expect(frame.locator(".sb-nav-more")).toHaveText(
      "7 more matches — keep typing",
    );

    await navInput(sbPage).press("End");
    await expect(frame.locator(".sb-nav-row.sb-nav-selected")).toHaveText(
      /Charlie/,
    );

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

    await expect(frame.locator(".sb-nav-list .sb-nav-row")).toHaveCount(200);
    await expect(frame.locator(".sb-nav-more")).toContainText("4800 more");
    await expect(frame.locator(".sb-row-action")).toHaveCount(1);

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

    const budget = process.env.CI ? 2400 : 800;
    expect(worst).toBeLessThan(budget);

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

    await refreshAndSettle();
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) samples.push(await refreshAndSettle());
    const worst = Math.max(...samples);
    console.log(
      `navigator 5k refresh (source + rowState + render): ${samples
        .map((s) => Math.round(s))
        .join("ms, ")}ms (worst ${Math.round(worst)}ms)`,
    );

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

    // The refresh path is explicitly allowed to be slow (off the interaction path); this guards against an order-of-magnitude regression (a comparator-driven sort creeping back in, a per-row round trip), not a millisecond budget.
    expect(worst).toBeLessThan(process.env.CI ? 9000 : 3000);
  });

  test("@slow 2000-node tree: a hover transition stays inside the budget", async ({
    sbPage,
  }) => {
    test.setTimeout(180_000);
    const frame = await openNavigatorView(sbPage, "Navigator: Bulk Tree");
    await expect(frame.locator("[data-path='Folder01']")).toBeVisible();

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
    await rows.nth(5).hover();
    const parked = await rows.nth(5).innerText();
    await expect(rows.nth(5).locator(".sb-row-action")).toHaveCount(2);

    await navInput(sbPage).press("PageDown");
    await navInput(sbPage).press("PageDown");
    await navInput(sbPage).press("PageDown");

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
    await expect(rows.nth(0).locator(".sb-row-action")).toHaveCount(1);
    await expect(rows.nth(3).locator(".sb-row-action")).toHaveCount(0);

    await rows.nth(3).hover();
    await expect(rows.nth(3).locator(".sb-row-action")).toHaveCount(2);
    await expect(rows.nth(3).locator(".sb-row-action").first()).toBeVisible();
    await expect(frame.locator(".sb-row-action")).toHaveCount(3);

    await frame.locator("input.sb-nav-input").hover();
    await expect(rows.nth(3).locator(".sb-row-action")).toHaveCount(0);
  });
});

const MODAL_VIEW = `# Modal view
\`\`\`space-lua
navigator.define {
  name = "test.pagesModal",
  title = "Pages Modal",
  command = "Navigator: Pages Modal",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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

function sidebarFrame(sbPage: Page, side: "lhs" | "rhs" = "lhs") {
  return sbPage.frameLocator(`.sb-keyed-panel-${side} iframe`);
}

// A plain page.reload() will not do: navigating inside the app rewrites the URL without the ?headless=1 the fixture booted with, landing on a client with no runtime hooks or readiness signal.
async function reboot(sbPage: Page, sbServer: SBServer, pagePath = "") {
  await gotoSilverBulletPage(sbPage, sbServer, pagePath);
  await expect(
    sbPage.locator(".sb-modal-backdrop .sb-keyed-panel"),
  ).toHaveCount(1);
}

async function waitPastRestore(sbPage: Page) {
  const modal = await openNavigatorView(sbPage, "Navigator: Pages Modal");
  await expect(modal.locator(".sb-nav-row").first()).toBeVisible();
}

test.describe("built-in views", () => {
  test.use({ spaceFiles: BUILTIN_FILES });

  async function openSpaceTree(sbPage: Page) {
    await runCommand(sbPage, "Navigate: Tree");
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

    expect(new Set([folder, page, document, image]).size).toBe(4);
    expect(await iconOf("Projects")).toBe(folder);
  });

  test("a page/folder dual is navigable, a pure folder is not", async ({
    sbPage,
  }) => {
    const frame = await openSpaceTree(sbPage);

    await expect(frame.locator("[data-path='Projects']")).toHaveClass(
      /sb-nav-dual/,
    );
    await expect(frame.locator("[data-path='Diagrams']")).not.toHaveClass(
      /sb-nav-dual/,
    );

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

  // A fresh activation re-fetches the persisted expansion snapshot as a sibling async round trip to the reveal's own ancestor-expansion, with no fixed order between them; an empty snapshot happens not to reproduce the race, hence the unrelated folder expanded by hand first.
  test("space tree: reopening a closed dock reveals the current page even with an unrelated folder remembered as expanded", async ({
    sbPage,
  }) => {
    const frame = await openSpaceTree(sbPage);
    await frame.locator("[data-path='Diagrams'] .sb-nav-chevron").click();
    await expect(
      frame.locator("[data-path='Diagrams/flow.png']"),
    ).toBeVisible();

    await closeSidebar(sbPage, ".sb-keyed-panel-lhs");
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeHidden();

    await navigateViaPagePicker(sbPage, "Projects/Alpha");

    await runCommand(sbPage, "Navigate: Tree");
    const reopened = sidebarFrame(sbPage);
    await expect(
      reopened.locator("[data-path='Projects/Alpha'].sb-nav-selected"),
    ).toBeVisible();
    await expect(
      reopened.locator("[data-path='Diagrams/flow.png']"),
    ).toBeVisible();
  });

  // closed -> open+focus and unfocused -> refocus are pre-existing behavior; focused -> hide is new (see show's toggle branch in navigator.ts).
  test("Cmd-o toggles the tree dock: closed -> open+focus, unfocused -> refocus, focused -> hide", async ({
    sbPage,
  }) => {
    await sbPage.keyboard.press(`${mod}+o`);
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await expectNavInputFocused(sbPage, ".sb-keyed-panel-lhs iframe");

    await sbPage.locator("#sb-editor .cm-content").click();
    await sbPage.keyboard.press(`${mod}+o`);
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeVisible();
    await expectNavInputFocused(sbPage, ".sb-keyed-panel-lhs iframe");

    await sbPage.keyboard.press(`${mod}+o`);
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeHidden();
  });

  // Cmd-o is Safari-the-app's own reserved "Open File..." accelerator, claimed at the OS/app level before any web page sees the keydown -- no capture-phase listener can win that race, hence this secondary binding.
  test("Cmd-Shift-o (the Safari-workable secondary binding) toggles the tree dock exactly like Cmd-o: closed -> open+focus, unfocused -> refocus, focused -> hide", async ({
    sbPage,
  }) => {
    await sbPage.keyboard.press(`${mod}+Shift+o`);
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await expectNavInputFocused(sbPage, ".sb-keyed-panel-lhs iframe");

    await sbPage.locator("#sb-editor .cm-content").click();
    await sbPage.keyboard.press(`${mod}+Shift+o`);
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeVisible();
    await expectNavInputFocused(sbPage, ".sb-keyed-panel-lhs iframe");

    await sbPage.keyboard.press(`${mod}+Shift+o`);
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeHidden();
  });

  test("Cmd-o and Cmd-Shift-o coexist: either opens the dock, either closes it, interchangeably", async ({
    sbPage,
  }) => {
    await sbPage.keyboard.press(`${mod}+o`);
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeVisible();
    await expectNavInputFocused(sbPage, ".sb-keyed-panel-lhs iframe");

    await sbPage.keyboard.press(`${mod}+Shift+o`);
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeHidden();

    await sbPage.keyboard.press(`${mod}+o`);
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeVisible();
  });

  test("Navigate: Tree is reachable via the command palette independent of either key binding", async ({
    sbPage,
  }) => {
    await runCommand(sbPage, "Navigate: Tree");
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeVisible();
    await expectNavInputFocused(sbPage, ".sb-keyed-panel-lhs iframe");
  });

  // Detection used to rely on an ancestor class only the sidebar wrapper carries; the modal wrapper renders plain sb-keyed-panel, so a focused modal picker always answered undefined. Fixed via a data-slot attribute the iframe itself carries.
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

    const folder = frame.locator("[data-path='Projects'] .sb-nav-primary");
    await expect(folder).toHaveText("Projects");
    expect(
      await folder.evaluate((el) => [
        getComputedStyle(el).textTransform,
        getComputedStyle(el.parentElement!).textTransform,
      ]),
    ).toEqual(["none", "none"]);

    await frame.locator(".sb-segment[aria-label='Documents']").click();
    await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await expect(
      frame.locator("[data-path='Projects/notes.txt']"),
    ).toBeVisible();
    await expect(frame.locator("[data-path='Projects/Alpha']")).toHaveCount(0);

    await frame.locator(".sb-segment[aria-label='Meta']").click();
    await frame.locator("[data-path='Templates'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Templates/Thing']")).toBeVisible();
    await expect(frame.locator("[data-path='Projects']")).toHaveCount(0);

    await frame.locator(".sb-segment[aria-label='All']").click();
    await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();
    await expect(
      frame.locator("[data-path='Projects/notes.txt']"),
    ).toBeVisible();
    await expect(frame.locator("[data-path='Templates/Thing']")).toHaveCount(0);
  });

  test("Space peeks at a row without giving up the panel's focus", async ({
    sbPage,
  }) => {
    const frame = await openSpaceTree(sbPage);
    const input = frame.locator("input.sb-nav-input");

    await expect(async () => {
      await input.fill("Projects/Alpha");
      await expect(input).toHaveValue("Projects/Alpha", { timeout: 1000 });
    }).toPass();
    await input.press("ArrowDown");
    await expect(frame.locator(".sb-nav-selected")).toHaveAttribute(
      "data-path",
      "Projects/Alpha",
    );

    await input.press(" ");
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Projects/Alpha",
    );
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

  test("dragging a document onto a folder renames it through the built-in's own onMove", async ({
    sbPage,
    sbServer,
  }) => {
    const frame = await openSpaceTree(sbPage);
    await frame.locator("[data-path='Diagrams'] .sb-nav-chevron").click();
    await expect(
      frame.locator("[data-path='Diagrams/flow.png']"),
    ).toBeVisible();

    await frame
      .locator("[data-path='Diagrams/flow.png']")
      .dragTo(frame.locator("[data-path='Projects']"));

    await expect(frame.locator("[data-path='Projects/flow.png']")).toBeVisible({
      timeout: 20_000,
    });
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
    await runCommand(sbPage, "Navigate: Tree");
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();

    await reboot(sbPage, sbServer);

    const restored = sidebarFrame(sbPage);
    await expect(restored.locator("[data-path='Projects']")).toBeVisible();
    expect(
      await sbPage.evaluate(
        () => document.activeElement?.tagName.toLowerCase() ?? "",
      ),
    ).not.toBe("iframe");
  });

  // Unlike the command/Cmd-o active-open path, a passive restore deliberately does not reveal (activation.ts: "a boot restore isn't an ask") -- pinned here so that stays a decision, not a drift.
  test("a docked view's selection is not auto-revealed on a passive boot restore, by design", async ({
    sbPage,
    sbServer,
  }) => {
    await runCommand(sbPage, "Navigate: Tree");
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
    await runCommand(sbPage, "Navigate: Tree");
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

  test("a docked outline (std.toc, a TS builtin) comes back on the next boot, passively", async ({
    sbPage,
    sbServer,
  }) => {
    await runCommand(sbPage, "Navigate: Outline");
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
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  openOnStart = true,
  presentation = { mode = "list" },
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator._openOnStartRejected = false
local ok = pcall(function()
  navigator.define {
    name = "startupmodal",
    dock = "modal",
    openOnStart = true,
    source = function() return {} end,
    onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
    await runCommand(sbPage, "Navigate: Tree");
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();

    const drawer = (await sbPage
      .locator("#sb-main .sb-keyed-panel-lhs")
      .boundingBox())!;
    const top = (await sbPage.locator("#sb-top").boundingBox())!;
    const viewport = sbPage.viewportSize()!;

    expect(drawer.width).toBe(viewport.width);
    const panel = (await sbPage
      .locator("#sb-main .sb-keyed-panel-lhs .sb-panel")
      .boundingBox())!;
    const inner = (await sbPage
      .locator("#sb-main .sb-keyed-panel-lhs iframe")
      .boundingBox())!;
    expect(Math.round(panel.width)).toBe(viewport.width);
    expect(Math.round(inner.width)).toBe(viewport.width);
    expect(Math.round(drawer.y)).toBe(Math.round(top.y + top.height));
    expect(Math.round(drawer.y + drawer.height)).toBe(viewport.height);
    await expect(sbPage.locator("#sb-top")).toBeVisible();

    await expect(frame.locator(".sb-resizer")).toHaveCount(0);
  });

  test("selecting closes the drawer and navigates", async ({ sbPage }) => {
    await runCommand(sbPage, "Navigate: Tree");
    const frame = sidebarFrame(sbPage);
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();

    await frame.locator("[data-path='Projects'] .sb-nav-primary").click();

    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Projects",
    );
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeHidden();
  });

  test("a keyed modal keeps the narrow-screen inset", async ({ sbPage }) => {
    const frame = await openNavigatorView(sbPage, "Navigator: Pages Modal");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Projects" }).first(),
    ).toBeVisible();

    const modal = (await sbPage.locator(".sb-modal").boundingBox())!;
    const viewport = sbPage.viewportSize()!;
    expect(Math.round(modal.x)).toBe(8);
    expect(Math.round(modal.width)).toBe(viewport.width - 16);
  });

  test("drawers never restore on boot", async ({ sbPage, sbServer }) => {
    await runCommand(sbPage, "Navigate: Tree");
    await expect(
      sidebarFrame(sbPage).locator("[data-path='Projects']"),
    ).toBeVisible();

    await reboot(sbPage, sbServer);
    await waitPastRestore(sbPage);
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
  onCreate = function(name) editor.navigate(name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator._badPrefixes = {}
-- Every case also carries a no-op onSelect, so what actually rejects each one
-- is the field under test, not the separate "onSelect is required" check.
for _, case in ipairs({
  { what = "two chars", spec = { name = "pbad1", source = things,
      onSelect = function() end,
      segments = { { label = "A", prefix = "^^" } } } },
  { what = "not a string", spec = { name = "pbad2", source = things,
      onSelect = function() end,
      segments = { { label = "A", prefix = 42 } } } },
  { what = "whitespace", spec = { name = "pbad3", source = things,
      onSelect = function() end,
      segments = { { label = "A", prefix = " " } } } },
  { what = "claimed twice", spec = { name = "pbad4", source = things,
      onSelect = function() end,
      segments = { { label = "A", prefix = "^" } },
      prefixViews = { ["^"] = "prefixchild" } } },
  { what = "keymap collision", spec = { name = "pbad5", source = things,
      onSelect = function() end,
      segments = { { label = "A", prefix = "r" } },
      keymap = { r = function() end } } },
  { what = "view not a name", spec = { name = "pbad6", source = things,
      onSelect = function() end,
      prefixViews = { ["$"] = 7 } } },
  -- ...and a legitimate one, so the cases above aren't passing by accident.
  { what = "good", spec = { name = "pgood", source = things,
      onSelect = function() end,
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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

  // The create row is a .sb-nav-row with a .sb-nav-primary of its own, so an unqualified primary query would count it as a result.
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
    await expect(input).toHaveValue("");
    await expect(rows(frame)).toHaveText(["Settings"]);

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

    await input.press("Backspace");
    await input.press("Backspace");
    await expect(input).toHaveValue("");
    await expect(segment(frame, "Meta")).toHaveAttribute(
      "aria-checked",
      "true",
    );

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

    await input.fill("$two");
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Child");
    await expect(input).toHaveValue("two");
    await expect(rows(frame)).toHaveText(["anchor-two"]);
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
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Child");
    await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeVisible();
    // The modal dock is preloaded (hidden) from boot regardless, so what proves the hop didn't surface it is toBeHidden, not merely its existence.
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
    await input.press("Alt+ ");
    await expect(input).toHaveValue("Projects/Beta/Deep");
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

    await sbPage.keyboard.press(" ");
    await expect(input).toHaveValue("Projects/");

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

    await input.press("ArrowDown");
    await input.press(" ");
    await expect(input).toHaveValue("Projects/");
  });

  test("a prefix hop keeps the panel running rather than rebooting it", async ({
    sbPage,
  }) => {
    const frame = await openHost(sbPage);
    const input = navInput(sbPage);

    // Two probes because a reboot and a rebuild fail differently (re-post bumps boot count but keeps globalThis; a key/content change replaces the iframe and resets both), and navigator:ready would repopulate the panel either way, so on-screen content alone proves nothing about continuity.
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
    const before = await probe();
    expect(before.sentinel).toBe("alive");
    expect(typeof before.boots).toBe("number");

    await sbPage.keyboard.type("$");
    await expect(frame.locator(".sb-nav-title")).toHaveText("Prefix Child");
    expect(await probe()).toEqual(before);

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

    await input.fill("#work #meeting");
    await expect(rows(frame)).toHaveText(["Projects/Beta"]);
    await input.fill("#work alpha");
    await expect(rows(frame)).toHaveText(["Alpha"]);

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

const SOURCE_DATA_CONFIG = `# Nav source data test
\`\`\`space-lua
navigator.define {
  name = "spacepicker",
  title = "Space Picker",
  command = "Navigator: Space Picker",
  dock = "modal",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
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
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
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
    await expect(row(frame, "Diagrams/flow.png")).toContainText("viewable");
    await expect(row(frame, "Diagrams/notes.xyz")).toContainText(
      "not viewable",
    );

    const primaries = await frame
      .locator(".sb-nav-row:not(.sb-nav-create) .sb-nav-primary")
      .allInnerTexts();
    expect(primaries.indexOf("Diagrams/flow.png")).toBeLessThan(
      primaries.indexOf("Diagrams/notes.xyz"),
    );
  });
});

const LUACALL_CONFIG = `# LuaCall round-trip test
\`\`\`space-lua
navigator.define {
  name = "luacalltree",
  title = "LuaCall Tree",
  command = "Navigator: LuaCall Tree",
  dock = "rhs",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  presentation = { mode = "tree" },
  actions = {
    { icon = "trash-2", label = "Delete",
      when = function(obj) return obj.isFolder ~= true end,
      run = function(obj) editor.flashNotification("action delete " .. obj.name) end },
  },
  onMove = navigator.moveByRename,
  source = function()
    return query [[from index.tag "page" order by _.name]]
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}
\`\`\`
`;

test.describe("single-registry consolidation", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "navtest.md": LUACALL_CONFIG,
      "Projects/Alpha.md": "# Alpha",
      "Projects/Beta.md": "# Beta",
      "Archive/Keep.md": "# Keep",
    },
  });

  test("a Lua-only view round-trips select, action, rowState and move through its own closures", async ({
    sbPage,
  }) => {
    const frame = await openNavigatorView(
      sbPage,
      "Navigator: LuaCall Tree",
      ".sb-keyed-panel-rhs iframe",
    );
    await expect(frame.locator("[data-path='Projects']")).toBeVisible();
    await frame.locator("[data-path='Projects'] .sb-nav-chevron").click();
    await expect(frame.locator("[data-path='Projects/Alpha']")).toBeVisible();

    await frame.locator("[data-path='Projects']").hover();
    await expect(
      frame.locator(
        "[data-path='Projects'] .sb-row-action[aria-label='Delete']",
      ),
    ).toHaveCount(0);
    await frame.locator("[data-path='Projects/Alpha']").hover();
    const deleteAction = frame.locator(
      "[data-path='Projects/Alpha'] .sb-row-action[aria-label='Delete']",
    );
    await expect(deleteAction).toBeVisible();

    await deleteAction.click();
    await expect(sbPage.locator(".sb-notifications")).toContainText(
      "action delete Projects/Alpha",
    );

    await frame
      .locator("[data-path='Projects/Beta']")
      .dragTo(frame.locator("[data-path='Archive']"));
    await expect(frame.locator("[data-path='Archive/Beta']")).toBeVisible({
      timeout: 20_000,
    });

    await frame.locator("[data-path='Archive/Beta'] .sb-nav-primary").click();
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Archive/Beta",
    );
  });
});

test.describe("builtins with no Space Lua navigator definitions present", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "Projects/Alpha.md": "# Alpha",
      "Projects/notes.txt": "plain text",
    },
  });

  test("std.pages, std.commands, std.spaceTree and std.toc all open normally", async ({
    sbPage,
  }) => {
    const pages = await openPicker(sbPage, `${mod}+k`, "Page");
    await expectNavRow(pages, "Projects/Alpha");
    await closePicker(sbPage);

    const commands = await openPicker(sbPage, `${mod}+/`, "Command");
    await expectNavRow(commands, "Navigate: Tree");
    await closePicker(sbPage);

    await runCommandViaPalette(sbPage, "Navigate: Tree");
    const tree = sbPage.frameLocator(".sb-keyed-panel-lhs iframe");
    await expect(tree.locator("[data-path='Projects']")).toBeVisible({
      timeout: 20_000,
    });

    await sbPage.locator("#sb-editor .cm-content").click();
    await runCommandViaPalette(sbPage, "Navigate: Outline");
    const outline = sbPage.frameLocator(".sb-keyed-panel-rhs iframe");
    await expect(outline.locator(".sb-nav-title")).toHaveText("Outline");
  });
});
