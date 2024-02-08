import { parse } from "$common/markdown_parser/parse_tree.ts";
import { System } from "../../lib/plugos/system.ts";

import { createSandbox } from "../../lib/plugos/sandboxes/deno_worker_sandbox.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";
import { extendedMarkdownLanguage } from "$common/markdown_parser/parser.ts";

Deno.test("Markdown render", async () => {
  const system = new System<any>("server");
  await system.load(
    "editor",
    createSandbox(
      new URL("../../dist_plug_bundle/_plug/editor.plug.js", import.meta.url),
    ),
  );
  await system.load(
    "tasks",
    createSandbox(
      new URL("../../dist_plug_bundle/_plug/tasks.plug.js", import.meta.url),
    ),
  );
  const testFile = Deno.readTextFileSync(
    new URL("test/example.md", import.meta.url).pathname,
  );
  const tree = parse(extendedMarkdownLanguage, testFile);
  renderMarkdownToHtml(tree, {
    failOnUnknown: true,
  });
  // console.log("HTML", html);
  await system.unloadAll();
});

Deno.test("Smart hard break test", () => {
  const example = `**Hello**
*world!*`;
  const tree = parse(extendedMarkdownLanguage, example);
  const html = renderMarkdownToHtml(tree, {
    failOnUnknown: true,
    smartHardBreak: true,
  });
  // assertEquals(
  //   html,
  //   `<span class="p"><strong>Hello</strong><br><em>world!</em></span>`,
  // );

  const example2 = `This is going to be a text. With a new line.

And another

* and a list
* with a second item

### [[Bla]]
  Url: something
  Server: something else
  📅 last_updated - [Release notes](release_notes_url)`;

  const tree2 = parse(extendedMarkdownLanguage, example2);
  const html2 = renderMarkdownToHtml(tree2, {
    failOnUnknown: true,
    smartHardBreak: true,
  });

  console.log(html2);
});
