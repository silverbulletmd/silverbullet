import { expect, gotoSilverBulletPage, mod, test } from "./fixtures.ts";
import {
  expectNavInputFocused,
  navInput,
  navSegment,
  openPagePicker,
  runCommandViaPalette,
} from "./navigator-ui.ts";

const PERM_ICON_CONFIG = `# Perm icon test
\`\`\`space-lua
navigator.define {
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
}
\`\`\`
`;

const SPACE = {
  "index.md": "Welcome",
  "PermIconTest.md": PERM_ICON_CONFIG,
  "Projects/Alpha.md": "# Alpha\n\nSome content.\n",
  "Heading.md": "# My Heading\n\nBody text.\n",
  "Decorated.md": "---\npageDecoration:\n  prefix: \"🎄 \"\n---\n# Decorated\n",
  "Outline.md": "# First\n\nBody.\n\n## Second\n\nMore.\n",
  "Diagram.png": "not really a png",
};

/** Client-side navigation (unlike `gotoSilverBulletPage`, which does a real
 * HTTP navigation and would reboot the whole client, closing any open dock). */
async function navigateInApp(sbPage: import("@playwright/test").Page, ref: string) {
  await sbPage.evaluate(
    (r) => (globalThis as any).sbRuntime.evalLua(`editor.navigate(${JSON.stringify(r)})`),
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

  await runCommandViaPalette(sbPage, "Navigator: Tree");
  const lhsPanel = sbPage.locator("#sb-main .sb-keyed-panel-lhs");
  await expect(lhsPanel).toBeVisible();

  const handle = sbPage
    .frameLocator("#sb-main .sb-keyed-panel-lhs iframe")
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
    .frameLocator("#sb-main .sb-keyed-panel-lhs iframe")
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

  await runCommandViaPalette(sbPage, "Navigator: Tree");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
  await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeVisible();
  await sbPage.locator("#sb-editor .cm-content").click();
  await runCommandViaPalette(sbPage, "Navigator: Table of Contents");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
  await expect(sbPage.locator("#sb-main .sb-keyed-panel-rhs")).toBeVisible();

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
  const highlighted = frame.locator(".sb-nav-row", { hasText: "Heading" }).first();
  await expect(highlighted.locator("mark")).toBeVisible();
  const after = (await highlighted.boundingBox())!;
  const afterPrimary = (await highlighted.locator(".sb-nav-primary").boundingBox())!;

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

  await runCommandViaPalette(sbPage, "Navigator: Tree");
  await expect(sbPage.locator("#sb-main .sb-keyed-panel-lhs")).toBeVisible();
  expect(await alignmentDelta()).toBeLessThanOrEqual(1);
});

test("fresh client: first modal open is paint-gated (records the pending->settled transition), later opens are instant", async ({
  sbPage,
  sbServer,
}) => {
  await gotoSilverBulletPage(sbPage, sbServer, "");

  await sbPage.evaluate(() => {
    const el = document.querySelector(".sb-modal")!;
    const w = window as unknown as { __classLog: boolean[] };
    w.__classLog = [el.classList.contains("sb-modal-paint-pending")];
    new MutationObserver(() => {
      w.__classLog.push(el.classList.contains("sb-modal-paint-pending"));
    }).observe(el, { attributes: true, attributeFilter: ["class"] });
  });

  const firstOpenStart = Date.now();
  await sbPage.keyboard.press(`${mod}+k`);
  await sbPage.waitForFunction(() => {
    const el = document.querySelector(".sb-modal");
    return !!el && !el.classList.contains("sb-modal-paint-pending");
  });
  const firstOpenLatency = Date.now() - firstOpenStart;

  const frame = sbPage.frameLocator(".sb-modal iframe");
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

  expect(firstOpenLatency).toBeLessThan(1500);

  await sbPage.keyboard.press("Escape");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  const secondOpenStart = Date.now();
  await sbPage.keyboard.press(`${mod}+k`);
  await sbPage.waitForFunction(() => {
    const el = document.querySelector(".sb-modal");
    return !!el && !el.classList.contains("sb-modal-paint-pending");
  });
  const secondOpenLatency = Date.now() - secondOpenStart;
  expect(secondOpenLatency).toBeLessThan(200);
});

test("a view that never signals ready reveals only once the fallback timeout elapses, not sooner", async ({
  sbPage,
  sbServer,
}) => {
  await gotoSilverBulletPage(sbPage, sbServer, "");

  await sbPage.evaluate(() => {
    const clientSystem = (globalThis as any).client.clientSystem;
    const real = clientSystem.localSyscall.bind(clientSystem);
    clientSystem.localSyscall = (name: string, args: unknown[]) =>
      name === "editor.panelReady" ? Promise.resolve(undefined) : real(name, args);
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
  await runCommandViaPalette(sbPage, "Navigator: Table of Contents");
  await expect(sbPage.locator("#sb-main .sb-keyed-panel-rhs")).toBeVisible();

  const frame = sbPage.frameLocator("#sb-main .sb-keyed-panel-rhs iframe");
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
  const frame = sbPage.frameLocator(".sb-modal iframe");

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
  await runCommandViaPalette(sbPage, "Navigator: Tree");
  const frame = sbPage.frameLocator("#sb-main .sb-keyed-panel-lhs iframe");

  await expect(frame.locator(".sb-nav-title")).toHaveText("Open");
  // "All" is std.spaceTree's default segment.
  await expect(navSegment(frame, "All")).toHaveAttribute("aria-checked", "true");
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

  await navSegment(frame, "Meta").click();
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Meta page",
  );

  await navSegment(frame, "Docs").click();
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    "Document",
  );
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

  await runCommandViaPalette(sbPage, "Navigator: Tree");
  const panel = sbPage.locator("#sb-main .sb-keyed-panel-lhs");
  await expect(panel).toBeVisible();

  async function dragBy(deltaX: number) {
    const handle = sbPage
      .frameLocator("#sb-main .sb-keyed-panel-lhs iframe")
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
    .frameLocator("#sb-main .sb-keyed-panel-lhs iframe")
    .locator(".sb-nav-close")
    .click();
  await expect(panel).toBeHidden();
  await runCommandViaPalette(sbPage, "Navigator: Tree");
  await expect(panel).toBeVisible();
  const restored = (await panel.boundingBox())!.width;
  expect(Math.abs(restored - widened)).toBeLessThan(10);

  await sbPage.locator("#sb-editor .cm-content").click();

  await runCommandViaPalette(sbPage, "Navigator: Table of Contents");
  await expect(sbPage.locator("#sb-main .sb-keyed-panel-rhs")).toBeVisible();
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

  await runCommandViaPalette(sbPage, "Navigator: Outline Picker");
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

  const start = Date.now();
  await sbPage.evaluate(() =>
    (globalThis as any).client.runCommandByName(
      "Navigator: Outline Picker",
    )
  );
  await sbPage.waitForFunction(() => {
    const el = document.querySelector(".sb-modal");
    return !!el && !el.classList.contains("sb-modal-paint-pending");
  });
  const latency = Date.now() - start;
  expect(latency).toBeLessThan(400);
});
