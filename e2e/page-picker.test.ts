import { expect, mod, test } from "./fixtures.ts";

test.describe("Page picker keyboard control", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome to the wondrous world of SilverBullet",
      "Fruit Apple.md": "apple",
      "Fruit Banana.md": "banana",
      "Fruit Cherry.md": "cherry",
      "Fruit Date.md": "date",
      "Projects/Alpha/One.md": "one",
      "Projects/Alpha/Two.md": "two",
    },
  });

  test("arrow + Ctrl-n/Ctrl-p move the selection", async ({ sbPage }) => {
    await sbPage.keyboard.press(`${mod}+k`);
    const modal = sbPage.locator(".sb-modal-box");
    await expect(modal).toBeVisible();

    const input = modal.locator("input.sb-input");
    await input.click();
    await sbPage.keyboard.type("Fruit", { delay: 30 });

    const selected = modal.locator(".sb-option.sb-selected-option .sb-name");
    await expect(selected).toBeVisible();
    const first = (await selected.innerText()).trim();

    await sbPage.keyboard.press("ArrowDown");
    const second = (await selected.innerText()).trim();
    expect(second).not.toBe(first);

    await sbPage.keyboard.press("Control+p");
    expect((await selected.innerText()).trim()).toBe(first);

    await sbPage.keyboard.press("Control+n");
    expect((await selected.innerText()).trim()).toBe(second);

    await sbPage.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
  });

  test("Enter opens the selected page", async ({ sbPage }) => {
    await sbPage.keyboard.press(`${mod}+k`);
    const modal = sbPage.locator(".sb-modal-box");
    const input = modal.locator("input.sb-input");
    await input.click();
    await sbPage.keyboard.type("Fruit Cherry", { delay: 30 });
    await sbPage.keyboard.press("Enter");
    await expect(modal).not.toBeVisible();
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Fruit Cherry",
    );
  });

  test("Alt-Space completes the next path segment", async ({ sbPage }) => {
    await sbPage.keyboard.press(`${mod}+k`);
    const modal = sbPage.locator(".sb-modal-box");
    const input = modal.locator("input.sb-input");
    await input.click();
    await sbPage.keyboard.type("Projects", { delay: 30 });
    await sbPage.keyboard.press("Alt+Space");
    await expect(input).toHaveValue("Projects/Alpha");
    await sbPage.keyboard.press("Escape");
  });
});

