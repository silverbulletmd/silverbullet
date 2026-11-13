// @vitest-environment happy-dom
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { afterEach, describe, expect, test } from "vitest";
import type { Client } from "../../client.ts";
import type { PopupEntry } from "../../components/popup_menu.ts";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { blockSpanAt, canMoveBlock, moveBlock } from "./block_span.ts";
import {
  bindMenu,
  blockWidgetAround,
  registerWidgetMenu,
  type WidgetMenuSource,
  widgetMenuEntriesFor,
  widgetMenusInMargin,
} from "./block_menu.ts";

function stateOf(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [extendedMarkdownLanguage],
  });
  // No time budget: under a loaded test run a partial parse would flake
  ensureSyntaxTree(state, state.doc.length, 1e9);
  return state;
}

function clientOf(doc: string, readOnly = false) {
  const client = {
    editorView: {
      state: stateOf(doc),
      dispatch(spec: TransactionSpec) {
        this.state = this.state.update(spec).state;
      },
    },
    focus() {},
    isReadOnlyMode: () => readOnly,
  };
  return client as unknown as Pick<
    Client,
    "editorView" | "focus" | "isReadOnlyMode"
  >;
}

const item = (id: string, label = id): PopupEntry => ({
  kind: "item",
  id,
  label,
  icon: "",
  run: () => {},
});

const labels = (entries: PopupEntry[]): string[] =>
  entries.map((e) =>
    e.kind === "separator"
      ? "—"
      : e.kind === "submenu"
        ? `${e.label} ▸ ${labels(e.entries).join(", ")}`
        : e.kind === "item"
          ? e.label
          : e.text,
  );

