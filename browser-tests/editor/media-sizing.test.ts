import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("percentage images follow their content area in live and rendered Markdown", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../client/", import.meta.url)),
      contents: `
        import { parseTransclusion } from "@silverbulletmd/silverbullet/lib/transclusion";
        import { createMediaElement } from "./markdown_renderer/inline.ts";
        import { renderMarkdownToHtml } from "./markdown_renderer/markdown_render.ts";
        import { parse } from "./markdown_parser/parse_tree.ts";
        import { extendedMarkdownLanguage } from "./markdown_parser/parser.ts";

        const live = document.querySelector("#live .content");
        live.appendChild(createMediaElement(parseTransclusion("![[image.png|30%]]")));
        document.querySelector("#rendered .content").innerHTML = renderMarkdownToHtml(
          parse(extendedMarkdownLanguage, "![Sample|30%](image.png)")
        );
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
  });
  await page.route("http://media.test/**", (route) =>
    route.request().url().endsWith("image.png")
      ? route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="blue"/></svg>',
        })
      : route.fulfill({
          contentType: "text/html",
          body: '<div id="live" class="sb-inline-content" style="width:800px"><div><div class="content"></div></div></div><div id="rendered" style="width:800px"><div class="content"></div></div>',
        }),
  );
  await page.goto("http://media.test/");
  await page.addStyleTag({ path: "client_bundle/client/.client/app.css" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const id of ["live", "rendered"]) {
    const image = page.locator(`#${id} img`);
    await expect(image).toHaveJSProperty("naturalWidth", 1000);
    const size = () =>
      image.evaluate((el) => {
        const { width, height } = el.getBoundingClientRect();
        return { width, height };
      });
    await expect.poll(size).toEqual({ width: 240, height: 120 });
    await page.locator(`#${id}`).evaluate((el) => {
      el.style.width = "400px";
    });
    await expect.poll(size).toEqual({ width: 120, height: 60 });
  }
});
