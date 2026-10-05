import { EditorState, type StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { describe, expect, test, vi } from "vitest";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import {
  frontmatterPreviewForState,
  frontmatterPreviewPlugin,
  parseFrontmatterPreview,
  selectFrontmatterRenderer,
} from "./frontmatter_preview.ts";

vi.mock("../components/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));

function state(doc: string) {
  return EditorState.create({
    doc,
    extensions: [buildExtendedMarkdownLanguage()],
  });
}

describe("frontmatter preview source", () => {
  test("reads values from the current document and supplies the page name", () => {
    const page = state("---\ntags: [team, featured]\npoints: 306\n---\nBody");
    expect(
      parseFrontmatterPreview(page, "Teams/Example")?.pageMeta,
    ).toMatchObject({
      name: "Teams/Example",
      tags: ["team", "featured"],
      points: 306,
    });

    const edited = page.update({
      changes: {
        from: page.doc.toString().indexOf("306"),
        to: page.doc.toString().indexOf("306") + 3,
        insert: "310",
      },
    }).state;
    expect(
      parseFrontmatterPreview(edited, "Teams/Example")?.pageMeta.points,
    ).toBe(310);
  });

  test("keeps first matching tag order for scalar and list forms", () => {
    const featured = () => "featured";
    const team = () => "team";
    const getRenderer = (tag: string) =>
      ({ featured, team })[tag as "featured" | "team"];
    const scalar = parseFrontmatterPreview(
      state('---\ntags: "featured, team"\n---\nBody'),
      "Teams/Example",
    );
    const list = parseFrontmatterPreview(
      state("---\ntags: [other, team, featured]\n---\nBody"),
      "Teams/Example",
    );
    expect(selectFrontmatterRenderer(scalar!.pageMeta, getRenderer)).toBe(
      featured,
    );
    expect(selectFrontmatterRenderer(list!.pageMeta, getRenderer)).toBe(team);
  });

  test("does not render incomplete, invalid, or non-object YAML", () => {
    expect(
      parseFrontmatterPreview(state("---\ntags: team"), "Example"),
    ).toBeUndefined();
    expect(
      parseFrontmatterPreview(state("---\ntags: [team\n---"), "Example"),
    ).toBeUndefined();
    expect(
      parseFrontmatterPreview(state("---\n- team\n---"), "Example"),
    ).toBeUndefined();
  });
});

describe("frontmatter preview policy", () => {
  function client(
    options: {
      scriptsLoaded?: boolean;
      syntaxRendering?: boolean;
      renderWidgets?: boolean;
    } = {},
  ) {
    const render = () => "header";
    return {
      currentName: () => "Teams/Example",
      currentPageMeta: () => ({
        pageDecoration: { renderWidgets: options.renderWidgets },
      }),
      config: {
        get(path: string | string[], fallback: unknown) {
          return Array.isArray(path) &&
            path.join(".") === "tags.team.renderFrontmatter"
            ? render
            : fallback;
        },
      },
      clientSystem: { scriptsLoaded: options.scriptsLoaded ?? true },
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

  const doc = "---\ntags: team\npoints: 306\n---\nBody";

  test("uses a renderer only outside the frontmatter in clean mode", () => {
    const outside = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [buildExtendedMarkdownLanguage()],
    });
    const inside = EditorState.create({
      doc,
      selection: { anchor: 5 },
      extensions: [buildExtendedMarkdownLanguage()],
    });
    expect(
      frontmatterPreviewForState(outside, client() as never)?.source.pageMeta
        .points,
    ).toBe(306);
    expect(
      frontmatterPreviewForState(inside, client() as never),
    ).toBeUndefined();
  });

  test("keeps source visible while scripts load or rendering is disabled", () => {
    const outside = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [buildExtendedMarkdownLanguage()],
    });
    expect(
      frontmatterPreviewForState(
        outside,
        client({ scriptsLoaded: false }) as never,
      ),
    ).toBeUndefined();
    expect(
      frontmatterPreviewForState(
        outside,
        client({ syntaxRendering: true }) as never,
      ),
    ).toBeUndefined();
    expect(
      frontmatterPreviewForState(
        outside,
        client({ renderWidgets: false }) as never,
      ),
    ).toBeUndefined();
  });

  test("replaces exactly the frontmatter source range", () => {
    const extension = frontmatterPreviewPlugin(client() as never);
    const editor = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [buildExtendedMarkdownLanguage(), extension],
    });
    const ranges: Array<[number, number]> = [];
    editor
      .field(extension as StateField<DecorationSet>)
      .between(0, doc.length, (from, to) => {
        ranges.push([from, to]);
      });
    expect(ranges).toEqual([[0, doc.indexOf("\nBody")]]);
  });

  test("does not reuse a preview for another page with identical YAML", () => {
    const stub = client();
    let name = "Teams/First";
    stub.currentName = () => name;
    const extension = frontmatterPreviewPlugin(stub as never);
    const widgets: Array<{ eq: (other: unknown) => boolean }> = [];
    for (const pageName of ["Teams/First", "Teams/Second"]) {
      name = pageName;
      const editor = EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [buildExtendedMarkdownLanguage(), extension],
      });
      editor
        .field(extension as StateField<DecorationSet>)
        .between(0, doc.length, (_from, _to, decoration) => {
          widgets.push(decoration.spec.widget);
        });
    }
    expect(widgets[0].eq(widgets[1])).toBe(false);
  });
});
