import { EditorState } from "@codemirror/state";
import { BasenameIndex } from "@silverbulletmd/silverbullet/lib/resolve_path";
import { expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { processWikiLink } from "./wiki_link_processor.ts";

test("live-preview wiki links carry the target page decoration icon", () => {
  const files = new BasenameIndex();
  files.add("Person/Ada.md");
  const client = {
    currentPath: () => "Notes.md",
    clientSystem: { allKnownFiles: files, knownFilesLoaded: true },
    fullSyncCompleted: true,
    ui: {
      viewState: {
        uiOptions: { markdownSyntaxRendering: false },
        allPages: [
          {
            ref: "Person/Ada",
            name: "Person/Ada",
            pageDecoration: { icon: "user" },
          },
        ],
      },
    },
  };
  const state = EditorState.create({
    doc: "x [[Person/Ada|Ada]]",
    selection: { anchor: 0 },
  });

  const decorations = processWikiLink({
    from: 2,
    to: 20,
    match: {
      leadingTrivia: "",
      stringRef: "Person/Ada",
      alias: "Ada",
      trailingTrivia: "",
    },
    matchFrom: 2,
    matchTo: 20,
    client: client as any,
    state,
    shortWikiLinks: false,
    callback: () => undefined,
  });

  expect(decorations[0].value.spec.widget.options.icon).toBe("user");
});

function renderedLinkClass(doc: string): string {
  const files = new BasenameIndex();
  files.add("Ada.md");
  const client = {
    currentPath: () => "Notes.md",
    clientSystem: { allKnownFiles: files, knownFilesLoaded: true },
    fullSyncCompleted: true,
    ui: {
      viewState: {
        uiOptions: { markdownSyntaxRendering: false },
        allPages: [],
      },
    },
  };
  const state = EditorState.create({
    doc: `${doc}\n\nCursor parks here.`,
    selection: { anchor: doc.length + 2 },
    extensions: [buildExtendedMarkdownLanguage()],
  });
  const from = doc.indexOf("[[");
  const to = doc.indexOf("]]") + 2;
  const [decoration] = processWikiLink({
    from,
    to,
    match: {
      leadingTrivia: "[[",
      stringRef: "Ada",
      trailingTrivia: "]]",
    },
    matchFrom: from,
    matchTo: to,
    client: client as any,
    state,
    shortWikiLinks: false,
    callback: () => undefined,
  });
  return decoration.value.spec.widget.options.cssClass;
}

test("a plain wiki link carries no formatting class", () => {
  expect(renderedLinkClass("see [[Ada]]")).toBe("sb-wiki-link");
});

test.each([
  ["**see [[Ada]]**", "sb-strong"],
  ["_see [[Ada]]_", "sb-emphasis"],
  ["~~see [[Ada]]~~", "sb-strikethrough"],
])("a wiki link inside %s repeats its formatting", (doc, expected) => {
  expect(renderedLinkClass(doc).split(" ")).toContain(expected);
});

test("nested formatting stacks on the link", () => {
  const classes = renderedLinkClass("**_see [[Ada]]_**").split(" ");
  expect(classes).toContain("sb-strong");
  expect(classes).toContain("sb-emphasis");
});
