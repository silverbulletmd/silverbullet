import { EditorState } from "@codemirror/state";
import { BasenameIndex } from "@silverbulletmd/silverbullet/lib/resolve_path";
import { expect, test } from "vitest";
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
