import { expect, gotoSilverBulletPage, mod, test } from "./fixtures.ts";
import {
  expectNavInputFocused,
  navFrame,
  navInput,
  navRows,
  navSegment,
  openPagePicker,
  runCommandViaPalette,
} from "./navigator-ui.ts";

const PERM_ICON_CONFIG = `# Perm icon test
\`\`\`space-lua
view.define {
  name = "permIconTest",
  title = "Perm Icon Test",
  command = "Navigator: Perm Icon Test",
  dock = "modal",
  presentation = {
    mode = "list",
    row = {
      icon = function(obj)
        if obj.perm == "ro" then return "lock" end
        return "file"
      end,
    },
  },
  source = function()
    return {
      { name = "ReadOnlyRow", ref = "ReadOnlyRow", perm = "ro" },
      { name = "WritableRow", ref = "WritableRow", perm = "rw" },
    }
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}
\`\`\`
`;

// A render-phase exception, not a data-level one already caught elsewhere:
// `row.primary` here is a *number*. `highlightMatches` (row_item.tsx) short-
// circuits on an empty phrase and hands it straight back as a child --
// preact renders "42" fine, first paint. Typing a character gives it a
// phrase to search, at which point it calls `.split` on that same number and
// throws, synchronously, inside the render -- exactly the shape the NavRoot
// error boundary (Addendum 9) exists to catch.
const THROW_ON_RENDER_CONFIG = `# Throws on second render
\`\`\`space-lua
view.define {
  name = "throwsOnSecondRender",
  title = "Throws On Second Render",
  command = "Navigator: Throws On Second Render",
  dock = "modal",
  presentation = {
    mode = "list",
    row = { primary = function(obj) return obj.n end },
  },
  source = function()
    return { { name = "Row", ref = "Row", n = 42 } }
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}
\`\`\`
`;

const SPACE = {
  "index.md": "Welcome",
  "PermIconTest.md": PERM_ICON_CONFIG,
  "ThrowsOnSecondRender.md": THROW_ON_RENDER_CONFIG,
  "Projects/Alpha.md": "# Alpha\n\nSome content.\n",
  "Heading.md": "# My Heading\n\nBody text.\n",
  "Decorated.md": '---\npageDecoration:\n  prefix: "🎄 "\n---\n# Decorated\n',
  "Outline.md": "# First\n\nBody.\n\n## Second\n\nMore.\n",
  "Diagram.png": "not really a png",
};

/** Client-side navigation (unlike `gotoSilverBulletPage`, which does a real
 * HTTP navigation and would reboot the whole client, closing any open dock). */
async function navigateInApp(
  sbPage: import("@playwright/test").Page,
  ref: string,
) {
  await sbPage.evaluate(
    (r) =>
      (globalThis as any).sbRuntime.evalLua(
        `editor.navigate(${JSON.stringify(r)})`,
      ),
    ref,
  );
}

test.use({ spaceFiles: SPACE });

test("H: after picking a page, the backdrop is gone and the editor is clickable", async ({
  sbPage,
}) => {
  await openPagePicker(sbPage);
  await navInput(sbPage).fill("Projects/Alpha");
  await sbPage.keyboard.press("Enter");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  const backdrop = sbPage.locator(".sb-modal-backdrop");
  if (await backdrop.count()) {
    await expect(backdrop).toHaveCSS("display", "none");
  }

  // A click that would time out if any stray overlay intercepts it.
  await sbPage.locator("#sb-editor .cm-content").click();
  await sbPage.keyboard.type(" X");
  await expect(sbPage.locator("#sb-editor .cm-content")).toContainText(
    "Some content. X",
  );
});

function headingMarkerGeometry(sbPage: import("@playwright/test").Page) {
  return sbPage.evaluate(() => {
    const line = document.querySelector(".cm-line.sb-header-inside")!;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode()!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 1);
    const markerLeft = range.getBoundingClientRect().left;
    const editorLeft = document
      .querySelector("#sb-editor")!
      .getBoundingClientRect().left;
    const content = document.querySelector("#sb-editor .cm-content")!;
    const contentRect = content.getBoundingClientRect();
    const contentPaddingLeft = parseFloat(
      getComputedStyle(content).paddingLeft,
    );
    return {
      markerLeft,
      editorLeft,
      contentLeft: contentRect.left + contentPaddingLeft,
      textIndent: getComputedStyle(line).textIndent,
    };
  });
}

