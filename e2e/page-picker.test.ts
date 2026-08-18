import { expect, test } from "./fixtures.ts";
import {
  currentPage,
  navInput,
  navRows,
  openPagePicker,
} from "./navigator-ui.ts";

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
    const frame = await openPagePicker(sbPage);
    const input = navInput(sbPage);
    await input.fill("Fruit");

    const selected = frame.locator(
      ".sb-nav-row.sb-nav-selected .sb-nav-primary",
    );
    await expect(selected).toBeVisible({ timeout: 20_000 });
    const first = (await selected.innerText()).trim();

    await input.press("ArrowDown");
    const second = (await selected.innerText()).trim();
    expect(second).not.toBe(first);

    await input.press("Control+p");
    expect((await selected.innerText()).trim()).toBe(first);

    await input.press("Control+n");
    expect((await selected.innerText()).trim()).toBe(second);

    // Escape closes the picker immediately, even with a phrase typed.
    await input.press("Escape");
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
  });

  test("Enter opens the selected page", async ({ sbPage }) => {
    const frame = await openPagePicker(sbPage);
    await navInput(sbPage).fill("Fruit Cherry");
    await expect(navRows(frame).first()).toHaveText("Fruit Cherry", {
      timeout: 20_000,
    });
    await sbPage.keyboard.press("Enter");
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
    await expect(currentPage(sbPage)).toHaveValue("Fruit Cherry");
  });

  test("Alt-Space completes the next path segment", async ({ sbPage }) => {
    await openPagePicker(sbPage);
    const input = navInput(sbPage);
    await input.fill("Projects");
    await input.press("Alt+ ");
    await expect(input).toHaveValue("Projects/Alpha");
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
    const frame = await openPagePicker(sbPage);
    const input = navInput(sbPage);

    await input.press("$");
    await expect(input).toHaveAttribute("placeholder", "Anchor");

    // Anchors are indexed asynchronously on first load, so lean on
    // Playwright's auto-retry here rather than a fixed wait. The rows are
    // named bare -- the `$` is the row icon's job.
    await expect(navRows(frame).filter({ hasText: "rent" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(navRows(frame).filter({ hasText: "spark" })).toBeVisible();

    // Pages must be gone while in anchor mode. (The page an anchor lives on
    // is its description, so this asks the row *names* specifically.)
    await expect(navRows(frame).filter({ hasText: "Finances" })).toHaveCount(0);

    await input.fill("rent");
    await expect(navRows(frame).filter({ hasText: "spark" })).toHaveCount(0);

    await sbPage.keyboard.press("Enter");
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
    await expect(currentPage(sbPage)).toHaveValue("Finances");
  });

  test("deleting the $ restores the page list", async ({ sbPage }) => {
    const frame = await openPagePicker(sbPage);
    const input = navInput(sbPage);

    await input.press("$");
    await expect(navRows(frame).filter({ hasText: "rent" })).toBeVisible({
      timeout: 20_000,
    });

    // Backspace on an empty phrase steps back to the invoking view.
    await input.press("Backspace");
    await expect(input).toHaveAttribute("placeholder", "Page");
    await expect(navRows(frame).filter({ hasText: "Finances" })).toBeVisible();
    await expect(navRows(frame).filter({ hasText: "rent" })).toHaveCount(0);
  });
});

test.describe("Page picker anchor mode with a duplicate anchor name", () => {
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
    const frame = await openPagePicker(sbPage);
    // A pasted phrase routes on its `$` and carries the rest across.
    await navInput(sbPage).fill("$dup");
    await expect(navInput(sbPage)).toHaveAttribute("placeholder", "Anchor");

    // Both duplicate-named anchors get their own row, distinguished by the
    // host page shown in the description.
    const rows = frame.locator(".sb-nav-row");
    const betaRow = rows.filter({ hasText: "Beta" });
    const alphaRow = rows.filter({ hasText: "Alpha" });
    await expect(betaRow).toBeVisible({ timeout: 20_000 });
    await expect(alphaRow).toBeVisible();
    await expect(rows).toHaveCount(2);

    // Pick the Beta row specifically.
    await betaRow.click();

    // A bare (non-page-qualified) ref would trip the "Duplicate anchor"
    // error path and never navigate anywhere. Landing on Beta confirms the
    // picker qualified the ref with the page the clicked row belongs to.
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
    await expect(currentPage(sbPage)).toHaveValue("Beta");
  });
});
