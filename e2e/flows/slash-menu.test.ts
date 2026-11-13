import type { Page } from "@playwright/test";
import { docLines } from "../fixtures/actions.ts";
import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

// The slash menu: display names, groups and block entries
const spaceFiles = {
  "index.md": "Welcome",
  "Notes/Slash.md": "Intro\n\nBuy milk\n\nMy title\n",
};

function menu(page: Page) {
  return page.locator(".cm-tooltip-autocomplete");
}

function options(page: Page) {
  return page.locator(".cm-tooltip-autocomplete li");
}

/**
 * Waits until the open slash menu has stopped changing. Every keystroke
 * re-queries it (partly async), and CodeMirror ignores Enter for 75ms after
 * an update (`interactionDelay`) while a click on a row that is about to be
 * replaced picks by a stale index: acting mid-update is a flaky no-op.
 */
async function menuSettled(page: Page, quietMs = 200): Promise<void> {
  await expect(menu(page)).toBeVisible();
  await page.evaluate(
    (quiet) =>
      new Promise<void>((resolve) => {
        const tooltip = document.querySelector(".cm-tooltip-autocomplete")!;
        let timer = setTimeout(done, quiet);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(done, quiet);
        });
        observer.observe(tooltip, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        function done() {
          observer.disconnect();
          resolve();
        }
      }),
    quietMs,
  );
}

/** Opens the page with the cursor at the end of 1-based line `line` */
async function openAt(page: Page, sbServer: any, line: number) {
  await gotoSilverBulletPage(page, sbServer, "Notes/Slash");
  // The Std library's slash templates (the callouts among them) are defined
  // once its pages are indexed
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as any
        ).client.clientSystem.slashCommandHook.slashCommands.some(
          (c: { name: string }) => c.name === "warning-admonition",
        ),
      ),
    )
    .toBe(true);
  await page.evaluate((n) => {
    const view = (globalThis as any).client.editorView;
    view.dispatch({ selection: { anchor: view.state.doc.line(n).to } });
    view.focus();
  }, line);
  await expect(page.locator(".cm-content")).toBeFocused();
}

test.describe("slash menu", () => {
  test.use({ spaceFiles });

  test("/ on a blank line lists Basic blocks first, by display name", async ({
    sbPage,
    sbServer,
  }) => {
    await openAt(sbPage, sbServer, 2);
    await sbPage.keyboard.type("/");
    await expect(menu(sbPage)).toBeVisible();
    await expect(menu(sbPage).locator("completion-section").first()).toHaveText(
      "Basic blocks",
    );
    await expect(options(sbPage).first()).toContainText("Heading 1");
    await expect(
      options(sbPage).filter({ hasText: "Bulleted list" }),
    ).toHaveCount(1);
    // By its label: other rows' descriptions mention tasks too
    await expect(
      menu(sbPage).locator(".cm-completionLabel").getByText("Task", {
        exact: true,
      }),
    ).toHaveCount(1);
  });

  test("typing /h1 still turns the line into a heading", async ({
    sbPage,
    sbServer,
  }) => {
    await openAt(sbPage, sbServer, 5);
    await sbPage.keyboard.type(" /h1");
    await expect(options(sbPage).first()).toContainText("Heading 1");
    await menuSettled(sbPage);
    await sbPage.keyboard.press("Enter");
    await expect
      .poll(async () => (await docLines(sbPage))[4].trimEnd())
      .toBe("# My title");
  });

  test("/heading finds Heading 1", async ({ sbPage, sbServer }) => {
    await openAt(sbPage, sbServer, 2);
    await sbPage.keyboard.type("/heading");
    await expect(options(sbPage).first()).toContainText("Heading 1");
    // Filtering drops the group headers
    await expect(menu(sbPage).locator("completion-section")).toHaveCount(0);
  });

  test("a callout entry inserts that callout", async ({ sbPage, sbServer }) => {
    await openAt(sbPage, sbServer, 2);
    await sbPage.keyboard.type("/callout");
    await menuSettled(sbPage);
    await options(sbPage).filter({ hasText: "Callout: warning" }).click();
    await expect
      .poll(async () => (await docLines(sbPage)).slice(1, 3))
      .toEqual(["> **warning** Warning", "> "]);
    // The cursor waits on the empty line, and can be seen there (beside the
    // hidden `> `, it once measured 0px tall)
    await expect
      .poll(() =>
        sbPage
          .locator(".cm-cursor-primary")
          .evaluate((el) => el.getBoundingClientRect().height),
      )
      .toBeGreaterThan(10);
    // The card's tint lets the selection through: CodeMirror draws it under
    // the lines, so an opaque background would hide a selection in a callout
    const alpha = await sbPage
      .locator(".sb-admonition")
      .first()
      .evaluate((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        const a = bg.match(/\/\s*([\d.]+)\)$|rgba\([^)]*,\s*([\d.]+)\)$/);
        return a ? Number(a[1] ?? a[2]) : 1;
      });
    expect(alpha).toBeLessThan(1);
  });
});

// One representative entry per behavior, picked on a blank line and on a line
// with text: a line prefix, a callout, a block of its own, a link and a date.
const BASE = "Intro\n\nSome text here\n\nOutro\n";
const TEXT = "Some text here";

type Expected = (string | RegExp)[];
/** Exact lines from the line the entry was picked on, per mode */
type Expectation = { blank: Expected; text: Expected; caretAtEnd?: boolean };