test("A: hanging heading marker stays on-screen when a dock narrows the editor", async ({
  sbPage,
  sbServer,
}) => {
  await gotoSilverBulletPage(sbPage, sbServer, "Heading");

  await runCommandViaPalette(sbPage, "Navigate: Tree");
  const lhsPanel = sbPage.locator("#sb-main .sb-nav-root-lhs");
  await expect(lhsPanel).toBeVisible();

  const handle = sbPage
    .locator("#sb-main .sb-nav-root-lhs")
    .locator(".sb-resizer-lhs");
  const handleBox = (await handle.boundingBox())!;
  await sbPage.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await sbPage.mouse.down();
  // lhs grows to the right (toward the editor).
  await sbPage.mouse.move(
    handleBox.x + 400,
    handleBox.y + handleBox.height / 2,
    { steps: 15 },
  );
  await sbPage.mouse.up();

  const editorBox = (await sbPage.locator("#sb-editor").boundingBox())!;
  expect(editorBox.width).toBeLessThan(800);

  await sbPage.locator("#sb-editor .cm-line.sb-line-h1").click();
  await expect(sbPage.locator(".cm-line.sb-header-inside")).toBeVisible();

  const narrow = await headingMarkerGeometry(sbPage);
  expect(narrow.textIndent).toBe("0px");
  expect(narrow.markerLeft).toBeGreaterThanOrEqual(narrow.editorLeft);

  // Close the dock: the editor is wide again, and the marker must still hang
  // to the left of the content column, same as before any dock ever opened.
  await sbPage
    .locator("#sb-main .sb-nav-root-lhs")
    .locator(".sb-nav-close")
    .click();
  await expect(lhsPanel).toBeHidden();

  const wide = await headingMarkerGeometry(sbPage);
  expect(parseFloat(wide.textIndent)).toBeLessThan(0);
  expect(wide.markerLeft).toBeLessThan(wide.contentLeft);
});

test("C: the top bar never scrolls, even with both docks open on a decorated page", async ({
  sbPage,
  sbServer,
}) => {
  await gotoSilverBulletPage(sbPage, sbServer, "Decorated");

  await runCommandViaPalette(sbPage, "Navigate: Tree");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
  await expect(sbPage.locator("#sb-main .sb-nav-root-lhs")).toBeVisible();
  await sbPage.locator("#sb-editor .cm-content").click();
  // Opens as a modal by default; pin it to the right sidebar so both docks
  // are open, as the test name promises.
  await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
  const outlineModal = sbPage.locator(".sb-nav-root-modal");
  await expect(outlineModal).toBeVisible();
  await outlineModal.locator(".sb-dock-button").click();
  await outlineModal
    .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
    .click();
  // Picking a dock from the modal's own menu closes it.
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
  await expect(sbPage.locator("#sb-main .sb-nav-root-rhs")).toBeVisible();

  const main = sbPage.locator("#sb-top .main");
  await expect(main).toBeVisible();
  await expect(async () => {
    const { clientHeight, scrollHeight } = await main.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  }).toPass();

  await expect(sbPage.locator("#sb-current-page")).toBeVisible();
});

test("mark highlighting does not shift a row's own geometry", async ({
  sbPage,
}) => {
  const frame = await openPagePicker(sbPage);
  const row = frame.locator(".sb-nav-row", { hasText: "Heading" }).first();
  await expect(row).toBeVisible();
  const before = (await row.boundingBox())!;
  const beforePrimary = (await row.locator(".sb-nav-primary").boundingBox())!;

  await navInput(sbPage).fill("Heading");
  const highlighted = frame
    .locator(".sb-nav-row", { hasText: "Heading" })
    .first();
  await expect(highlighted.locator("mark")).toBeVisible();
  const after = (await highlighted.boundingBox())!;
  const afterPrimary = (await highlighted
    .locator(".sb-nav-primary")
    .boundingBox())!;

  expect(after.height).toBeCloseTo(before.height, 0);
  expect(afterPrimary.height).toBeCloseTo(beforePrimary.height, 0);
  expect(afterPrimary.y - after.y).toBeCloseTo(beforePrimary.y - before.y, 0);
});

