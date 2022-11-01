import buildMarkdown from "../../common/parser.ts";
import { parse } from "../../common/parse_tree.ts";
import { renderHtml } from "./html_render.ts";
import { System } from "../../plugos/system.ts";

import corePlug from "../../dist_bundle/_plug/core.plug.json" assert {
  type: "json",
};
import tasksPlug from "../../dist_bundle/_plug/tasks.plug.json" assert {
  type: "json",
};
import { createSandbox } from "../../plugos/environments/deno_sandbox.ts";
import { loadMarkdownExtensions } from "../../common/markdown_ext.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";
import { assertEquals } from "https://deno.land/std@0.152.0/testing/asserts.ts";

Deno.test("Markdown render", async () => {
  const system = new System<any>("server");
  await system.load(corePlug, createSandbox);
  await system.load(tasksPlug, createSandbox);
  const lang = buildMarkdown(loadMarkdownExtensions(system));
  const testFile = Deno.readTextFileSync(
    new URL("test/example.md", import.meta.url).pathname,
  );
  const tree = parse(lang, testFile);
  renderMarkdownToHtml(tree, {
    failOnUnknown: true,
    renderFrontMatter: true,
  });
  // console.log("HTML", html);
});

Deno.test("Smart hard break test", () => {
  const example = `**Hello**
*world!*`;
  const lang = buildMarkdown([]);
  const tree = parse(lang, example);
  const html = renderMarkdownToHtml(tree, {
    failOnUnknown: true,
    smartHardBreak: true,
  });
  assertEquals(
    html,
    `<p><strong>Hello</strong><br/><em>world!</em></p>`,
  );
});
