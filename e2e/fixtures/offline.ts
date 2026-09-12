import type { Page } from "@playwright/test";
import { test as core, expect } from "./core.ts";

export const test = core.extend({ disableServiceWorker: false });
export { expect };

export async function openLivePage(page: Page, url: string, content: string) {
  // The first sync can finish during navigation, before a post-load listener runs.
  await page.addInitScript(() => {
    (window as any).__initialSync = new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("message", function done(event) {
        if (event.data?.type === "space-sync-complete") {
          navigator.serviceWorker.removeEventListener("message", done);
          resolve();
        }
      });
    });
  });
  await page.goto(url);
  await expect(page.locator("#sb-editor .cm-content")).toContainText(content);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(() => (window as any).__initialSync);
  await page.evaluate(() => (window as any).client.widgetsReady);
}

export async function localContent(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const response = await fetch(`/.fs/${path}`, {
      headers: { "X-Sync-Mode": "true" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Local read: ${response.status}`);
    return response.text();
  }, path);
}
