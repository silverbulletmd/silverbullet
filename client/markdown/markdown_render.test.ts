import { parse } from "../markdown_parser/parse_tree.ts";

import { renderMarkdownToHtml } from "./markdown_render.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { assertEquals } from "@std/assert";

const sampleMarkdown = `---
name: Sup
---

# Hello world

This is **bold** and _italic_, or _italic_. And a **_mix_**. And ==highlight==!

Lists:

- This
- Is a
- list
- And here we go nested
1. This is a numbered
2. Two
- And different
- Bla
- More bla

And:

1. Numbered
2. Two

## Second heading

And some

And like this:

  More code
  Bla

And a blockquote:

> Sup yo Empty line\
> Second part

<!-- this is a comment -->

And more custom stuff [[Page link]]

{[Command button]}

- [ ] #next Task
- [x] #next Task 2


## Tables

| type      | actor_login | created_at           | payload_ref            |
| --------- | ----------- | -------------------- | ---------------------- |
| PushEvent | avb         | 2022-10-27T08:27:48Z | refs/heads/master      |
| PushEvent | avb         | 2022-10-27T04:31:27Z | refs/heads/jitterSched |

Here is something

---

A new thing.
`;

Deno.test("Markdown render", () => {
  const tree = parse(extendedMarkdownLanguage, sampleMarkdown);
  renderMarkdownToHtml(tree, {
    failOnUnknown: true,
  });
});

Deno.test("Smart hard break test", () => {
  const example = `**Hello**
*world!*`;
  const tree = parse(extendedMarkdownLanguage, example);
  const html = renderMarkdownToHtml(tree, {
    failOnUnknown: true,
    smartHardBreak: true,
  });
  assertEquals(
    html,
    `<span class="p"><strong>Hello</strong><br><em>world!</em></span>`,
  );

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
