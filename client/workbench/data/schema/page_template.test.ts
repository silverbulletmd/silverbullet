import YAML from "js-yaml";
import { describe, expect, test } from "vitest";
import { defaultTemplateName, pageTemplateText } from "./page_template.ts";

/** The new page's frontmatter the template would produce, parsed */
function newPageFrontmatter(text: string): Record<string, unknown> {
  const outer = YAML.load(text.split("---\n")[1]) as Record<string, unknown>;
  expect(outer.tags).toBe("meta/template/page");
  return YAML.load(outer.frontmatter as string) as Record<string, unknown>;
}

describe("pageTemplateText", () => {
  test("holds the tag and each attribute, empty", () => {
    expect(
      pageTemplateText("book", {
        type: "object",
        properties: {
          author: { type: "string" },
          status: { type: "string", enum: ["reading"] },
        },
      }),
    ).toBe(
      "---\ntags: meta/template/page\nfrontmatter: |\n  tags: book\n  author:\n  status:\n---\n",
    );
  });

  test("a schema without attributes gives just the tag", () => {
    expect(newPageFrontmatter(pageTemplateText("book", {}))).toEqual({
      tags: "book",
    });
  });

  test("names YAML can't take bare are quoted", () => {
    const text = pageTemplateText("book", {
      properties: { "due date": {}, "a: b": {}, "#x": {} },
    });
    expect(text).toContain('  "due date":\n');
    expect(text).toContain('  "a: b":\n');
    expect(Object.keys(newPageFrontmatter(text))).toEqual([
      "tags",
      "due date",
      "a: b",
      "#x",
    ]);
  });

  test("names YAML would read as numbers or booleans are quoted", () => {
    expect(
      newPageFrontmatter(
        pageTemplateText("2024", { properties: { true: {} } }),
      ),
    ).toEqual({
      tags: "2024",
      true: null,
    });
  });

  test("a nested tag stays bare", () => {
    expect(pageTemplateText("project/active", {})).toContain(
      "  tags: project/active\n",
    );
  });
});

test("the default name is under Library/Page Templates", () => {
  expect(defaultTemplateName("book")).toBe("Library/Page Templates/book");
});
