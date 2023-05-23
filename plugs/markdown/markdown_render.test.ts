import buildMarkdown from "../../common/markdown_parser/parser.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import { System } from "../../plugos/system.ts";

import { createSandbox } from "../../plugos/environments/deno_sandbox.ts";
import { loadMarkdownExtensions } from "../../common/markdown_parser/markdown_ext.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";
import { assertEquals } from "../../test_deps.ts";

Deno.test("Markdown render", async () => {
  const system = new System<any>("server");
  await system.load(
    new URL("../../dist_plug_bundle/_plug/core.plug.js", import.meta.url),
    createSandbox,
  );
  await system.load(
    new URL("../../dist_plug_bundle/_plug/tasks.plug.js", import.meta.url),
    createSandbox,
  );
  const lang = buildMarkdown(loadMarkdownExtensions(system));
  const testFile = Deno.readTextFileSync(
    new URL("test/example.md", import.meta.url).pathname,
  );
  const tree = parse(lang, testFile);
  await renderMarkdownToHtml(tree, {
    failOnUnknown: true,
  });
  // console.log("HTML", html);
  await system.unloadAll();
});

Deno.test("Smart hard break test", async () => {
  const example = `**Hello**
*world!*`;
  const lang = buildMarkdown([]);
  const tree = parse(lang, example);
  const html = await renderMarkdownToHtml(tree, {
    failOnUnknown: true,
    smartHardBreak: true,
  });
  assertEquals(
    html,
    `<p><strong>Hello</strong><br/><em>world!</em></p>`,
  );
});