function card(source: Partial<WidgetMenuSource> & { label: string }) {
  const el = document.createElement("div");
  registerWidgetMenu(el, { block: true, entries: () => [], ...source });
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("where widget menus go", () => {
  test("the margin ⋮ on desktop; the corner ⋯ on mobile and without a view state", () => {
    expect(
      widgetMenusInMargin({ ui: { viewState: { isMobile: false } } }),
    ).toBe(true);
    expect(widgetMenusInMargin({ ui: { viewState: { isMobile: true } } })).toBe(
      false,
    );
    expect(widgetMenusInMargin({})).toBe(false);
  });
});

describe("the ⋮ of a widget card", () => {
  const TABLE = "Intro.\n\n| a |\n|---|\n| 1 |\n\nOutro.";

  test("a card is the outermost block-level widget around the pointer", () => {
    const root = document.createElement("div");
    const outer = card({ label: "Data block" });
    const inner = card({ label: "Item" });
    const inline = document.createElement("span");
    registerWidgetMenu(inline, {
      label: "Expression",
      block: false,
      entries: () => [],
    });
    const text = document.createElement("b");
    inline.append(text);
    inner.append(inline);
    outer.append(inner);
    root.append(outer);
    expect(blockWidgetAround(text, root)).toBe(outer);
    const lone = document.createElement("span");
    registerWidgetMenu(lone, {
      label: "Expression",
      block: false,
      entries: () => [],
    });
    root.append(lone);
    expect(blockWidgetAround(lone, root)).toBeUndefined();
  });

  test("its type's menu, then Move up / Move down / Delete for the whole block", () => {
    const client = clientOf(TABLE);
    const el = card({
      label: "Table",
      entries: () => [item("edit", "Edit source"), item("copy", "Copy")],
      span: () => blockSpanAt(client.editorView.state, TABLE.indexOf("|")),
    });
    expect(labels(widgetMenuEntriesFor(client, el))).toEqual([
      "Edit source",
      "Copy",
      "—",
      "Move up",
      "Move down",
      "—",
      "Delete",
    ]);
    const del = widgetMenuEntriesFor(client, el).at(-1);
    if (del?.kind !== "item") throw new Error("no Delete");
    del.run?.();
    expect(client.editorView.state.doc.toString()).toBe("Intro.\n\nOutro.");
  });

  test("read-only: only the items that don't edit, no Move or Delete", () => {
    const client = clientOf(TABLE, true);
    const el = card({
      label: "Table",
      entries: () => [item("copy", "Copy")],
      span: () => blockSpanAt(client.editorView.state, TABLE.indexOf("|")),
    });
    expect(labels(widgetMenuEntriesFor(client, el))).toEqual(["Copy"]);
  });

  test("a submenu per nested widget, numbered where their labels repeat", () => {
    const client = clientOf("x");
    const outer = card({ label: "Widget", entries: () => [item("edit")] });
    for (const id of ["a", "b"]) {
      outer.append(card({ label: "Item", entries: () => [item(id)] }));
    }
    expect(labels(widgetMenuEntriesFor(client, outer))).toEqual([
      "edit",
      "—",
      "Item 1 ▸ a",
      "Item 2 ▸ b",
    ]);
  });

  test("one nested widget and no menu of its own: that one's menu in place, its Delete left to the block's", () => {
    const doc = "```#contact\nname: Ann\n```\n";
    const client = clientOf(doc);
    const outer = card({
      label: "Data block",
      span: () => blockSpanAt(client.editorView.state, 0),
    });
    outer.append(
      card({
        label: "Item",
        entries: () => [item("edit", "Edit source"), item("remove", "Delete")],
      }),
    );
    expect(labels(widgetMenuEntriesFor(client, outer))).toEqual([
      "Edit source",
      "—",
      "Move up",
      "Move down",
      "—",
      "Delete",
    ]);
  });

  test("bindMenu gives items with an id a run, into submenus", () => {
    const picked: string[] = [];
    const entries = bindMenu<string>(
      [
        { kind: "item", id: "a", label: "A", icon: "" },
        {
          kind: "submenu",
          label: "S",
          icon: "",
          entries: [{ kind: "item", id: "b", label: "B", icon: "" }],
        },
      ],
      (id) => {
        picked.push(id);
      },
    );
    const [a, s] = entries;
    if (a.kind !== "item" || s.kind !== "submenu") throw new Error();
    a.run?.();
    const b = s.entries[0];
    if (b.kind === "item") b.run?.();
    expect(picked).toEqual(["a", "b"]);
  });
});

describe("blocks other than ${…}", () => {
  test("a top-level fenced block, a table and an embed on its own line are blocks", () => {
    const doc =
      "A\n\n```data\nx: 1\n```\n\n| a |\n|---|\n\n![[Page]]\n\nB ![[Page]]";
    const state = stateOf(doc);
    expect(blockSpanAt(state, doc.indexOf("```"))).toEqual({
      from: doc.indexOf("```"),
      to: doc.indexOf("```\n\n|") + 3,
    });
    expect(blockSpanAt(state, doc.indexOf("|"))).toBeDefined();
    expect(blockSpanAt(state, doc.indexOf("![["))).toBeDefined();
    // Sharing its line with text: not a block
    expect(blockSpanAt(state, doc.lastIndexOf("![["))).toBeUndefined();
  });

  test("moves past the block before or after it; nothing past the page's edges", () => {
    const doc = "A\n\n| a |\n|---|\n\nB";
    const state = stateOf(doc);
    const span = blockSpanAt(state, doc.indexOf("|"));
    if (!span) throw new Error("no table");
    expect(canMoveBlock(state, span, -1)).toBe(true);
    const spec = moveBlock(state, span, 1);
    expect(spec && state.update(spec).state.doc.toString()).toBe(
      "A\n\nB\n\n| a |\n|---|",
    );
    const top = stateOf("| a |\n|---|\n\nB");
    const first = blockSpanAt(top, 0);
    if (!first) throw new Error("no table");
    expect(canMoveBlock(top, first, -1)).toBe(false);
  });

  test("a block nested in a list doesn't move", () => {
    const doc = "- a\n\n  ```data\n  x: 1\n  ```\n\nB";
    const state = stateOf(doc);
    expect(blockSpanAt(state, doc.indexOf("```"))).toBeUndefined();
  });
});
