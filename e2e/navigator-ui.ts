import type { FrameLocator, Page } from "@playwright/test";
import { expect, mod } from "./fixtures.ts";

/** The navigator modal's iframe -- the dock every built-in picker opens in. */
export const NAV_MODAL_IFRAME = ".sb-modal iframe";

export function navFrame(page: Page): FrameLocator {
  return page.frameLocator(NAV_MODAL_IFRAME);
}

export function navInput(page: Page) {
  return navFrame(page).locator("input.sb-nav-input");
}

export function navRows(frame: FrameLocator) {
  return frame.locator(".sb-nav-row .sb-nav-primary");
}

export function navSegment(frame: FrameLocator, label: string) {
  return frame.locator(`.sb-segment[aria-label^="${label}"]`);
}

export function currentPage(page: Page) {
  return page.locator("#sb-current-page input.sb-input");
}

export async function openPicker(
  page: Page,
  key: string,
  placeholder: string,
): Promise<FrameLocator> {
  await page.keyboard.press(key);
  const frame = navFrame(page);
  await expect(frame.locator("input.sb-nav-input")).toHaveAttribute(
    "placeholder",
    placeholder,
    { timeout: 20_000 },
  );
  return frame;
}

export async function expectNavRow(frame: FrameLocator, text: string) {
  await expect(
    frame.locator(".sb-nav-row", { hasText: text }).first(),
  ).toBeVisible({ timeout: 20_000 });
}

export async function expectNavInputFocused(
  page: Page,
  iframeSelector: string = NAV_MODAL_IFRAME,
) {
  await expect(async () => {
    expect(
      await page.evaluate((sel) => {
        const f = document.querySelector(sel) as HTMLIFrameElement | null;
        return {
          frameFocused: !!f && document.activeElement === f,
          inner: f?.contentDocument?.activeElement?.className ?? null,
        };
      }, iframeSelector),
    ).toEqual({ frameFocused: true, inner: "sb-nav-input" });
  }).toPass();
}

export async function closePicker(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".sb-modal")).toBeHidden();
  await expect(page.locator("#sb-editor .cm-content")).toBeFocused();
}

/** `Cmd-k`: the page picker, on its default Pages segment. */
export function openPagePicker(page: Page): Promise<FrameLocator> {
  return openPicker(page, `${mod}+k`, "Page");
}

/**
 * Fills the picker's phrase, retrying: a fill landing right after a modal
 * reopen (the iframe is reused) can be undone by the view's own
 * phrase-reset effect firing after it.
 */
async function fillNavPhrase(
  page: Page,
  phrase: string,
  settled: () => Promise<void>,
) {
  await expect(async () => {
    await navInput(page).fill(phrase);
    await settled();
  }).toPass({ timeout: 20_000 });
}

export async function navigateViaPagePicker(page: Page, name: string) {
  const frame = await openPagePicker(page);
  await fillNavPhrase(page, name, () =>
    expect(navRows(frame).first()).toHaveText(name, { timeout: 1_000 }),
  );
  await page.keyboard.press("Enter");
  await expect(currentPage(page)).toHaveValue(name);
  await expect(page.locator(".sb-modal")).toBeHidden();
}

/** `Shift-Enter` creates from wherever the selection stands. */
export async function createPageViaPagePicker(page: Page, name: string) {
  const frame = await openPagePicker(page);
  // The chip is the sole create signifier now; the primary is just the
  // phrase, like any other row's.
  await fillNavPhrase(page, name, () =>
    expect(frame.locator(".sb-nav-create .sb-nav-primary")).toHaveText(name, {
      timeout: 1_000,
    }),
  );
  await expect(frame.locator(".sb-nav-create .sb-nav-chip-hint")).toHaveText(
    "Create",
  );
  await page.keyboard.press("Shift+Enter");
  await expect(page.locator(".sb-modal")).toBeHidden();
  await expect(currentPage(page)).toHaveValue(name);
}

export async function runCommandViaPalette(page: Page, command: string) {
  const frame = await openPicker(page, `${mod}+/`, "Command");
  await fillNavPhrase(page, command, () =>
    expect(navRows(frame).first()).toHaveText(command, { timeout: 1_000 }),
  );
  await page.keyboard.press("Enter");
  await expect(
    frame.locator("input.sb-nav-input[placeholder='Command']"),
  ).toBeHidden();
}