test("top-bar title left-aligns with the editor body text column", async ({
  sbPage,
  sbServer,
}) => {
  await gotoSilverBulletPage(sbPage, sbServer, "Heading");

  async function alignmentDelta() {
    const title = (await sbPage
      .locator("#sb-current-page .sb-input")
      .boundingBox())!;
    const line = (await sbPage.locator(".cm-line").first().boundingBox())!;
    return Math.abs(title.x - line.x);
  }

  await sbPage.setViewportSize({ width: 1280, height: 800 });
  expect(await alignmentDelta()).toBeLessThanOrEqual(1);

  await sbPage.setViewportSize({ width: 900, height: 800 });
  expect(await alignmentDelta()).toBeLessThanOrEqual(1);

  await runCommandViaPalette(sbPage, "Navigate: Tree");
  await expect(sbPage.locator("#sb-main .sb-nav-root-lhs")).toBeVisible();
  expect(await alignmentDelta()).toBeLessThanOrEqual(1);
});

test("fresh client: first modal open is paint-gated (records the pending->settled transition), later opens are instant", async ({
  sbPage,
  sbServer,
}) => {
  await gotoSilverBulletPage(sbPage, sbServer, "");

  // The modal only exists while it is open, so this watches for it appearing
  // and records every change of its gate state from then on.
  await sbPage.evaluate(() => {
    const w = window as unknown as { __classLog: boolean[] };
    w.__classLog = [];
    const record = () => {
      const el = document.querySelector(".sb-modal");
      if (!el) return;
      const pending = el.classList.contains("sb-modal-paint-pending");
      if (w.__classLog[w.__classLog.length - 1] !== pending) {
        w.__classLog.push(pending);
      }
    };
    new MutationObserver(record).observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    });
  });

  await sbPage.keyboard.press(`${mod}+k`);
  await sbPage.waitForFunction(() => {
    const el = document.querySelector(".sb-modal");
    return !!el && !el.classList.contains("sb-modal-paint-pending");
  });

  const frame = sbPage.locator(".sb-nav-root-modal");
  await expect(frame.locator(".sb-nav-row").first()).toBeVisible({
    timeout: 500,
  });

  const classLog = await sbPage.evaluate(
    () => (window as unknown as { __classLog: boolean[] }).__classLog,
  );
  const pendingIndex = classLog.indexOf(true);
  expect(pendingIndex).toBeGreaterThanOrEqual(0);
  expect(classLog.slice(pendingIndex).some((p) => !p)).toBe(true);
  expect(classLog[classLog.length - 1]).toBe(false);

  const box1 = (await sbPage.locator(".sb-modal").boundingBox())!;
  await sbPage.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
  await sbPage.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
  const box2 = (await sbPage.locator(".sb-modal").boundingBox())!;
  expect(Math.abs(box2.height - box1.height)).toBeLessThan(1);

  await sbPage.keyboard.press("Escape");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  await sbPage.keyboard.press(`${mod}+k`);
  await sbPage.waitForFunction(() => {
    const el = document.querySelector(".sb-modal");
    return !!el && !el.classList.contains("sb-modal-paint-pending");
  });
});