test.describe("Page picker anchor mode", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome to the wondrous world of SilverBullet",
      "Finances.md": "- [ ] $rent Pay rent by the 1st\n",
      "Ideas.md": "A paragraph holding $spark in it.\n",
    },
  });

  test("$ switches to anchors and Enter navigates there", async ({
    sbPage,
  }) => {
    await sbPage.keyboard.press(`${mod}+k`);
    const modal = sbPage.locator(".sb-modal-box");
    await expect(modal).toBeVisible();

    const input = modal.locator("input.sb-input");
    await input.click();
    await sbPage.keyboard.type("$", { delay: 30 });

    // Anchors are indexed asynchronously on first load, so lean on
    // Playwright's auto-retry here rather than a fixed wait.
    const names = modal.locator(".sb-option .sb-name");
    await expect(names.filter({ hasText: "$rent" })).toBeVisible();
    await expect(names.filter({ hasText: "$spark" })).toBeVisible();

    // Pages must be gone while in anchor mode.
    await expect(names.filter({ hasText: "Finances" })).toHaveCount(0);

    await sbPage.keyboard.type("rent", { delay: 30 });
    await expect(names.filter({ hasText: "$spark" })).toHaveCount(0);

    await sbPage.keyboard.press("Enter");
    await expect(modal).not.toBeVisible();
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Finances",
    );
  });

  // Added after Task 3's review: the allowNew gate's negative case had no
  // dynamic coverage. The existing e2e Shift-Enter tests all run in page
  // mode, where allowNew is true and behaviour is unchanged by design.
  test("Shift-Enter does not create a page where allowNew is false", async ({
    sbPage,
  }) => {
    await sbPage.keyboard.press(`${mod}+k`);
    const modal = sbPage.locator(".sb-modal-box");
    const input = modal.locator("input.sb-input");
    await input.click();

    // Two "^" presses cycle page -> meta -> document. Document mode passes
    // allowNew={false}, which is the path under test. Each press tears down
    // and re-creates the picker (see onModeSwitch in editor_ui.tsx), so we
    // wait for the intermediate mode's placeholder — via Playwright's
    // auto-retrying expect, not a fixed sleep — and re-focus the freshly
    // mounted input before sending the next "^".
    await sbPage.keyboard.type("^", { delay: 30 });
    await expect(input).toHaveAttribute("placeholder", "#meta page");
    await input.click();
    await sbPage.keyboard.type("^", { delay: 30 });
    await expect(input).toHaveAttribute("placeholder", "Document");

    await sbPage.keyboard.type("Definitely New Page", { delay: 30 });
    await sbPage.keyboard.press("Shift+Enter");

    // Before the allowNew gate this synthesised a page option and created
    // the page. It must now do nothing but close.
    await expect(modal).not.toBeVisible();
    await expect(
      sbPage.locator("#sb-current-page input.sb-input"),
    ).not.toHaveValue("Definitely New Page");
  });

  test("deleting the $ restores the page list", async ({ sbPage }) => {
    await sbPage.keyboard.press(`${mod}+k`);
    const modal = sbPage.locator(".sb-modal-box");
    const input = modal.locator("input.sb-input");
    await input.click();

    await sbPage.keyboard.type("$", { delay: 30 });
    const names = modal.locator(".sb-option .sb-name");
    await expect(names.filter({ hasText: "$rent" })).toBeVisible();

    await sbPage.keyboard.press("Backspace");
    await expect(names.filter({ hasText: "Finances" })).toBeVisible();
    await expect(names.filter({ hasText: "$rent" })).toHaveCount(0);

    await sbPage.keyboard.press("Escape");
  });
});

test.describe("Page picker anchor mode with a duplicate anchor name", () => {
  // Two pages deliberately carry the same anchor name. The indexer doesn't
  // enforce uniqueness (lint does, at edit time), so both stay indexed and
  // both show up as separate rows here. This is the whole justification for
  // navigating via a page-qualified ref ({path, details: {type: "anchor",
  // name}}) instead of a bare `$name` ref: a bare ref would hit the
  // "Duplicate anchor" error path instead of navigating anywhere.
  test.use({
    spaceFiles: {
      "index.md": "Welcome to the wondrous world of SilverBullet",
      "Alpha.md": "A paragraph holding $dup in it.\n",
      "Beta.md": "A paragraph holding $dup in it.\n",
    },
  });

  test("picking one of two duplicate-named anchor rows navigates to that specific page", async ({
    sbPage,
  }) => {
    await sbPage.keyboard.press(`${mod}+k`);
    const modal = sbPage.locator(".sb-modal-box");
    await expect(modal).toBeVisible();

    const input = modal.locator("input.sb-input");
    await input.click();
    await sbPage.keyboard.type("$dup", { delay: 30 });

    // Both duplicate-named anchors get their own row, distinguished by the
    // host page shown in the description.
    const options = modal.locator(".sb-option");
    const betaOption = options.filter({ hasText: "Beta" });
    const alphaOption = options.filter({ hasText: "Alpha" });
    await expect(betaOption).toBeVisible();
    await expect(alphaOption).toBeVisible();
    await expect(options).toHaveCount(2);

    // Pick the Beta row specifically.
    await betaOption.click();

    // A bare (non-page-qualified) ref would trip the "Duplicate anchor"
    // error path and never navigate anywhere. Landing on Beta confirms the
    // picker qualified the ref with the page the clicked row belongs to.
    await expect(modal).not.toBeVisible();
    await expect(
      sbPage.locator("#sb-current-page input.sb-input"),
    ).toHaveValue("Beta");
  });
});
