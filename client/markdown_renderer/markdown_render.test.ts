import { expect, test, vi } from "vitest";
import { mediaTestDocument } from "../test_media_dom.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";

import { renderMarkdownToHtml } from "./markdown_render.ts";
import {
  buildExtendedMarkdownLanguage,
  extendedMarkdownLanguage,
} from "../markdown_parser/parser.ts";
import {
  CustomSyntaxRenderedHtmlType,
  expandMarkdown,
  createMediaElement,
} from "./inline.ts";
import { parseTransclusion } from "@silverbulletmd/silverbullet/lib/transclusion";
import type { Space } from "../space.ts";
import type { SpaceLuaEnvironment } from "../space_lua.ts";
import { LuaEnv } from "../space_lua/runtime.ts";

test.each([
  ["clip.mp3", "AUDIO"],
  ["movie.mp4", "VIDEO"],
  ["drawing.svg", "IMG"],
])("native transclusion for %s preserves its source and controls", (path, tag) => {
  vi.stubGlobal("document", mediaTestDocument());
  try {
    const element = createMediaElement(
      parseTransclusion(`![[${path}|Sample]]`)!,
    )!;
    expect(element.tagName).toBe(tag);
    expect(element.getAttribute("src")).toBe(`.fs/${path}`);
    const html = renderMarkdownToHtml(
      parse(extendedMarkdownLanguage, `![[${path}|Sample]]`),
    );
    expect(html).toContain(`<${tag}`);
    expect(html).toContain(`.fs/${path}`);
    if (tag === "AUDIO" || tag === "VIDEO") {
      expect(html).toContain('preload="metadata"');
      expect(html).toContain("controls");
    }
    if (tag === "VIDEO") expect(html).toContain("playsinline");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("live PDF transclusions preserve their object element", () => {
  vi.stubGlobal("document", mediaTestDocument());
  try {
    const element = createMediaElement(
      parseTransclusion("![[paper.pdf|Sample]]")!,
    ) as HTMLObjectElement;
    expect(element.tagName).toBe("OBJECT");
    expect(element.data).toBe(".fs/paper.pdf");
    expect(element.type).toBe("application/pdf");
    expect(element.title).toBe("Sample");
  } finally {
    vi.unstubAllGlobals();
  }
});

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
  const example = `![[Inbox/2026-01-08/CleanShot 2026-01-01 at 12.36.23.png]]`;
  const tree = parse(extendedMarkdownLanguage, example);
  renderMarkdownToHtml(tree, {
    failOnUnknown: true,
  });
});

test("Wiki links render the target page decoration icon before their label", () => {
  const tree = parse(extendedMarkdownLanguage, "[[Person/Ada|Ada]]");
  const html = renderMarkdownToHtml(tree, {}, [
    {
      ref: "Person/Ada",
      tag: "page",
      tags: [],
      name: "Person/Ada",
      perm: "rw",
      lastModified: "0",
      created: "0",
      pageDecoration: { icon: "user" },
    },
  ]);

  expect(html).toContain('class="sb-page-decoration-icon"');
  expect(html).toContain("<svg");
  expect(html).toMatch(/<svg[\s\S]*<\/svg><\/span>Ada<\/a>/);
});

test("Wiki link decoration icons never emit unsanitized literal SVG markup", () => {
  const tree = parse(extendedMarkdownLanguage, "[[Safe Page]]");
  const html = renderMarkdownToHtml(tree, {}, [
    {
      ref: "Safe Page",
      tag: "page",
      tags: [],
      name: "Safe Page",
      perm: "rw",
      lastModified: "0",
      created: "0",
      pageDecoration: {
        icon: '<svg onload="alert(1)"><script>alert(2)</script><circle cx="12" cy="12" r="4"></circle></svg>',
      },
    },
  ]);

  expect(html).not.toContain("onload");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("alert(");
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
    `<span class="p"><strong>Hello</strong><br/><em>world!</em></span>`,
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
  expect(html).toEqual('<span class="p"><marquee>Hello</marquee></span>');
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
  const tree = parse(extendedMarkdownLanguage, "Before <b>bold</b> after");
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual('<span class="p">Before <b>bold</b> after</span>');
});

test("Nested same-name HTML tags", () => {
  const tree = parse(extendedMarkdownLanguage, "<b><b>nested</b></b>");
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual('<span class="p"><b><b>nested</b></b></span>');
});

test("Inline HTML with wiki link", () => {
  const tree = parse(extendedMarkdownLanguage, "<span>hello [[there]]</span>");
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual(
    '<span class="p"><span>hello <a href="/there" class="wiki-link" data-ref="there">there</a></span></span>',
  );
});

test("Unmatched HTML tags render as literal text", () => {
  const tree = parse(extendedMarkdownLanguage, "text <b>unclosed");
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual('<span class="p">text &lt;b&gt;unclosed</span>');
});

test("Inline HTML renders inside task items", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "* [ ] <mark>highlighted</mark> task",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toEqual(
    '<ul><li><span class="sb-task"><input type="checkbox" data-state=" "> <mark>highlighted</mark> task</span></li></ul>',
  );
});