test("a view that never signals ready reveals only once the fallback timeout elapses, not sooner", async ({
  sbPage,
  sbServer,
}) => {
  await gotoSilverBulletPage(sbPage, sbServer, "");

  // A view whose rows never arrive never has anything to signal ready with,
  // so only the fallback timeout can reveal it. Installed on the slot's
  // engine as it is created, since the modal has never been opened yet.
  await sbPage.evaluate(() => {
    const engines = (globalThis as any).__navigatorEngines;
    const origSet = engines.set.bind(engines);
    engines.set = (slot: string, engine: any) => {
      if (slot === "modal") {
        const orig = engine.runHook;
        engine.runHook = (data: any) =>
          data.hook === "rows" ? new Promise(() => {}) : orig(data);
      }
      return origSet(slot, engine);
    };
  });

  const pending = () =>
    expect(sbPage.locator(".sb-modal")).toHaveClass(/sb-modal-paint-pending/);

  const openStart = Date.now();
  await sbPage.keyboard.press(`${mod}+k`);
  await sbPage.waitForTimeout(200);
  await pending();

  await expect(async () => {
    await expect(sbPage.locator(".sb-modal")).not.toHaveClass(
      /sb-modal-paint-pending/,
    );
  }).toPass({ timeout: 3_000 });
  expect(Date.now() - openStart).toBeGreaterThanOrEqual(750);
});

test("E: the outline empties on a document instead of keeping the previous page's headers", async ({
  sbPage,
  sbServer,
}) => {
  await gotoSilverBulletPage(sbPage, sbServer, "Outline");
  // Opens as a modal by default; pin it to the right sidebar so it stays
  // open (and refreshes) across the navigations this test drives below.
  await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
  const outlineModal = sbPage.locator(".sb-nav-root-modal");
  await expect(outlineModal).toBeVisible();
  await outlineModal.locator(".sb-dock-button").click();
  await outlineModal
    .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
    .click();
  // Picking a dock from the modal's own menu closes it.
  await expect(outlineModal).toHaveCount(0);
  await expect(sbPage.locator("#sb-main .sb-nav-root-rhs")).toBeVisible();

  const frame = sbPage.locator("#sb-main .sb-nav-root-rhs");
  await expect(frame.getByText("First", { exact: true })).toBeVisible();
  await expect(frame.getByText("Second", { exact: true })).toBeVisible();

  await navigateInApp(sbPage, "Diagram.png");
  await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Diagram.png",
  );
  await expect(frame.locator(".sb-nav-empty")).toBeVisible();
  await expect(frame.getByText("First", { exact: true })).toBeHidden();
  await expect(frame.getByText("Second", { exact: true })).toBeHidden();

  await navigateInApp(sbPage, "Outline");
  await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
    "Outline",
  );
  await expect(frame.getByText("First", { exact: true })).toBeVisible();
  await expect(frame.getByText("Second", { exact: true })).toBeVisible();
});

test("F: a perm=ro row renders a distinct (lock) icon from a normal row", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigator: Perm Icon Test");
  const frame = sbPage.locator(".sb-nav-root-modal");

  const roIcon = frame
    .locator(".sb-nav-row", { hasText: "ReadOnlyRow" })
    .locator(".sb-nav-icon svg");
  const rwIcon = frame
    .locator(".sb-nav-row", { hasText: "WritableRow" })
    .locator(".sb-nav-icon svg");
  await expect(roIcon).toBeVisible();
  await expect(rwIcon).toBeVisible();

  // Feather's resolved SVGs carry no class or title naming the icon --
  // compare the markup itself (the lock glyph's shackle path is distinctive).
  const [roMarkup, rwMarkup] = await Promise.all([
    roIcon.evaluate((el) => el.outerHTML),
    rwIcon.evaluate((el) => el.outerHTML),
  ]);
  expect(roMarkup).not.toEqual(rwMarkup);
  expect(roMarkup).toContain("M7 11V7a5 5 0 0 1 10 0v4");
  expect(rwMarkup).not.toContain("M7 11V7a5 5 0 0 1 10 0v4");
});

test("G: the space tree dock reads 'Open' with a segment-dependent placeholder", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigate: Tree");
  const frame = sbPage.locator("#sb-main .sb-nav-root-lhs");

  await expect(frame.locator(".sb-nav-title")).toHaveText("Open");
  // "All" is std.spaceTree's default segment.
  await expect(navSegment(frame, "All")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Page or document",
  );

  await navSegment(frame, "Pages").click();
  await expect(navSegment(frame, "Pages")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Page",
  );

  await navSegment(frame, "Documents").click();
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Document",
  );

  await navSegment(frame, "Meta").click();
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Meta page",
  );
});

