import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentPage, navInput, openPicker } from "../fixtures/actions.ts";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  expect,
  gotoSilverBulletPage,
  shiftChord,
  test,
} from "../fixtures/core.ts";

test.describe("search", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Welcome\n",
      "Garden.md": "# Garden\nWater the basil every morning.\n",
      "Kitchen.md": "# Kitchen\nPesto needs garlic.\n",
    },
  });

  test("finds a page by its words and opens it at the match", async ({
    sbPage: page,
  }) => {
    const frame = await openPicker(page, shiftChord("f"), "Pages");
    await navInput(page).fill("basil morning");
    const row = frame.locator(".sb-nav-row", { hasText: "Garden" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator(".sb-nav-description mark").first()).toBeVisible();
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Kitchen" }),
    ).toHaveCount(0);
    await row.click();
    await expect(currentPage(page)).toHaveValue("Garden");

    // Reopening brings back the query, selected, and its results.
    const again = await openPicker(page, shiftChord("f"), "Pages");
    const input = navInput(page);
    await expect(input).toHaveValue("basil morning");
    await expect(
      again.locator(".sb-nav-row", { hasText: "Garden" }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() =>
        input.evaluate((el: HTMLInputElement) => [
          el.selectionStart,
          el.selectionEnd,
        ]),
      )
      .toEqual([0, "basil morning".length]);
  });

  test("exact phrase mode is available from the dropdown", async ({
    sbPage: page,
  }) => {
    const frame = await openPicker(page, shiftChord("f"), "Pages");
    await frame
      .locator("select.sb-nav-dropdown")
      .selectOption({ label: "Exact phrase" });
    await navInput(page).fill("needs garlic");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Kitchen" }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("search in a read-only published space", () => {
  test.use({
    serverEnv: { SB_READ_ONLY: "1" },
    spaceFiles: {
      "index.md": "# Welcome\n",
      "Garden.md": "# Garden\nWater the basil every morning.\n",
      "Kitchen.md": "# Kitchen\nPesto needs garlic.\n",
    },
  });

  test("a visitor who is not signed in can search and open a result", async ({
    sbServer,
    sbPage: page,
  }) => {
    // The server treats this browser as a public visitor: modes outside the
    // public ones are refused.
    const refused = await page.request.post(`${sbServer.url}/.search/query`, {
      data: { query: "basil", mode: "natural" },
    });
    expect(refused.status()).toBe(404);

    const frame = await openPicker(page, shiftChord("f"), "Pages");
    await expect(frame.locator("select.sb-nav-dropdown option")).toHaveText([
      "All words",
      "Exact phrase",
    ]);
    await navInput(page).fill("basil morning");
    const row = frame.locator(".sb-nav-row", { hasText: "Garden" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(currentPage(page)).toHaveValue("Garden");
    await expect(page.locator("#sb-editor")).toContainText(
      "Water the basil every morning.",
    );
  });
});

test.describe("semantic search on a multi-user server", () => {
  let root: string;
  let models: Server;
  // Read by the `serverEnv` fixture, which runs after `beforeAll`.
  let modelEnv: Record<string, string> = {};

  test.beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "sb-semantic-"));
    const modelDir = join(root, "model");
    execFileSync("./target/debug/examples/write_tiny_model", [modelDir], {
      cwd: join(import.meta.dirname, "../.."),
      stdio: "pipe",
    });
    // The tiny model is served from here: the journey never touches the network.
    models = createServer(async (req, res) => {
      const name = (req.url ?? "").replace(/^\/test\/tiny\/resolve\/0\//, "");
      if (
        !["model.safetensors", "tokenizer.json", "config.json"].includes(name)
      ) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200).end(await readFile(join(modelDir, name)));
    });
    await new Promise<void>((resolve) =>
      models.listen(0, "127.0.0.1", resolve),
    );
    modelEnv = {
      SB_SEARCH_TEST_MODEL_DIR: modelDir,
      SB_SEARCH_TEST_MODEL_URL: `http://127.0.0.1:${(models.address() as AddressInfo).port}`,
    };
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => models?.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  test.use({
    provisionAdmin: true,
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern.
    serverEnv: async ({}, use) => use(modelEnv),
    spaceFiles: {
      "spaces.json": JSON.stringify({
        garden: {
          name: "Garden",
          folder: "garden",
          binding: { prefix: "/garden" },
          indexPage: "index",
        },
      }),
      "garden/index.md": "# Garden\n",
      "garden/Basil.md": "# Basil\nWater the basil every morning.\n",
      "garden/Pesto.md": "# Pesto\nPesto needs garlic.\n",
    },
  });

  test("an administrator turns on semantic search and finds a page by meaning", async ({
    sbServer,
    page,
  }) => {
    const base = sbServer.url;
    test.setTimeout(120_000);
    await page.goto(`${base}/.dashboard/login`);
    await page.getByLabel("Username").fill(ADMIN_USER);
    await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${base}/.dashboard/`);

    // The server starts without a search model: choose one in Server settings.
    await page.goto(`${base}/.dashboard/admin?section=search`);
    // Choosing it turns semantic search on for the garden space, which
    // follows the server's default: the dashboard asks first.
    const question = new Promise<string>((resolve) =>
      page.once("dialog", async (dialog) => {
        resolve(dialog.message());
        await dialog.accept();
      }),
    );
    await page
      .getByLabel("Search model")
      .selectOption({ label: "Tiny test model" });
    expect(await question).toContain("Turn on semantic search");
    const card = page.locator(".sb-search-model-card");
    await expect(card.getByText("Ready", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("link", { name: "Model page ↗" }),
    ).toHaveAttribute("href", "https://example.com/test-tiny");
    // The spaces table shows the garden space building both indexes.
    const row = page.locator(".sb-search-spaces tr", { hasText: "Garden" });
    await expect(row).toBeVisible();
    await expect(row.locator('td[data-kind="fullText"]')).toContainText(
      "Ready",
      { timeout: 60_000 },
    );
    await expect(row.locator('td[data-kind="semantic"]')).toContainText(
      "Ready",
      {
        timeout: 60_000,
      },
    );

    // The garden space follows the server's default: semantic search is on.
    await page.goto(`${base}/.dashboard/garden?section=search`);
    await expect(
      page.getByText(
        "On by default for this server's search model (Tiny test model).",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Semantic search")).toBeChecked();
    const status = page.getByRole("status");
    await expect(status.getByText("Semantic index")).toBeVisible();
    await expect(
      status.locator('[data-kind="semantic"]').getByText(/^Ready · 3 pages/),
    ).toBeVisible({
      timeout: 60_000,
    });

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe(
        "Are you sure you want to rebuild the search index?",
      );
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Rebuild search index" }).click();
    await expect(status.getByText(/^Ready · 3 pages/)).toHaveCount(2, {
      timeout: 60_000,
    });

    await gotoSilverBulletPage(
      page,
      { ...sbServer, url: `${base}/garden` },
      "index",
    );
    const frame = await openPicker(page, shiftChord("f"), "Pages");
    await expect(frame.locator("select.sb-nav-dropdown option")).toHaveText([
      "Semantic",
      "All words",
      "Exact phrase",
    ]);
    await navInput(page).fill("basil morning");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Basil" }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // The Related Pages panel at the bottom of a page lists the pages
    // closest in meaning to it, never the page itself.
    await gotoSilverBulletPage(
      page,
      { ...sbServer, url: `${base}/garden` },
      "Basil",
    );
    const related = page.locator(
      '.sb-page-slot-page-bottom [data-view="std.relatedPages"]',
    );
    await expect(related.getByRole("link", { name: "Pesto" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(related.getByRole("link", { name: "Basil" })).toHaveCount(0);
  });
});
