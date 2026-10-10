import { collectNodesOfType } from "@silverbulletmd/silverbullet/lib/tree";
import { expect, test } from "vitest";
import { renderLiteralMarkdown } from "../codemirror/widgets/widget_markdown.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";
import { slotIdOf, slotMarker, slotNode } from "./slots.ts";

test("slot markers parse as SlotRef nodes", () => {
  const tree = parse(extendedMarkdownLanguage, `a ${slotMarker(3)} b`);
  const refs = collectNodesOfType(tree, "SlotRef");
  expect(refs.map(slotIdOf)).toEqual([3]);
});

test("slot nodes render as placeholder spans", () => {
  const tree = parse(extendedMarkdownLanguage, `a ${slotMarker(0)} b`);
  expect(renderMarkdownToHtml(tree, { slotRefLimit: 1 })).toContain(
    '<span class="sb-slot" data-sb-slot="0"></span>',
  );
  const doc = { type: "Document", children: [slotNode(7)] };
  expect(renderMarkdownToHtml(doc)).toContain('data-sb-slot="7"');
});

test("markers inside inline code show a placeholder", () => {
  const tree = parse(extendedMarkdownLanguage, `\`x ${slotMarker(1)}\``);
  expect(renderMarkdownToHtml(tree)).toContain("[widget]");
});

test("markers outside a fragment's own slots stay literal text", () => {
  const tree = parse(extendedMarkdownLanguage, `a ${slotMarker(3)} b`);
  const html = renderMarkdownToHtml(tree);
  expect(html).toContain(slotMarker(3));
  expect(html).not.toContain("sb-slot");
  const literal = renderLiteralMarkdown(`a ${slotMarker(3)} b`, []);
  expect(literal).toContain(slotMarker(3));
});