test("I: Cmd-/ reaches the host from a dock's filter input; native editing chords stay local; Cmd-o toggle still wins", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigate: Tree");
  const frame = sbPage.locator("#sb-main .sb-nav-root-lhs");
  const input = frame.locator("input.sb-nav-input");
  await expect(input).toBeFocused();

  // Cmd-A/Cmd-C are native input-editing chords: the browser's own select-all
  // applies in the filter input, and no command claims them out from under it.
  await input.fill("Projects");
  await sbPage.keyboard.press(`${mod}+a`);
  await sbPage.keyboard.type("Q");
  await expect(input).toHaveValue("Q");

  // An unclaimed chord (Cmd-/) reaches the client's global shortcut path even
  // though the dock's own input still has focus.
  await sbPage.keyboard.press(`${mod}+/`);
  const paletteFrame = sbPage.locator(".sb-nav-root-modal");
  await expect(paletteFrame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Command",
    { timeout: 20_000 },
  );
  // Drawn is not focused: Escape before the palette has taken focus would
  // reach the dock this was forwarded from and close *that* instead.
  await expectNavInputFocused(sbPage);
  await sbPage.keyboard.press("Escape");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  // Cmd-o still toggles the tree closed. Where focus landed once the palette
  // closed is not the point of this test, so rather than a click (which can
  // still race the backdrop's own hide transition -- see item H's note on that
  // exact shape) this refocuses the still-open dock the same way a user would:
  // pressing its own opener again re-focuses an open-but-unfocused dock
  // (`activateShow`'s fall-through, unlike the focused -> close case a second
  // press then hits).
  await sbPage.keyboard.press(`${mod}+o`);
  await expect(input).toBeFocused();
  await sbPage.keyboard.press(`${mod}+o`);
  await expect(sbPage.locator(".sb-nav-root-lhs")).toBeHidden();
});

/** Arms a spy recording whether the *next* keydown had its default prevented
 * -- read back with `readDefaultPrevented`. Registered (and awaited) before
 * the key is pressed, so there is no race between "the listener exists" and
 * "the key fires". */
async function armDefaultPreventedSpy(input: ReturnType<typeof navInput>) {
  await input.evaluate((el) => {
    (window as any).__lastKeydownPrevented = undefined;
    // Capture phase, and registered after the client's own capture-phase
    // handler (which claims Cmd-O and stops it propagating), so this observes
    // the default state the app leaves behind rather than missing the event.
    el.ownerDocument.defaultView!.addEventListener(
      "keydown",
      (e) => {
        (window as any).__lastKeydownPrevented = e.defaultPrevented;
      },
      true,
    );
  });
}

async function readDefaultPrevented(input: ReturnType<typeof navInput>) {
  return await input.evaluate(() => (window as any).__lastKeydownPrevented);
}

test("K: a host-bound chord forwarded from a dock with no local claim fires its command exactly once, with no browser default", async ({
  sbPage,
}) => {
  // Opens as a modal by default; pin it to the right sidebar.
  await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
  const outlineModal = sbPage.locator(".sb-nav-root-modal");
  await expect(outlineModal).toBeVisible();
  await outlineModal.locator(".sb-dock-button").click();
  await outlineModal
    .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
    .click();
  // Picking a dock from the modal's own menu closes it, and moveDock's own
  // re-open at the new dock focuses it -- this test's own subject, forwarding
  // a chord typed into a dock's input, needs that focus to start there.
  await expect(outlineModal).toHaveCount(0);
  const outlineFrame = sbPage.locator("#sb-main .sb-nav-root-rhs");
  const outlineInput = outlineFrame.locator("input.sb-nav-input");
  await expect(outlineInput).toBeFocused();

  // Cmd-o from a dock that doesn't claim it reaches the client's own binding:
  // "Navigate: Tree" is a real command for it, with a browser default (Cmd-o,
  // Safari's Open File) that must not fire alongside it.
  await armDefaultPreventedSpy(outlineInput);
  await sbPage.keyboard.press(`${mod}+o`);
  expect(await readDefaultPrevented(outlineInput)).toBe(true);

  // And the command fired exactly once: the tree opened, not toggled
  // open-then-closed by a duplicate dispatch racing the forward.
  const treeFrame = sbPage.locator("#sb-main .sb-nav-root-lhs");
  await expect(treeFrame.locator("input.sb-nav-input")).toBeVisible({
    timeout: 20_000,
  });
  await expect(sbPage.locator(".sb-nav-root-lhs")).toBeVisible();
});