test("CustomSyntaxRenderedHtml renders raw HTML", () => {
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
  expect(html).toEqual('<span class="p">Before <em>rendered</em> after</span>');
});

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
      },
    },
  });

  const html = renderMarkdownToHtml(expanded);
  expect(html).toContain("&lt;&lt;content&gt;&gt;");
});

test("Block HTML table renders correctly", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "<table><tr><td>hello</td></tr></table>",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe("<table><tr><td>hello</td></tr></table>");
});

test("Block HTML preserves data attributes", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    '<td data-table-cell-type="number">42</td>',
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe('<td data-table-cell-type="number">42</td>');
});

test("Markdown inside block HTML td is rendered", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "<table><tr><td>hello **world**</td></tr></table>",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe(
    "<table><tr><td>hello <strong>world</strong></td></tr></table>",
  );
});

test("Self-closing <br/> inside block HTML td renders as HTML", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "<table><tr><td>Hello<br/>there</td></tr></table>",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe("<table><tr><td>Hello<br>there</td></tr></table>");
});

test("Wiki link inside block HTML td is rendered", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "<table><tr><td>see [[MyPage]]</td></tr></table>",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toContain('<a href="/MyPage" class="wiki-link"');
  expect(html).toContain('data-ref="MyPage"');
});

test("Block HTML with self-closing tags", () => {
  const tree = parse(extendedMarkdownLanguage, "<div><br /><hr /></div>");
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe("<div><br><hr></div>");
});

test("Multi-line block HTML table", () => {
  const md = `<table>
<thead><tr><th>name</th><th>age</th></tr></thead>
<tbody>
<tr><td>Alice</td><td>30</td></tr>
</tbody>
</table>`;
  const tree = parse(extendedMarkdownLanguage, md);
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toContain("<thead><tr><th>name</th><th>age</th></tr></thead>");
  expect(html).toContain("<td>Alice</td><td>30</td>");
});

test("Block HTML with data attributes and wiki links", () => {
  const md = `<table>
<thead><tr><th>name</th></tr></thead>
<tbody>
<tr><td data-table-cell-type="string">[[Alice]]</td></tr>
</tbody>
</table>`;
  const tree = parse(extendedMarkdownLanguage, md);
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toContain('data-table-cell-type="string"');
  expect(html).toContain('<a href="/Alice" class="wiki-link"');
});

test("Block HTML ul/li with data attributes", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    '<ul><li data-list-item-type="string">hello</li></ul>',
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe('<ul><li data-list-item-type="string">hello</li></ul>');
});

test("Nested block HTML tables", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toContain("<table><tr><td>inner</td></tr></table>");
  expect(html.match(/<table>/g)).toHaveLength(2);
  expect(html.match(/<\/table>/g)).toHaveLength(2);
});

test("Empty block HTML table", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "<table data-table-empty></table>",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toContain("data-table-empty");
});

test("HTML comment is still removed", () => {
  const tree = parse(extendedMarkdownLanguage, "<!-- comment -->");
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe("");
});

test("Conforming inline comment renders to nothing", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "A claim.\n\n<!-- @pete: verify — john, 2026-08-04 -->\n",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).not.toContain("pete");
  expect(html).not.toContain("verify");
  expect(html).not.toContain("<!--");
});

test("Whitespace between block siblings is dropped (no spurious <br>)", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "# Heading\n\n- item one\n- item two\n\n# Next heading\n",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe(
    "<h1>Heading</h1>" +
      '<ul><li><span class="p">item one</span></li>' +
      '<li><span class="p">item two</span></li></ul>' +
      "<h1>Next heading</h1>",
  );
});

test("Whitespace between paragraphs is preserved as <br/>", () => {
  const tree = parse(extendedMarkdownLanguage, "Hello there\n\nThis is cool\n");
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe(
    '<span class="p">Hello there</span>' +
      "<br/><br/>" +
      '<span class="p">This is cool</span>',
  );
});

test("Whitespace between paragraph and heading is preserved", () => {
  // Paragraph renders as an inline `<span class="p">`, so a blank line
  // before a following block (heading) must still produce a visible gap.
  const tree = parse(
    extendedMarkdownLanguage,
    "Intro paragraph\n\n# Heading\n",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe(
    '<span class="p">Intro paragraph</span><br/><h1>Heading</h1>',
  );
});

test("Whitespace between heading and paragraph is preserved", () => {
  // Symmetric to the previous case: block-then-paragraph keeps its break.
  // Note: the heading consumes the newline that terminates its own line, so
  // the whitespace text node between heading and paragraph is a single `\n`,
  // not the `\n\n` of the markdown source.
  const tree = parse(
    extendedMarkdownLanguage,
    "# Heading\n\nIntro paragraph\n",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe(
    '<h1>Heading</h1><br/><span class="p">Intro paragraph</span>',
  );
});

test("Whitespace between bullet list and paragraph is preserved", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "- item one\n- item two\n\nOther text\n",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe(
    '<ul><li><span class="p">item one</span></li>' +
      '<li><span class="p">item two</span></li></ul>' +
      "<br/>" +
      '<span class="p">Other text</span>',
  );
});

test("Multiple blank lines between blocks collapse to nothing", () => {
  const tree = parse(extendedMarkdownLanguage, "# A\n\n\n\n# B\n");
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe("<h1>A</h1><h1>B</h1>");
});

test("Heading then list then heading (transclusion shape)", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "# Lua Standard Library\n" +
      "- one\n- two\n\n" +
      "# Space Lua APIs\n" +
      "- three\n- four\n",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe(
    "<h1>Lua Standard Library</h1>" +
      '<ul><li><span class="p">one</span></li>' +
      '<li><span class="p">two</span></li></ul>' +
      "<h1>Space Lua APIs</h1>" +
      '<ul><li><span class="p">three</span></li>' +
      '<li><span class="p">four</span></li></ul>',
  );
});

