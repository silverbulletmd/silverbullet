import { expect, test } from "vitest";
import { parse } from "../markdown_parser/parse_tree.ts";

import { renderMarkdownToHtml } from "./markdown_render.ts";
import {
  buildExtendedMarkdownLanguage,
  extendedMarkdownLanguage,
} from "../markdown_parser/parser.ts";
import { CustomSyntaxRenderedHtmlType, expandMarkdown } from "./inline.ts";
import type { Space } from "../space.ts";
import type { SpaceLuaEnvironment } from "../space_lua.ts";
import { LuaEnv } from "../space_lua/runtime.ts";

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

test("Markdown render", () => {
  const tree = parse(extendedMarkdownLanguage, sampleMarkdown);
  renderMarkdownToHtml(tree, {
    failOnUnknown: true,
  });
});

test("Wiki link with embedded image path", () => {
  // This particular one caused an infinite regex loop previously, adding it here as a regression to avoid in the future
  const example = `![[Inbox/2026-01-08/CleanShot 2026-01-01 at 12.36.23.png]]`;
  const tree = parse(extendedMarkdownLanguage, example);
  renderMarkdownToHtml(tree, {
    failOnUnknown: true,
  });
});

test("Smart hard break test", () => {
  const example = `**Hello**
*world!*`;
  const tree = parse(extendedMarkdownLanguage, example);
  const html = renderMarkdownToHtml(tree, {
    failOnUnknown: true,
    smartHardBreak: true,
  });
  expect(html).toEqual(
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

test("Inline HTML tags render as proper elements", () => {
  const tree = parse(extendedMarkdownLanguage, "<marquee>Hello</marquee>");
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual(
    '<span class="p"><marquee>Hello</marquee></span>',
  );
});

test("Inline HTML tags with attributes", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    '<span style="color:red">red text</span>',
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual(
    '<span class="p"><span style="color:red">red text</span></span>',
  );
});

test("Inline HTML tags with markdown content", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    '<marquee class="x">Hello **there**</marquee>',
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual(
    '<span class="p"><marquee class="x">Hello <strong>there</strong></marquee></span>',
  );
});

test("Inline HTML mixed with text", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "Before <b>bold</b> after",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual(
    '<span class="p">Before <b>bold</b> after</span>',
  );
});

test("Nested same-name HTML tags", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "<b><b>nested</b></b>",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual(
    '<span class="p"><b><b>nested</b></b></span>',
  );
});

test("Inline HTML with wiki link", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "<span>hello [[there]]</span>",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual(
    '<span class="p"><span>hello <a href="/there" class="wiki-link" data-ref="there">there</a></span></span>',
  );
});

test("Unmatched HTML tags render as literal text", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "text <b>unclosed",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual(
    '<span class="p">text &lt;b&gt;unclosed</span>',
  );
});

test("CustomSyntaxRenderedHtml renders raw HTML", () => {
  // Directly test the renderer with a synthetic parse tree
  const tree = {
    type: "Document",
    children: [
      {
        type: "Paragraph",
        children: [
          { text: "Before " },
          {
            type: CustomSyntaxRenderedHtmlType,
            children: [{ text: "<em>rendered</em>" }],
          },
          { text: " after" },
        ],
      },
    ],
  };
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual(
    '<span class="p">Before <em>rendered</em> after</span>',
  );
});

// Minimal stubs for expandMarkdown tests
const stubSpace = {} as Space;
const stubSle = { env: new LuaEnv() } as SpaceLuaEnvironment;
const defaultExpandOpts = {
  expandTransclusions: false,
  expandLuaDirectives: false,
  rewriteTasks: false,
};

const latexInlineSpec = {
  name: "LatexInline",
  startMarker: "\\$",
  endMarker: "\\$",
  mode: "inline" as const,
};
const latexBlockSpec = {
  name: "LatexBlock",
  startMarker: "^\\$\\$$",
  endMarker: "^\\$\\$$",
  mode: "block" as const,
};
const customSpec = {
  name: "Custom",
  startMarker: "<<",
  endMarker: ">>",
  mode: "inline" as const,
};

test("expandMarkdown resolves inline custom syntax renderHtml", async () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexInline: latexInlineSpec,
  });
  const tree = parse(lang, "Hello $E=mc^2$ world");

  const expanded = await expandMarkdown(stubSpace, "test", tree, stubSle, {
    ...defaultExpandOpts,
    syntaxExtensions: {
      LatexInline: {
        ...latexInlineSpec,
        renderHtml: (body, _pageName) => `<span class="latex">${body}</span>`,
      },
    },
  });

  const html = renderMarkdownToHtml(expanded, { failOnUnknown: true });
  expect(html).toEqual(
    '<span class="p">Hello <span class="latex">E=mc^2</span> world</span>',
  );
});

test("expandMarkdown resolves block custom syntax renderHtml", async () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexBlock: latexBlockSpec,
  });
  const tree = parse(lang, "$$\nE=mc^2\n$$");

  const expanded = await expandMarkdown(stubSpace, "test", tree, stubSle, {
    ...defaultExpandOpts,
    syntaxExtensions: {
      LatexBlock: {
        ...latexBlockSpec,
        renderHtml: (body, _pageName) =>
          `<div class="math-block">${body.trim()}</div>`,
      },
    },
  });

  const html = renderMarkdownToHtml(expanded, { failOnUnknown: true });
  expect(html).toEqual('<div class="math-block">E=mc^2</div>');
});

test("expandMarkdown passes pageName to renderHtml", async () => {
  const lang = buildExtendedMarkdownLanguage({ Custom: customSpec });
  const tree = parse(lang, "Hello <<content>> world");

  let receivedPageName: string | undefined;
  await expandMarkdown(stubSpace, "MyPage", tree, stubSle, {
    ...defaultExpandOpts,
    syntaxExtensions: {
      Custom: {
        ...customSpec,
        renderHtml: (_body, pageName) => {
          receivedPageName = pageName;
          return "<span>ok</span>";
        },
      },
    },
  });

  expect(receivedPageName).toEqual("MyPage");
});

test("expandMarkdown handles renderHtml errors gracefully", async () => {
  const lang = buildExtendedMarkdownLanguage({ Custom: customSpec });
  const tree = parse(lang, "Hello <<content>> world");

  const expanded = await expandMarkdown(stubSpace, "test", tree, stubSle, {
    ...defaultExpandOpts,
    syntaxExtensions: {
      Custom: {
        ...customSpec,
        renderHtml: () => {
          throw new Error("something failed");
        },
      },
    },
  });

  const html = renderMarkdownToHtml(expanded);
  expect(html).toContain("Error in Custom renderHtml: something failed");
  expect(html).toContain('<span class="error">');
});

test("expandMarkdown skips custom syntax without renderHtml", async () => {
  const lang = buildExtendedMarkdownLanguage({ Custom: customSpec });
  const tree = parse(lang, "Hello <<content>> world");

  const expanded = await expandMarkdown(stubSpace, "test", tree, stubSle, {
    ...defaultExpandOpts,
    syntaxExtensions: {
      Custom: {
        ...customSpec,
        // No renderHtml callback
      },
    },
  });

  const html = renderMarkdownToHtml(expanded);
  // Should fall through to default rendering (raw text, HTML-escaped)
  expect(html).toContain("&lt;&lt;content&gt;&gt;");
});