test("L: an unbound Cmd-chord from a dock input is never prevented, so it still reaches the browser", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigate: Tree");
  const frame = sbPage.locator("#sb-main .sb-nav-root-lhs");
  const input = frame.locator("input.sb-nav-input");
  await expect(input).toBeFocused();

  // Nothing in this app binds Cmd-j: forwarding it must not preventDefault,
  // so it stays a no-op locally the same way it would over the editor.
  await armDefaultPreventedSpy(input);
  await sbPage.keyboard.press(`${mod}+j`);
  expect(await readDefaultPrevented(input)).toBe(false);
});

test("D: drag-resize survives Plugs: Reload", async ({ sbPage }) => {
  await sbPage.evaluate(() => {
    const client = (globalThis as any).client;
    (globalThis as any).__pluginsReloaded = false;
    const orig = client.dispatchAppEvent.bind(client);
    client.dispatchAppEvent = (name: string, ...args: unknown[]) => {
      if (name === "plugs:loaded") (globalThis as any).__pluginsReloaded = true;
      return orig(name, ...args);
    };
  });

  await runCommandViaPalette(sbPage, "Navigate: Tree");
  const panel = sbPage.locator("#sb-main .sb-nav-root-lhs");
  await expect(panel).toBeVisible();

  async function dragBy(deltaX: number) {
    const handle = sbPage
      .locator("#sb-main .sb-nav-root-lhs")
      .locator(".sb-resizer-lhs");
    const box = (await handle.boundingBox())!;
    await sbPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sbPage.mouse.down();
    // lhs grows to the right.
    await sbPage.mouse.move(
      box.x + box.width / 2 + deltaX,
      box.y + box.height / 2,
      { steps: 15 },
    );
    await sbPage.mouse.up();
  }

  const before = (await panel.boundingBox())!.width;
  await dragBy(80);
  await expect(async () => {
    expect((await panel.boundingBox())!.width).toBeGreaterThan(before + 40);
  }).toPass();

  await sbPage.locator("#sb-editor .cm-content").click();
  await runCommandViaPalette(sbPage, "Plugs: Reload");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
  await sbPage.waitForFunction(
    () => (globalThis as any).__pluginsReloaded === true,
    { timeout: 20_000 },
  );

  // The dock's DOM was never touched by the reload -- it's still up.
  await expect(panel).toBeVisible();

  const afterReload = (await panel.boundingBox())!.width;
  await dragBy(80);
  await expect(async () => {
    expect((await panel.boundingBox())!.width).toBeGreaterThan(
      afterReload + 40,
    );
  }).toPass();

  const widened = (await panel.boundingBox())!.width;

  await sbPage
    .locator("#sb-main .sb-nav-root-lhs")
    .locator(".sb-nav-close")
    .click();
  await expect(panel).toBeHidden();
  await runCommandViaPalette(sbPage, "Navigate: Tree");
  await expect(panel).toBeVisible();
  const restored = (await panel.boundingBox())!.width;
  expect(Math.abs(restored - widened)).toBeLessThan(10);

  await sbPage.locator("#sb-editor .cm-content").click();

  // Opens as a modal by default; pin it to the right sidebar.
  await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
  const outlineModal = sbPage.locator(".sb-nav-root-modal");
  await expect(outlineModal).toBeVisible();
  await outlineModal.locator(".sb-dock-button").click();
  await outlineModal
    .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
    .click();
  // Picking a dock from the modal's own menu closes it.
  await expect(outlineModal).toHaveCount(0);
  await expect(sbPage.locator("#sb-main .sb-nav-root-rhs")).toBeVisible();
});

