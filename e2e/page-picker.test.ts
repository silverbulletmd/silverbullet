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
