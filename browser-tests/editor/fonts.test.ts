import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";

const inter = {
  name: "Inter",
  family: "Inter, system-ui, sans-serif",
  kind: "sans",
};

async function fontsBundle(): Promise<string> {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../client/", import.meta.url)),
      contents: `
        import * as fonts from "../plug-api/lib/fonts.ts";
        globalThis.fonts = fonts;
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
  });
  return bundle.outputFiles[0].text;
}

async function open(page: Page, body: string, script: string) {
  await page.route("http://fonts.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head></head><body>${body}</body></html>`,
    }),
  );
  await page.goto("http://fonts.test/");
  await page.addScriptTag({ content: script });
}

const editorFont = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--editor-font")
      .trim(),
  );

test("a space-style font override still wins over the configured font", async ({
  page,
}) => {
  await open(
    page,
    // As index.html declares them
    '<style id="sb-fonts"></style><div id="sb-theme"></div><div id="custom-styles"><style>:root{--editor-font: Courier}</style></div>',
    await fontsBundle(),
  );
  await page.evaluate((inter) => {
    const { fonts } = globalThis as any;
    fonts.applyFontStylesheet(
      fonts.fontStylesheet(
        {
          ui: ["inter"],
          editor: ["inter"],
          code: ["ia-writer-mono"],
          available: { inter },
        },
        "/",
      ),
    );
  }, inter);
  expect(await editorFont(page)).toBe("Courier");
  await page.evaluate(() => document.getElementById("custom-styles")!.remove());
  expect(await editorFont(page)).toBe("Inter, system-ui, sans-serif");
});

test("the bundled fonts load from the client's own files", async ({ page }) => {
  const dir = fileURLToPath(
    new URL("../../client_bundle/client/.client/", import.meta.url),
  );
  const requested: string[] = [];
  await page.route("http://fonts.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/.client/")) {
      requested.push(path);
      return route.fulfill({ path: dir + path.slice("/.client/".length) });
    }
    return route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><link rel="stylesheet" href="/.client/main.css"></head><body></body></html>',
    });
  });
  await page.goto("http://fonts.test/");
  const loaded = await page.evaluate(async () => {
    const result: Record<string, number> = {};
    for (const spec of [
      "16px 'iA-Mono'",
      "16px Inter",
      "bold 16px Inter",
      "italic 16px Inter",
      "16px Lora",
      "italic 16px Lora",
    ]) {
      const faces = await document.fonts.load(spec);
      result[spec] = faces.filter((f) => f.status === "loaded").length;
    }
    return result;
  });
  expect(loaded).toEqual({
    "16px 'iA-Mono'": 1,
    "16px Inter": 1,
    "bold 16px Inter": 1,
    "italic 16px Inter": 1,
    "16px Lora": 1,
    "italic 16px Lora": 1,
  });
  expect(requested).toContain("/.client/InterVariable.woff2");
  expect(requested).toContain("/.client/Lora-Variable.woff2");
});
