import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import {
  frontmatterPlugin,
  shouldRenderFrontmatterLivePreview,
} from "./frontmatter.ts";

function stateWithSelection(doc: string, selection = 0) {
  return EditorState.create({
    doc,
    selection: { anchor: selection },
  });
}

function clientWithMarkdownSyntaxRendering(markdownSyntaxRendering: boolean) {
  return {
    config: {
      get(path: string, defaultValue: unknown) {
        expect(path).toBe("shortWikiLinks");
        return defaultValue;
      },
    },
    ui: {
      viewState: {
        uiOptions: {
          markdownSyntaxRendering,
        },
        allPages: [],
      },
    },
    clientSystem: {
      allKnownFiles: new Set<string>(),
      knownFilesLoaded: true,
    },
    fullSyncCompleted: true,
  };
}

function countExactFrontmatterDecorations(args: {
  doc: string;
  from: number;
  to: number;
  markdownSyntaxRendering: boolean;
  selection?: number;
}) {
  const extension = frontmatterPlugin(
    clientWithMarkdownSyntaxRendering(args.markdownSyntaxRendering) as any,
  );
  const state = EditorState.create({
    doc: args.doc,
    selection: { anchor: args.selection ?? args.doc.length },
    extensions: [buildExtendedMarkdownLanguage(), extension],
  });
  let count = 0;
  state.field(extension).between(args.from, args.to, (from, to) => {
    if (from === args.from && to === args.to) {
      count++;
    }
  });
  return count;
}

describe("frontmatter live preview policy", () => {
  test("does not render frontmatter links while markdown syntax rendering is enabled", () => {
    const state = stateWithSelection("url: \"https://silverbullet.md\"");

    expect(
      shouldRenderFrontmatterLivePreview({
        state,
        client: clientWithMarkdownSyntaxRendering(true) as any,
        from: 6,
        to: 29,
      }),
    ).toBe(false);
  });

  test("does not render the frontmatter link currently being edited", () => {
    const state = stateWithSelection("url: \"https://silverbullet.md\"", 10);

    expect(
      shouldRenderFrontmatterLivePreview({
        state,
        client: clientWithMarkdownSyntaxRendering(false) as any,
        from: 6,
        to: 29,
      }),
    ).toBe(false);
  });

  test("renders a frontmatter link when clean mode is enabled and the cursor is elsewhere", () => {
    const state = stateWithSelection(
      "home: \"https://silverbullet.md\"\nother: \"https://example.com\"",
      40,
    );

    expect(
      shouldRenderFrontmatterLivePreview({
        state,
        client: clientWithMarkdownSyntaxRendering(false) as any,
        from: 7,
        to: 30,
      }),
    ).toBe(true);
  });

  test("frontmatter plugin does not replace URLs while markdown syntax rendering is enabled", () => {
    const doc = "---\nurl: \"https://silverbullet.md\"\n---\n";
    const from = doc.indexOf("https://silverbullet.md");
    const to = from + "https://silverbullet.md".length;

    expect(
      countExactFrontmatterDecorations({
        doc,
        from,
        to,
        markdownSyntaxRendering: true,
      }),
    ).toBe(0);
  });

  test("frontmatter plugin replaces URLs in clean mode when the cursor is elsewhere", () => {
    const doc = "---\nurl: \"https://silverbullet.md\"\n---\n";
    const from = doc.indexOf("https://silverbullet.md");
    const to = from + "https://silverbullet.md".length;

    expect(
      countExactFrontmatterDecorations({
        doc,
        from,
        to,
        markdownSyntaxRendering: false,
      }),
    ).toBe(1);
  });
});