test("M8: reopening a modal view is still prompt after Plugs: Reload resets the activation token counter", async ({
  sbPage,
}) => {
  await sbPage.evaluate(() => {
    const client = (globalThis as any).client;
    (globalThis as any).__pluginsReloaded = false;
    const orig = client.dispatchAppEvent.bind(client);
    client.dispatchAppEvent = (name: string, ...args: unknown[]) => {
      if (name === "plugs:loaded") (globalThis as any).__pluginsReloaded = true;
      return orig(name, ...args);
    };
  });

  // "Navigate: Table of Contents" (std.toc has no persisted dock preference
  // here, so this opens as a modal) stands in for "some command that
  // reliably opens a modal view" -- the activation-token behavior under
  // test isn't specific to the outline.
  await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
  await expectNavInputFocused(sbPage);
  await sbPage.keyboard.press("Escape");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  await runCommandViaPalette(sbPage, "Plugs: Reload");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
  await sbPage.waitForFunction(
    () => (globalThis as any).__pluginsReloaded === true,
    { timeout: 20_000 },
  );
  await sbPage.waitForTimeout(300);

  await sbPage.evaluate(() =>
    (globalThis as any).client.runCommandByName("Navigate: Table of Contents"),
  );
  // Reaching a settled (non-paint-pending) modal at all is the assertion; the
  // test's own timeout is the budget.
  await sbPage.waitForFunction(() => {
    const el = document.querySelector(".sb-modal");
    return !!el && !el.classList.contains("sb-modal-paint-pending");
  });
});

// C2 (single-registry consolidation): the navigator's registry is client-side
// state now, so `Plugs: Reload` -- which rebuilds the plug workers and does
// not re-run Space Lua -- has nothing to take away from it.
test("N: a Space Lua-defined view's meta still resolves after Plugs: Reload", async ({
  sbPage,
}) => {
  // Opening it *is* the resolution: `view.open` answers false for a view
  // the registry can't resolve (quiet, so a miss doesn't flash a notification).
  async function resolvesMeta(): Promise<boolean> {
    const opened = await sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua(
        `view.open("permIconTest", { quiet = true })`,
      ),
    );
    if (opened) {
      await sbPage.keyboard.press("Escape");
      await expect(sbPage.locator(".sb-modal")).toBeHidden();
    }
    return opened === true;
  }

  // The fixture page defining `permIconTest` may not have finished indexing
  // the instant the client is ready.
  await expect.poll(() => resolvesMeta(), { timeout: 20_000 }).toBe(true);

  await runCommandViaPalette(sbPage, "Plugs: Reload");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  await expect.poll(() => resolvesMeta(), { timeout: 20_000 }).toBe(true);
});

test("J: a render-phase exception on the second render shows the fatal-error banner instead of freezing the panel", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigator: Throws On Second Render");
  const frame = navFrame(sbPage);

  await expect(navRows(frame)).toHaveText("42");

  const errors: string[] = [];
  sbPage.on("pageerror", (e) => errors.push(e.message));

  await navInput(sbPage).fill("4");

  await expect(frame.locator(".sb-nav-error")).toBeVisible({
    timeout: 5_000,
  });
  await expect(frame.locator(".sb-nav-error")).toContainText(
    /split is not a function/i,
  );
  // The frozen-panel incident this addendum exists for: the filter input is
  // gone, replaced by the boundary's own fallback markup -- not still on
  // screen silently swallowing keystrokes that go nowhere.
  await expect(navInput(sbPage)).toHaveCount(0);
  // Caught, not escaped to the page: a boundary-less crash would re-throw
  // out of preact's own render loop as a real uncaught exception -- and it
  // would now take the whole editor's render down with it.
  expect(errors).toEqual([]);
});
