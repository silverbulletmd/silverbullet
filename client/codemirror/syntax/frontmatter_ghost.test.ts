// @vitest-environment happy-dom

import { history, undo } from "@codemirror/commands";
import { EditorState, type StateField } from "@codemirror/state";
import { type DecorationSet, EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import {
  frontmatterGhostEnabled,
  ghostPlacement,
  insertFrontmatter,
  NEW_FRONTMATTER,
} from "./frontmatter_ghost.ts";
import {
  frontmatterPreviewPlugin,
  parseFrontmatterPreview,
} from "./frontmatter_preview.ts";

describe("add-attribute ghost on a page without frontmatter", () => {
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
      pageListLoaded: true,
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
    expect(
      frontmatterGhostEnabled(at("# Plain\nBody"), client() as never),
    ).toBe(true);
    expect(frontmatterGhostEnabled(at(""), client() as never)).toBe(true);
    const plain = "Body";
    expect(
      frontmatterGhostEnabled(at("---\na: 1\n---\nBody"), client() as never),
    ).toBe(false);
    // Frontmatter shown as source (cursor inside) is still frontmatter
    expect(
      frontmatterGhostEnabled(at("---\na: 1\n---\nBody", 5), client() as never),
    ).toBe(false);
    expect(frontmatterGhostEnabled(at(plain, 0, true), client() as never)).toBe(
      false,
    );
    expect(
      frontmatterGhostEnabled(at(plain), client({ readOnly: true }) as never),
    ).toBe(false);
    expect(
      frontmatterGhostEnabled(
        at(plain),
        client({ settings: { "liveEdit.frontmatter": false } }) as never,
      ),
    ).toBe(false);
    expect(
      frontmatterGhostEnabled(
        at(plain),
        client({ syntaxRendering: true }) as never,
      ),
    ).toBe(false);
  });

  test("adds no decorations of its own: the ghost is an overlay", () => {
    const extension = frontmatterPreviewPlugin(client() as never);
    const editor = EditorState.create({
      doc: "First line\nSecond line",
      selection: { anchor: 0 },
      extensions: [buildExtendedMarkdownLanguage(), extension],
    });
    expect(editor.field(extension as StateField<DecorationSet>).size).toBe(0);
  });

  test("the ghost icon sits left of line 1's first row, or not at all", () => {
    const row = { top: 60, bottom: 90 };
    expect(
      ghostPlacement({ row, textLeft: 124, bound: 104, width: 10 }),
    ).toEqual({ left: 110, top: 60, height: 30 });
    // Left of a heading marker hanging into the padding
    expect(ghostPlacement({ row, textLeft: 92, bound: 0, width: 10 })).toEqual({
      left: 78,
      top: 60,
      height: 30,
    });
    // Too narrow: hidden, never moved elsewhere
    expect(
      ghostPlacement({ row, textLeft: 12, bound: 0, width: 10 }),
    ).toBeUndefined();
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
