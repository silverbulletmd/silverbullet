// Dumps the computed value of every theme custom property in light and dark
// mode, optionally with screenshots, to compare a styles refactor against.
//
//   npx tsx scripts/dump_theme_variables.ts <out.json> [--url http://localhost:3000]
//       [--page index] [--screenshots <dir>] [--themes light,dark]
//       [--inject-css <file>]
//
// --inject-css adds a stylesheet to every page load, e.g. a theme's base
// variables, to probe what follows them.
//
// The space needs an `index` sampler page and a `ThemeScratch` page; the
// script types into ThemeScratch and clears it. It must not set a `theme`:
// light and dark are SilverBullet Light and Dark, picked by emulating the
// system colour scheme.
//
// <out.json> gets `<name>-light.json` / `<name>-dark.json` siblings, e.g.
// `baseline.json` writes baseline-light.json and baseline-dark.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { bundledThemeVariables } from "../client/styles/theme_variables.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForFunction(
    (t) => document.documentElement.dataset.sbScheme === t,
    theme,
  );
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => r(null))),
  );
}

const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function shot(page: Page, dir: string, name: string, theme: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
}

async function openPalette(page: Page) {
  await page.keyboard.press(`${MOD}+/`);
  const input = page.locator(".sb-nav-root-modal input.sb-nav-input");
  await input.waitFor();
  return input;
}

async function runCommand(page: Page, command: string) {
  const input = await openPalette(page);
  await input.fill(command);
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
}

async function closeModal(page: Page) {
  await page.keyboard.press("Escape");
  await page.locator(".sb-modal").waitFor({ state: "hidden" });
}

async function focusEditor(page: Page) {
  await page.locator("#sb-editor .cm-content").click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Backspace");
}

/** Types into a scratch page so the sampler page stays untouched. */
async function completion(
  page: Page,
  dir: string,
  theme: string,
  name: string,
  typed: string,
) {
  await focusEditor(page);
  await page.keyboard.type(typed, { delay: 50 });
  await page
    .locator(".cm-tooltip-autocomplete, .sb-completion")
    .first()
    .waitFor({
      timeout: 5000,
    })
    .catch(() => console.warn(`${name} popup did not appear (${theme})`));
  await shot(page, dir, `complete-${name}`, theme);
  await page.keyboard.press("Escape");
}

async function screenshots(page: Page, theme: "light" | "dark", dir: string) {
  mkdirSync(dir, { recursive: true });
  await setTheme(page, theme);
  await shot(page, dir, "page", theme);
  await page.screenshot({
    path: path.join(dir, `page-${theme}.png`),
    fullPage: true,
  });

  await openPalette(page);
  await shot(page, dir, "palette", theme);
  await closeModal(page);

  await page.keyboard.press(`${MOD}+k`);
  await page.locator(".sb-nav-root-modal input.sb-nav-input").waitFor();
  await shot(page, dir, "pagepicker", theme);
  await closeModal(page);

  await runCommand(page, "Navigate: To Line");
  await shot(page, dir, "prompt", theme);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await runCommand(page, "Navigate: Tree");
  await shot(page, dir, "filetree", theme);
  // The Tree command only opens the panel; its close button is at the top right
  await page.mouse.click(239, 79);
  await page.waitForTimeout(500);

  await page.evaluate(() =>
    // @ts-expect-error exposed by boot.ts
    globalThis.client.ui.flashNotification(
      "Theme baseline notification",
      "info",
    ),
  );
  await shot(page, dir, "notification", theme);
  await page.evaluate(() =>
    // @ts-expect-error exposed by boot.ts
    globalThis.client.ui.flashNotification("Theme baseline error", "error"),
  );
  await shot(page, dir, "notification-error", theme);
  await page.waitForTimeout(6000);

  await page.goto(`${page.url().replace(/\/[^/]*$/, "")}/ThemeScratch`);
  await page.locator("#sb-editor .cm-content").waitFor();
  await page.waitForTimeout(1500);
  await setTheme(page, theme);
  await completion(page, dir, theme, "wikilink", "[[Re");
  await completion(page, dir, theme, "slash", "/");
  await completion(page, dir, theme, "hashtag", "#wr");
  await focusEditor(page);
  await page.keyboard.type("find me find me");
  await page.keyboard.press(`${MOD}+f`);
  await page.locator(".cm-search").waitFor();
  await page.keyboard.type("find");
  await shot(page, dir, "search", theme);
  await page.keyboard.press("Escape");
  await focusEditor(page);

  for (const tab of [
    "Overview",
    "Configuration",
    "Data",
    "Code",
    "Libraries",
    "Maintenance",
    "Console",
  ]) {
    await runCommand(page, `Workbench: ${tab}`);
    await page.waitForTimeout(1500);
    await shot(page, dir, `workbench-${tab.toLowerCase()}`, theme);
  }
  await runCommand(page, "Workbench: Toggle");
  await page.goto(page.url().replace(/\/[^/]*$/, "/index"));
  await page.locator("#sb-editor .cm-content").waitFor();
  await page.waitForTimeout(1500);
}

async function main() {
  const out = process.argv[2];
  if (!out || out.startsWith("--")) {
    throw new Error("usage: dump_theme_variables.ts <out.json> [options]");
  }
  const url = arg("--url") ?? "http://localhost:3000";
  const pageName = arg("--page") ?? "index";
  const shotDir = arg("--screenshots");
  const themes = (arg("--themes") ?? "light,dark").split(",");
  for (const t of themes) {
    if (t !== "light" && t !== "dark") {
      throw new Error(`--themes: unknown theme "${t}" (use light and/or dark)`);
    }
  }
  const injectFile = arg("--inject-css");

  const names = bundledThemeVariables();

  const browser = await chromium.launch({
    executablePath: process.env.SB_CHROME_PATH || undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  if (injectFile) {
    const css = readFileSync(injectFile, "utf8");
    await page.addInitScript((css) => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
      });
    }, css);
  }
  await page.goto(`${url}/${pageName}`);
  await page.locator("#sb-editor .cm-content").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  const ext = path.extname(out);
  for (const theme of themes as ("light" | "dark")[]) {
    await setTheme(page, theme);
    const values = await page.evaluate((list) => {
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        list.map((n) => [n, style.getPropertyValue(n).trim()]),
      );
    }, [...names].sort());
    writeFileSync(
      `${out.slice(0, out.length - ext.length)}-${theme}${ext}`,
      `${JSON.stringify(values, null, 2)}\n`,
    );
    if (shotDir) await screenshots(page, theme, shotDir);
  }
  await browser.close();
}

await main();
