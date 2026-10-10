import { EditorState } from "@codemirror/state";
import { BasenameIndex } from "@silverbulletmd/silverbullet/lib/resolve_path";
import { expect, test, vi } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { LinkWidget } from "../util.ts";
import { attributePlugin } from "./attribute.ts";

function attributeDecorations(doc: string, selection = doc.length) {
  const navigate = vi.fn();
  const client = {
    config: { get: (_key: string, defaultValue: unknown) => defaultValue },
    ui: {
      viewState: {
        uiOptions: { markdownSyntaxRendering: false },
        allPages: [],
      },
    },
    clientSystem: {
      allKnownFiles: new BasenameIndex(),
      knownFilesLoaded: true,
    },
    currentPath: () => "Notes/Current.md",
    fullSyncCompleted: true,
    navigate,
  };
  const extension = attributePlugin(client as any);
  const state = EditorState.create({
    doc,
    selection: { anchor: selection },
    extensions: [buildExtendedMarkdownLanguage(), extension],
  });
  const decorations: { from: number; to: number; spec: any }[] = [];
  state.field(extension).between(0, doc.length, (from, to, value) => {
    decorations.push({ from, to, spec: value.spec });
  });
  return { decorations, navigate };
}

test("wiki link in a quoted attribute value is clickable", () => {
  const doc = '[topic: "[[Guides/Example Page]]"] after';
  const { decorations, navigate } = attributeDecorations(doc);
  const link = decorations.find(
    (decoration) => decoration.spec.widget instanceof LinkWidget,
  );

  expect(link?.from).toBe(doc.indexOf("[[Guides/Example Page]]"));
  expect(link?.to).toBe(link!.from + "[[Guides/Example Page]]".length);
  expect(link?.spec.widget.options.href).toBe("Guides/Example%20Page");
  link?.spec.widget.options.callback({
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  });
  expect(navigate).toHaveBeenCalledOnce();
  expect(
    decorations.some(
      (decoration) =>
        decoration.spec.attributes?.["data-topic"] ===
        '"[[Guides/Example Page]]"',
    ),
  ).toBe(true);
});

test("wiki link being edited stays as source text", () => {
  const doc = '[topic: "[[Guides/Example Page]]"] after';
  const { decorations } = attributeDecorations(doc, doc.indexOf("Example"));

  expect(
    decorations.some(
      (decoration) => decoration.spec.widget instanceof LinkWidget,
    ),
  ).toBe(false);
});
