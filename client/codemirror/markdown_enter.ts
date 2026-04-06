// Custom Enter command for markdown lists, based on @codemirror/lang-markdown's
// insertNewlineContinueMarkupCommand with two modifications:
// 1. When a list item ends with ":", create an indented child item
// 2. Never insert extra blank lines for non-tight list continuation

import { markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit, syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import {
  countColumn,
  EditorSelection,
  type StateCommand,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

// --- Inlined helpers from @codemirror/lang-markdown (not exported) ---

class Context {
  constructor(
    public node: SyntaxNode,
    public from: number,
    public to: number,
    public spaceBefore: string,
    public spaceAfter: string,
    public type: string,
    public item: SyntaxNode | null,
  ) {}

  blank(maxWidth: number | null, trailing = true): string {
    let result =
      this.spaceBefore + (this.node.name === "Blockquote" ? ">" : "");
    if (maxWidth != null) {
      while (result.length < maxWidth) result += " ";
      return result;
    } else {
      for (
        let i = this.to - this.from - result.length - this.spaceAfter.length;
        i > 0;
        i--
      ) {
        result += " ";
      }
      return result + (trailing ? this.spaceAfter : "");
    }
  }

  marker(doc: Text, add: number): string {
    const number =
      this.node.name === "OrderedList"
        ? String(+itemNumber(this.item!, doc)[2] + add)
        : "";
    return this.spaceBefore + number + this.type + this.spaceAfter;
  }
}

function getContext(node: SyntaxNode, doc: Text): Context[] {
  const nodes: SyntaxNode[] = [],
    context: Context[] = [];
  for (let cur: SyntaxNode | null = node; cur; cur = cur.parent) {
    if (cur.name === "FencedCode") return context;
    if (cur.name === "ListItem" || cur.name === "Blockquote") {
      nodes.push(cur);
    }
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    let match;
    const line = doc.lineAt(node.from),
      startPos = node.from - line.from;
    if (
      node.name === "Blockquote" &&
      (match = /^ *>( ?)/.exec(line.text.slice(startPos)))
    ) {
      context.push(
        new Context(
          node,
          startPos,
          startPos + match[0].length,
          "",
          match[1],
          ">",
          null,
        ),
      );
    } else if (
      node.name === "ListItem" &&
      node.parent!.name === "OrderedList" &&
      (match = /^( *)\d+([.)])( *)/.exec(line.text.slice(startPos)))
    ) {
      let after = match[3],
        len = match[0].length;
      if (after.length >= 4) {
        after = after.slice(0, after.length - 4);
        len -= 4;
      }
      context.push(
        new Context(
          node.parent!,
          startPos,
          startPos + len,
          match[1],
          after,
          match[2],
          node,
        ),
      );
    } else if (
      node.name === "ListItem" &&
      node.parent!.name === "BulletList" &&
      (match = /^( *)([-+*])( {1,4}\[[ xX]\])?( +)/.exec(
        line.text.slice(startPos),
      ))
    ) {
      let after = match[4],
        len = match[0].length;
      if (after.length > 4) {
        after = after.slice(0, after.length - 4);
        len -= 4;
      }
      let type = match[2];
      if (match[3]) type += match[3].replace(/[xX]/, " ");
      context.push(
        new Context(
          node.parent!,
          startPos,
          startPos + len,
          match[1],
          after,
          type,
          node,
        ),
      );
    }
  }
  return context;
}

function itemNumber(item: SyntaxNode, doc: Text): RegExpExecArray {
  return /^(\s*)(\d+)(?=[.)])/.exec(
    doc.sliceString(item.from, item.from + 10),
  )!;
}

function renumberList(
  after: SyntaxNode,
  doc: Text,
  changes: { from: number; to: number; insert: string }[],
  offset = 0,
) {
  let prev = -1;
  let node = after;
  for (;;) {
    if (node.name === "ListItem") {
      const m = itemNumber(node, doc);
      const number = +m[2];
      if (prev >= 0) {
        if (number !== prev + 1) return;
        changes.push({
          from: node.from + m[1].length,
          to: node.from + m[0].length,
          insert: String(prev + 2 + offset),
        });
      }
      prev = number;
    }
    const next: SyntaxNode | null = node.nextSibling;
    if (!next) break;
    node = next;
  }
}

function normalizeIndent(content: string, state: EditorState): string {
  const blank = /^[ \t]*/.exec(content)![0].length;
  if (!blank || state.facet(indentUnit) !== "\t") return content;
  const col = countColumn(content, 4, blank);
  let space = "";
  for (let i = col; i > 0; ) {
    if (i >= 4) {
      space += "\t";
      i -= 4;
    } else {
      space += " ";
      i--;
    }
  }
  return space + content.slice(blank);
}

