import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { adminApi, test } from "../fixtures/authenticated.ts";
import { expect, gotoSilverBulletPage } from "../fixtures/core.ts";

const KITS_DIR = join(import.meta.dirname, "../../starter-kits");

/** Every Markdown page a kit ships, as space page names (`index` is the space index). */
function kitPages(id: string): string[] {
  const dir = join(KITS_DIR, id);
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".md"))
    .map((f) => relative(".", f).replace(/\.md$/, ""));
}

// Known-benign: auth probes answered with 401 before the session is used.
// Also benign: a file-list fetch aborted by our own navigation to the next page.
const BENIGN_CONSOLE =
  /status of 401|throwing offline \S+\/\.fs Failed to fetch|Error during refreshing the file list: Error: Offline/;

test("every starter kit boots cleanly", async ({
  adminPage: page,
  sbServer,
}) => {
  test.setTimeout(240_000);
  const kits: { id: string }[] = await adminApi(
    page,
    sbServer,
    "GET",
    "starter-kits",
  );
  expect(kits.length).toBeGreaterThan(0);

  for (const { id } of kits) {
    const prefix = `/kit-${id}`;
    const created = await adminApi(page, sbServer, "POST", "spaces", {
      name: id,
      binding: { prefix },
      starter: { type: "kit", id },
    });
    expect(created.starterContent, id).toBe("applied");

    const server = { ...sbServer, url: `${sbServer.url}${prefix}` };
    const problems: string[] = [];
    const onError = (error: Error) =>
      problems.push(`pageerror: ${error.message}`);
    const onConsole = (msg: import("@playwright/test").ConsoleMessage) => {
      if (msg.type() === "error" && !BENIGN_CONSOLE.test(msg.text()))
        problems.push(`console.error: ${msg.text()}`);
    };
    page.on("pageerror", onError);
    page.on("console", onConsole);

    const indexReady = () =>
      page.waitForFunction(
        async () => (globalThis as any).client.objectIndex.isIndexAvailable(),
        undefined,
        { timeout: 30_000 },
      );
    const pages = kitPages(id);
    expect(pages.length, id).toBeGreaterThan(0);
    for (const name of pages) {
      await gotoSilverBulletPage(page, server, name === "index" ? "" : name);
      // Let startup fetches finish; navigating away aborts them noisily.
      await indexReady();
    }

    const result = await page.evaluate(async (names) => {
      const runtime = (globalThis as any).sbRuntime;
      const aspiring: { page: string; name: string }[] = await runtime.evalLua(
        'query[[from index.tag("aspiring-page") select {page = page, name = name}]]',
      );
      const lint: unknown[] = [];
      for (const name of names) {
        lint.push(
          ...(await runtime.evalLua(`space.lint(${JSON.stringify(name)})`)),
        );
      }
      return { aspiring, lint };
    }, pages);
    page.off("pageerror", onError);
    page.off("console", onConsole);

    expect(problems, `${id}: page errors`).toEqual([]);
    expect(
      result.aspiring.filter((a) => !a.page.startsWith("Library/")),
      `${id}: aspiring pages`,
    ).toEqual([]);
    expect(result.lint, `${id}: lint`).toEqual([]);
  }
});
