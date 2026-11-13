import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  type Extension,
  type Range,
  type StateField,
  type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, WidgetType } from "@codemirror/view";
import { expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import {
  dirtyRegions,
  OccurrenceKeys,
  parsedFurther,
  topLevelBlocks,
} from "./decoration_regions.ts";
import { listIndentPlugin } from "./editing/list_indent.ts";
import { disableSpellcheck } from "./spell_checking.ts";
import { admonitionPlugin } from "./syntax/admonition.ts";
import { atMentionPlugin } from "./syntax/at_mention.ts";
import { cleanBlockPlugin } from "./syntax/block.ts";
import { blockquotePlugin } from "./syntax/block_quote.ts";
import { cleanEscapePlugin } from "./syntax/escapes.ts";
import { hideHeaderMarkPlugin, hideMarksPlugin } from "./syntax/hide_mark.ts";
import { lineWrapper } from "./syntax/line_wrapper.ts";
import { listBulletPlugin } from "./syntax/list.ts";
import { taskListPlugin } from "./syntax/task.ts";
import { decoratorStateField } from "./util.ts";

const sample = `# Heading one

Some *emphasis* and **strong** text with \`code\` and \\* escape.
Another line with @someone and ~~struck~~ words.

* item one
  * nested *item*
  * [ ] a task
* [x] done task
  continuation line

1. first
2. second
10. tenth

> quoted *text*
> more quote
lazy continuation

> [!note] An admonition
> with a body

---

\`\`\`lua
local x = 1
\`\`\`

## Heading two

Final paragraph with \`code\` and \`code\` again.
`;

class KeyedWidget extends WidgetType {
  constructor(readonly cacheKey: string) {
    super();
  }
  toDOM() {
    return document.createElement("span");
  }
  override eq(other: KeyedWidget) {
    return other.cacheKey === this.cacheKey;
  }
}

/** Numbers repeated inline code like the Lua widgets number expressions */
const keyedCode = decoratorStateField(
  (state, _tr, range) => {
    const keys = range?.keys ?? new OccurrenceKeys();
    const widgets: Range<Decoration>[] = [];
    syntaxTree(state).iterate({
      from: range?.from,
      to: range?.to,
      enter: (node) => {
        if (node.name !== "InlineCode") return;
        const key = keys.key(state.sliceDoc(node.from, node.to));
        widgets.push(
          Decoration.widget({ widget: new KeyedWidget(key) }).range(node.to),
        );
      },
    });
    return Decoration.set(widgets, true);
  },
  { keyed: true },
);

/** Emphasis styled after whether the page has a horizontal rule anywhere */
const pageWideEmphasis = decoratorStateField(
  (state, _tr, range) => {
    let rule = false;
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name === "HorizontalRule") rule = true;
      },
    });
    const widgets: Range<Decoration>[] = [];
    syntaxTree(state).iterate({
      from: range?.from,
      to: range?.to,
      enter: (node) => {
        if (node.name !== "Emphasis") return;
        widgets.push(
          Decoration.mark({ class: rule ? "ruled" : "plain" }).range(
            node.from,
            node.to,
          ),
        );
      },
    });
    return Decoration.set(widgets, true);
  },
  {
    pageWide: (state, from, to) => {
      let found = false;
      syntaxTree(state).iterate({
        from,
        to,
        enter: (node) => {
          if (node.name === "HorizontalRule") found = true;
        },
      });
      return found;
    },
  },
);

const fields: StateField<DecorationSet>[] = [
  hideMarksPlugin(),
  hideHeaderMarkPlugin(),
  listBulletPlugin(),
  cleanBlockPlugin(),
  cleanEscapePlugin(),
  atMentionPlugin(),
  admonitionPlugin(),
  blockquotePlugin(),
  listIndentPlugin(),
  lineWrapper([
    { selector: "ATXHeading1", class: "sb-line-h1" },
    { selector: "ATXHeading2", class: "sb-line-h2" },
    { selector: "ListItem", class: "sb-line-li", nesting: true },
    { selector: "Blockquote", class: "sb-line-blockquote", nesting: true },
    { selector: "Task", class: "sb-line-task" },
    { selector: "FencedCode", class: "sb-line-fenced-code" },
    { selector: "BulletList", class: "sb-line-ul" },
  ]),
  disableSpellcheck(["InlineCode", "CodeText", "CodeInfo"]),
  taskListPlugin({ onCheckboxClick: () => {}, getView: () => null }),
  keyedCode,
  pageWideEmphasis,
] as StateField<DecorationSet>[];

