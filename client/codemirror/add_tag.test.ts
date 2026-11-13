// @vitest-environment happy-dom

import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import {
  addTagAvailable,
  insertFrontmatter,
  NEW_FRONTMATTER,
} from "./add_tag.ts";
import { parseFrontmatterPreview } from "./syntax/frontmatter_preview.ts";

describe("Add tag on a page without frontmatter", () => {
  const pageRender = () => "form";
  function client(
    options: {
      readOnly?: boolean;
      syntaxRendering?: boolean;
      settings?: Record<string, unknown>;
    } = {},
  ) {
    const values: Record<string, unknown> = {
      "tags.page.renderFrontmatter": pageRender,
      ...options.settings,
    };
    return {
      currentName: () => "Notes/Plain",
      currentPageMeta: () => ({}),
      isReadOnlyMode: () => options.readOnly ?? false,
      config: {
        get(path: string | string[], fallback: unknown) {
          const key = Array.isArray(path) ? path.join(".") : path;
          return key in values ? values[key] : fallback;
        },
      },
      clientSystem: { scriptsLoaded: true },
      ui: {
        viewState: {
          uiOptions: {
            markdownSyntaxRendering: options.syntaxRendering ?? false,
          },
        },
      },
      systemReady: true,
      fullIndexCompleted: true,
      pageListSource: "index",
    };
  }
  const at = (text: string, anchor = text.length, readOnly = false) =>
    EditorState.create({
      doc: text,
      selection: { anchor },
      extensions: [
        buildExtendedMarkdownLanguage(),
        EditorState.readOnly.of(readOnly),
      ],
    });

  test("only on an editable page without frontmatter, with the default form on", () => {
    expect(addTagAvailable(client() as never, at("# Plain\nBody"))).toBe(true);
    expect(addTagAvailable(client() as never, at(""))).toBe(true);
    const plain = "Body";
    expect(addTagAvailable(client() as never, at("---\na: 1\n---\nBody"))).toBe(
      false,
    );
    // Frontmatter shown as source (cursor inside) is still frontmatter
    expect(
      addTagAvailable(client() as never, at("---\na: 1\n---\nBody", 5)),
    ).toBe(false);
    expect(addTagAvailable(client() as never, at(plain, 0, true))).toBe(false);
    expect(
      addTagAvailable(client({ readOnly: true }) as never, at(plain)),
    ).toBe(false);
    expect(
      addTagAvailable(
        client({ settings: { "liveEdit.frontmatter": false } }) as never,
        at(plain),
      ),
    ).toBe(false);
    expect(
      addTagAvailable(client({ syntaxRendering: true }) as never, at(plain)),
    ).toBe(false);
  });

  test("inserting frontmatter is one undo step, and the caret stays in the body", () => {
    const body = "# Plain\nBody";
    const view = new EditorView({
      state: EditorState.create({
        doc: body,
        selection: { anchor: 0 },
        extensions: [history(), buildExtendedMarkdownLanguage()],
      }),
    });
    try {
      insertFrontmatter(view);
      expect(view.state.doc.toString()).toBe(`---\ntags:\n---\n${body}`);
      expect(view.state.selection.main.head).toBe(NEW_FRONTMATTER.length);
      // The form shows for it: an empty tags key is still an object
      expect(
        parseFrontmatterPreview(view.state, "Notes/Plain")?.context,
      ).toEqual({
        values: { tags: null },
        types: { tags: "null" },
        keys: ["tags"],
      });
      undo(view);
      expect(view.state.doc.toString()).toBe(body);
    } finally {
      view.destroy();
    }
  });
});