test("Paragraph between two blocks keeps its surrounding breaks where needed", () => {
  // # heading\n\npara1\n\npara2\n\n# heading2
  // Whitespace adjacent to a paragraph stays (paragraphs are inline);
  // whitespace between two block-level siblings is dropped.
  const tree = parse(
    extendedMarkdownLanguage,
    "# H1\n\npara1\n\npara2\n\n# H2\n",
  );
  const html = renderMarkdownToHtml(tree, { failOnUnknown: true });
  expect(html).toBe(
    "<h1>H1</h1>" +
      "<br/>" +
      '<span class="p">para1</span>' +
      "<br/><br/>" +
      '<span class="p">para2</span>' +
      "<br/>" +
      "<h1>H2</h1>",
  );
});

test("renders at-mentions as plain styled text", () => {
  const tree = parse(extendedMarkdownLanguage, "Hello @PeteSmith");
  const html = renderMarkdownToHtml(tree);
  expect(html).toContain(
    `<span class="sb-at-mention"><span class="sb-at-mention-mark">@</span>PeteSmith</span>`,
  );
  expect(html).not.toContain("<a");
});

test("expandMarkdown strips a transcluded page's frontmatter", async () => {
  // A whole-page transclusion splices the target's text in. Its frontmatter
  // is metadata, not content -- and the two-pass widget pipelines round-trip
  // the expanded tree through text, where surviving `---` fences would
  // re-parse mid-document as setext/thematic-break garbage.
  const lang = buildExtendedMarkdownLanguage({});
  const tree = parse(lang, "Before\n![[Other]]\nAfter");
  const space = {
    readRef: async () => ({
      offset: 0,
      text: "---\nreferences:\n- some/file.ts\n---\nTranscluded body",
    }),
  } as unknown as Space;

  const expanded = await expandMarkdown(space, "test", tree, stubSle, {
    expandLuaDirectives: false,
    rewriteTasks: false,
  });

  const roundTripped = renderToText(expanded);
  expect(roundTripped).toContain("Transcluded body");
  expect(roundTripped).not.toContain("references:");
  expect(roundTripped).not.toContain("---");
});

// Regression #1914: TOC entries render a header's name as markdown so that
// inline syntax -- attributes above all -- still styles there. Rendering the
// name as a full document instead turned a header like "1. Foo" into an <ol>,
// which is why it was switched to raw text; that silently dropped attribute
// rendering along with it. `inline` keeps inline syntax and drops only the
// block-level interpretation.
test("inline rendering keeps attributes (#1914)", () => {
  const tree = parse(extendedMarkdownLanguage, "Task [FINI: 2026-01-01]");
  const html = renderMarkdownToHtml(tree, { inline: true });
  expect(html).toContain('class="sb-attribute" data-FINI="2026-01-01"');
  // no block wrapper: the result has to be safe inside an <a>
  expect(html).not.toContain('<span class="p">');
});

test("inline rendering does not turn a numbered header into a list (#1914)", () => {
  const tree = parse(extendedMarkdownLanguage, "1. Foo");
  const html = renderMarkdownToHtml(tree, { inline: true });
  expect(html).not.toContain("<ol>");
  expect(html).not.toContain("<li>");
  expect(html).toContain("1. Foo");
});

test("inline rendering keeps inline emphasis", () => {
  const tree = parse(extendedMarkdownLanguage, "A **bold** header");
  const html = renderMarkdownToHtml(tree, { inline: true });
  expect(html).toContain("<strong>");
  expect(html).not.toContain('<span class="p">');
});

test("inline rendering falls back to text for multiple blocks", () => {
  const tree = parse(extendedMarkdownLanguage, "a\n\nb");
  const html = renderMarkdownToHtml(tree, { inline: true });
  expect(html).not.toContain('<span class="p">');
  expect(html).toContain("a");
  expect(html).toContain("b");
});

test("inline rendering falls back to text for frontmatter", () => {
  const tree = parse(extendedMarkdownLanguage, "---\nfoo: bar\n---\nHello");
  const html = renderMarkdownToHtml(tree, { inline: true });
  expect(html).not.toContain('<span class="p">');
  expect(html).toContain("Hello");
});