const extensions: Extension[] = [buildExtendedMarkdownLanguage(), fields];

// Widgets resolve these at click time, so mapped ones may keep stale copies
const positionalProps = new Set(["fallbackPos", "stateFrom", "stateTo"]);

function describe(set: DecorationSet): string[] {
  const out: string[] = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, deco) => {
    const { widget, ...spec } = deco.spec;
    let w = "";
    if (widget) {
      const props = Object.entries(widget).filter(
        ([k, v]) => typeof v !== "function" && !positionalProps.has(k),
      );
      w = `${widget.constructor.name}${JSON.stringify(props)}`;
    }
    out.push(`${from}-${to} ${JSON.stringify(spec)} ${w}`);
  });
  return out;
}

function expectMatchesRebuild(state: EditorState, step: string) {
  const fresh = EditorState.create({
    doc: state.doc,
    selection: state.selection,
    extensions,
  });
  // Two partial parses may end in different places; compare what both cover
  const parsed = Math.min(syntaxTree(state).length, syntaxTree(fresh).length);
  let cutoff = Number.MAX_SAFE_INTEGER;
  if (parsed < state.doc.length) {
    const blocks = topLevelBlocks(syntaxTree(fresh));
    cutoff = blocks.findLast((b) => b.from <= parsed)?.from ?? 0;
  }
  const covered = (lines: string[]) =>
    lines.filter((line) => Number(line.split("-")[0]) < cutoff);
  for (const [i, field] of fields.entries()) {
    // What depends on the whole page depends on how far each parse got (a
    // loaded machine can stop the fresh one early)
    if (
      field === pageWideEmphasis &&
      syntaxTree(state).length !== syntaxTree(fresh).length
    ) {
      continue;
    }
    expect(
      covered(describe(state.field(field))),
      `${step}, field ${i}, parsed ${syntaxTree(state).length}/${syntaxTree(fresh).length} of ${state.doc.length}`,
    ).toEqual(covered(describe(fresh.field(field))));
  }
}

// Deterministic so a failure reproduces
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const inserts = [
  "a",
  "b",
  " ",
  "\n",
  "\n\n",
  "*",
  "**",
  "`",
  "```",
  "#",
  "# ",
  "> ",
  "* ",
  "- [ ] ",
  "1. ",
  "\\",
  "@",
  "_",
  "~~",
  "---",
  "  ",
];

function step(
  state: EditorState,
  rnd: () => number,
  reach = state.doc.length,
): Transaction {
  const len = state.doc.length;
  const pos = Math.floor(rnd() * (Math.min(reach, len) + 1));
  const roll = rnd();
  if (roll < 0.5) {
    const text = inserts[Math.floor(rnd() * inserts.length)];
    return state.update({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + text.length },
      userEvent: "input.type",
    });
  }
  if (roll < 0.7 && len > 0) {
    const from = Math.min(pos, len - 1);
    const to = Math.min(len, from + 1 + Math.floor(rnd() * 3));
    return state.update({
      changes: { from, to },
      selection: { anchor: from },
      userEvent: "delete",
    });
  }
  if (roll < 0.9) {
    return state.update({ selection: { anchor: pos }, userEvent: "select" });
  }
  const head = Math.min(len, pos + Math.floor(rnd() * 20));
  return state.update({
    selection: EditorSelection.single(pos, head),
    userEvent: "select",
  });
}

test("incremental decorations match a full rebuild through random edits", () => {
  let incremental = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const rnd = random(seed);
    let state = EditorState.create({
      doc: sample,
      selection: { anchor: 0 },
      extensions,
    });
    for (let n = 0; n < 120; n++) {
      const tr = step(state, rnd);
      state = tr.state;
      if (dirtyRegions(tr)) incremental++;
      expectMatchesRebuild(state, `seed ${seed} step ${n}`);
    }
  }
  // Most edits stay within their blocks; the fallback must not dominate
  expect(incremental).toBeGreaterThan(12 * 120 * 0.5);
}, 60_000);