const EXPECTED: Record<string, Expectation> = {
  "Heading 1": { blank: ["# "], text: [`# ${TEXT}`], caretAtEnd: true },
  Quote: { blank: ["> "], text: [`> ${TEXT}`], caretAtEnd: true },
  Task: { blank: ["* [ ] "], text: [`* [ ] ${TEXT}`], caretAtEnd: true },
  "Callout: warning": {
    blank: ["> **warning** Warning", "> "],
    text: ["> **warning** Warning", `> ${TEXT}`],
  },
  // A block of its own: in place of a blank line, below a line with text
  Table: {
    blank: ["| Header A | Header B |"],
    text: [TEXT, "", "| Header A | Header B |"],
  },
  "Link to page": { blank: ["[[]]"], text: [`${TEXT} [[]]`] },
  Today: {
    blank: [/^\d{4}-\d{2}-\d{2}$/],
    text: [new RegExp(`^${TEXT} \\d{4}-\\d{2}-\\d{2}$`)],
  },
};

/** Resets the page to `BASE` with the cursor at the end of 1-based `line` */
async function resetTo(page: Page, line: number) {
  if (await menu(page).isVisible()) await page.keyboard.press("Escape");
  await page.evaluate(
    ({ base, line }) => {
      const view = (globalThis as any).client.editorView;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: base },
      });
      view.dispatch({ selection: { anchor: view.state.doc.line(line).to } });
      view.focus();
    },
    { base: BASE, line },
  );
  await expect(page.locator(".cm-content")).toBeFocused();
}

async function menuLabels(page: Page): Promise<string[]> {
  await menuSettled(page);
  return menu(page).locator(".cm-completionLabel").allTextContents();
}

function option(page: Page, label: string) {
  return options(page).filter({
    has: page.locator(".cm-completionLabel").getByText(label, { exact: true }),
  });
}

function caret(page: Page): Promise<{ head: number; lineEnd: number }> {
  return page.evaluate(() => {
    const state = (globalThis as any).client.editorView.state;
    const head = state.selection.main.head;
    return { head, lineEnd: state.doc.lineAt(head).to };
  });
}

/** `get()` once `done` holds for it, or after `timeout` ms, whatever it is */
async function settle<T>(
  get: () => Promise<T>,
  done: (value: T) => boolean,
  timeout = 5000,
): Promise<T> {
  const end = Date.now() + timeout;
  let value = await get();
  while (!done(value) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await get();
  }
  return value;
}

const matches = (lines: string[], expected: Expected) =>
  expected.every((want, i) =>
    typeof want === "string" ? lines[i] === want : want.test(lines[i] ?? ""),
  );

test.describe("slash menu entries", () => {
  test.use({ spaceFiles: { "index.md": "Welcome", "Notes/Slash.md": BASE } });

  test("a representative entry per behavior works on a blank line and on a line with text", async ({
    sbPage,
    sbServer,
  }) => {
    await openAt(sbPage, sbServer, 2);
    await sbPage.keyboard.type("/");
    const labels = await menuLabels(sbPage);
    // The core blocks are among them
    for (const core of ["Heading 1", "Quote", "Numbered list", "Table"]) {
      expect(labels).toContain(core);
    }

    for (const label of Object.keys(EXPECTED)) {
      expect(labels, `the menu offers ${label}`).toContain(label);
      for (const mode of ["blank", "text"] as const) {
        const line = mode === "blank" ? 2 : 3;
        await resetTo(sbPage, line);
        await sbPage.keyboard.type(mode === "blank" ? "/" : " /");
        expect(await menuLabels(sbPage), `${label} (${mode} line)`).toContain(
          label,
        );
        await option(sbPage, label).click();
        const unchanged = [BASE, BASE.replace(TEXT, `${TEXT} `)];
        const doc = await settle(
          async () => (await docLines(sbPage)).join("\n"),
          (text) => !unchanged.includes(text),
        );
        expect
          .soft(unchanged, `${label} (${mode} line) changes the page`)
          .not.toContain(doc);
        const expected = EXPECTED[label][mode];
        const lines = await settle(
          async () => (await docLines(sbPage)).slice(line - 1),
          (lines) => matches(lines, expected),
        );
        expect
          .soft(
            matches(lines, expected),
            `${label} (${mode} line) gives ${expected}, got ${JSON.stringify(lines.slice(0, expected.length))}`,
          )
          .toBe(true);
        if (mode === "blank" && EXPECTED[label].caretAtEnd) {
          const { head, lineEnd } = await caret(sbPage);
          expect.soft(head, `${label}: caret after the markup`).toBe(lineEnd);
        }
      }
    }
  });

  test("Image or file opens the file chooser", async ({ sbPage, sbServer }) => {
    await openAt(sbPage, sbServer, 2);
    await sbPage.keyboard.type("/");
    const chooser = sbPage.waitForEvent("filechooser");
    await menuSettled(sbPage);
    await option(sbPage, "Image or file").click();
    await chooser;
  });

  test("Query… opens the Workbench query editor", async ({
    sbPage,
    sbServer,
  }) => {
    await openAt(sbPage, sbServer, 3);
    await sbPage.keyboard.type(" /");
    await menuSettled(sbPage);
    await option(sbPage, "Query…").click();
    await expect(sbPage.getByRole("region", { name: "Query" })).toContainText(
      "Insert at cursor goes where you typed /Query…",
    );
  });
});