// --- Custom Enter command ---

export const customEnterCommand: StateCommand = ({ state, dispatch }) => {
  const tree = syntaxTree(state),
    { doc } = state;
  // deno-lint-ignore no-explicit-any
  let dont: any = null;
  const changes = state.changeByRange((range) => {
    if (
      !range.empty ||
      (!markdownLanguage.isActiveAt(state, range.from, -1) &&
        !markdownLanguage.isActiveAt(state, range.from, 1))
    ) {
      return (dont = { range });
    }
    const pos = range.from,
      line = doc.lineAt(pos);
    const context = getContext(tree.resolveInner(pos, -1), doc);
    while (
      context.length &&
      context[context.length - 1].from > pos - line.from
    ) {
      context.pop();
    }
    if (!context.length) return (dont = { range });
    const inner = context[context.length - 1];
    if (inner.to - inner.spaceAfter.length > pos - line.from) {
      return (dont = { range });
    }
    const emptyLine =
      pos >= inner.to - inner.spaceAfter.length &&
      !/\S/.test(line.text.slice(inner.to));

    // Empty line in list: always remove markup (nonTightLists = false)
    if (inner.item && emptyLine) {
      const next = context.length > 1 ? context[context.length - 2] : null;
      let delTo: number,
        insert = "";
      if (next?.item) {
        delTo = line.from + next.from;
        insert = next.marker(doc, 1);
      } else {
        delTo = line.from + (next ? next.to : 0);
      }
      const changes: { from: number; to: number; insert: string }[] = [
        {
          from: delTo,
          to: pos,
          insert,
        },
      ];
      if (inner.node.name === "OrderedList") {
        renumberList(inner.item, doc, changes, -2);
      }
      if (next && next.node.name === "OrderedList") {
        renumberList(next.item!, doc, changes);
      }
      return {
        range: EditorSelection.cursor(delTo + insert.length),
        changes,
      };
    }

    // Empty blockquote: two aligned empty quoted lines → exit
    if (inner.node.name === "Blockquote" && emptyLine && line.from) {
      const prevLine = doc.lineAt(line.from - 1),
        quoted = />\s*$/.exec(prevLine.text);
      if (quoted && quoted.index === inner.from) {
        const changes = state.changes([
          { from: prevLine.from + quoted.index, to: prevLine.to },
          { from: line.from + inner.from, to: line.to },
        ]);
        return { range: range.map(changes), changes };
      }
    }

    // Normal continuation
    const innerChanges: { from: number; to: number; insert: string }[] = [];
    if (inner.node.name === "OrderedList") {
      renumberList(inner.item!, doc, innerChanges);
    }
    const continued = inner.item && inner.item.from < line.from;

    // Strip trailing whitespace from current line
    let from = pos;
    while (
      from > line.from &&
      /\s/.test(line.text.charAt(from - line.from - 1))
    ) {
      from--;
    }

    // Check if line content ends with ":" (only in list context)
    const lineContentEnd = from - line.from;
    const endsWithColon =
      inner.item &&
      lineContentEnd > inner.to &&
      line.text.charAt(lineContentEnd - 1) === ":";

    let insert = "";
    if (endsWithColon) {
      // Generate blanks for outer context levels only
      for (let i = 0, e = context.length - 1; i < e; i++) {
        insert += context[i].blank(
          countColumn(line.text, 4, context[i + 1].from) - insert.length,
        );
      }
      // Indented child marker for innermost level
      if (inner.node.name === "BulletList") {
        // Use basic bullet width (2) as indent to avoid inflating for task checkboxes
        insert += `${inner.spaceBefore}  ${inner.type}${inner.spaceAfter}`;
      } else {
        // Ordered: full marker width as indent (no checkbox issue), then "1" + delimiter
        insert += `${inner.blank(null)}1${inner.type}${inner.spaceAfter}`;
      }
    } else {
      // Default: continue at same level
      if (
        !continued ||
        /^[\s\d.)\-+*>]*/.exec(line.text)![0].length >= inner.to
      ) {
        for (let i = 0, e = context.length - 1; i <= e; i++) {
          insert +=
            i === e && !continued
              ? context[i].marker(doc, 1)
              : context[i].blank(
                  i < e
                    ? countColumn(line.text, 4, context[i + 1].from) -
                        insert.length
                    : null,
                );
        }
      }
    }

    insert = normalizeIndent(insert, state);
    // Note: no blank line insertion for non-tight lists (removed)
    innerChanges.push({
      from,
      to: pos,
      insert: state.lineBreak + insert,
    });
    return {
      range: EditorSelection.cursor(from + insert.length + 1),
      changes: innerChanges,
    };
  });

  if (dont) return false;
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};