test("incremental decorations match a rebuild while the parse is partial", () => {
  // Longer than an editor state parses up front
  const doc = sample.repeat(20);
  let incremental = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const rnd = random(seed);
    let state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions,
    });
    expect(syntaxTree(state).length).toBeLessThan(doc.length);
    for (let n = 0; n < 120; n++) {
      // Edit where the parse reaches, as the visible part of a page is
      const tr = step(state, rnd, 2500);
      state = tr.state;
      if (dirtyRegions(tr)) incremental++;
      expectMatchesRebuild(state, `seed ${seed} step ${n}`);
    }
  }
  expect(incremental).toBeGreaterThan(4 * 120 * 0.5);
}, 60_000);

test("an edit that reshapes later blocks rebuilds through them", () => {
  const state = EditorState.create({ doc: sample, extensions });
  // An unclosed fence swallows every block after it
  const tr = state.update({
    changes: { from: sample.indexOf("## Heading two"), insert: "```\n" },
  });
  const regions = dirtyRegions(tr)!;
  expect(regions.at(-1)!.to).toBe(tr.state.doc.length);
  expectMatchesRebuild(tr.state, "fence");
});

test("typing in a paragraph only rebuilds its own lines", () => {
  const state = EditorState.create({
    doc: sample,
    selection: { anchor: sample.indexOf("Final") },
    extensions,
  });
  const at = sample.indexOf("Final");
  const tr = state.update({
    changes: { from: at, insert: "x" },
    selection: { anchor: at + 1 },
    userEvent: "input.type",
  });
  const regions = dirtyRegions(tr)!;
  expect(regions).toHaveLength(1);
  const doc = tr.state.doc;
  expect(regions[0].from).toBe(doc.lineAt(at).from - 1);
  expect(doc.sliceString(regions[0].from, regions[0].to)).toBe(
    "\nxFinal paragraph with `code` and `code` again.\n",
  );
});

test("a parse step decorates only the newly parsed tail", () => {
  const doc = sample.repeat(40);
  const state = EditorState.create({ doc, extensions });
  const parsedBefore = syntaxTree(state).length;
  const upto = parsedBefore + 2000;
  ensureSyntaxTree(state, upto, 5000);
  // Unmarked, the same transaction is a request to refresh everything
  expect(dirtyRegions(state.update({}))).toBeNull();
  const tr = state.update({ annotations: parsedFurther.of(true) });
  const regions = dirtyRegions(tr)!;
  expect(syntaxTree(tr.state).length).toBeGreaterThanOrEqual(upto);
  expect(regions).toHaveLength(1);
  expect(regions[0].from).toBeGreaterThan(parsedBefore - sample.length);
  expect(regions[0].to).toBe(doc.length);
  // The same parse steps, decorated in one go
  const fresh = EditorState.create({ doc, extensions });
  ensureSyntaxTree(fresh, upto, 5000);
  const rebuilt = fresh.update({}).state;
  expect(syntaxTree(rebuilt).length).toBe(syntaxTree(tr.state).length);
  for (const [i, field] of fields.entries()) {
    expect(describe(tr.state.field(field)), `field ${i}`).toEqual(
      describe(rebuilt.field(field)),
    );
  }
});

test("a refresh without document or selection changes rebuilds everything", () => {
  const state = EditorState.create({ doc: sample, extensions });
  expect(dirtyRegions(state.update({}))).toBeNull();
  // Unlike putting the selection back where it is, which changes nothing
  expect(dirtyRegions(state.update({ selection: state.selection }))).toEqual(
    [],
  );
});

test("occurrence keys continue numbering from seeded keys", () => {
  const keys = new OccurrenceKeys();
  keys.seed("a");
  keys.seed("a:dup1");
  keys.seed("b");
  expect(keys.key("a")).toBe("a:dup2");
  expect(keys.key("b")).toBe("b:dup1");
  expect(keys.key("c")).toBe("c");
});
