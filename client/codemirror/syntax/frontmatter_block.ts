import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import YAML from "js-yaml";

export type FrontmatterBlock = {
  from: number;
  to: number;
};

// Parsing only up to the closing fence is enough to find the block, even
// while the rest of a long page hasn't been parsed yet
function frontmatterParseUpto(state: EditorState): number {
  const firstLine = state.doc.line(1);
  if (firstLine.text.trimEnd() !== "---") {
    return firstLine.to;
  }
  for (let lineNumber = 2; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber);
    if (line.text.trimEnd() === "---") {
      return line.to;
    }
  }
  return state.doc.length;
}

/** The page's frontmatter, fences included */
export function findFrontmatterBlock(
  state: EditorState,
): FrontmatterBlock | undefined {
  const tree =
    ensureSyntaxTree(state, frontmatterParseUpto(state)) ?? syntaxTree(state);
  // Frontmatter can only open the page
  const first = tree.topNode.firstChild;
  return first?.name === "FrontMatter"
    ? { from: first.from, to: first.to }
    : undefined;
}

/** Whether `from`–`to` overlaps the page's frontmatter */
export function frontmatterInRange(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const block = findFrontmatterBlock(state);
  return !!block && block.from <= to && block.to >= from;
}

export type Frontmatter = FrontmatterBlock & {
  /** The block's text, fences included */
  source: string;
  /** Where the YAML between the fences starts */
  yamlFrom: number;
  yaml: string;
  /** The YAML loaded, or undefined when it doesn't parse */
  data: unknown;
};

/** The opening fence with its line break, then the YAML */
const FENCED = /^(---\r?\n)([\s\S]*?)\r?\n---$/;
const parsed = new WeakMap<Text, Frontmatter>();

/** The page's frontmatter with its YAML loaded once per document */
export function parseFrontmatter(state: EditorState): Frontmatter | undefined {
  const known = parsed.get(state.doc);
  if (known) return known;
  const block = findFrontmatterBlock(state);
  if (!block) return;
  const source = state.sliceDoc(block.from, block.to);
  const fenced = FENCED.exec(source);
  if (!fenced) return;
  let data: unknown;
  try {
    data = YAML.load(fenced[2]);
  } catch {
    // Invalid YAML: callers treat it as no data
  }
  const frontmatter: Frontmatter = {
    ...block,
    source,
    yamlFrom: block.from + fenced[1].length,
    yaml: fenced[2],
    data,
  };
  parsed.set(state.doc, frontmatter);
  return frontmatter;
}

/** Whether the page's own frontmatter sets `pageDecoration.renderWidgets: false` */
export function frontmatterDisablesWidgets(state: EditorState): boolean {
  const data = parseFrontmatter(state)?.data as any;
  return data?.pageDecoration?.renderWidgets === false;
}

/** Whether a selection range overlaps the half-open range `from`–`to` */
export function selectionIntersectsRange(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= from && range.from < to;
    }
    return range.from < to && range.to > from;
  });
}
