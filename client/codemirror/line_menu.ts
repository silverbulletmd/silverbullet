// The line handle's menu: what fits a line, as popup menu entries
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type Line,
} from "@codemirror/state";
import type { Client } from "../client.ts";
import { iconElement } from "../components/chrome_icons.tsx";
import type { PopupEntry } from "../components/popup_menu.ts";
import {
  buttonHint,
  buttonLabel,
  buttonsFor,
  markupButtons,
  markupSurfaces,
  runMarkupButton,
} from "../lib/markup_buttons.ts";
import { MarkupIcon } from "../lib/markup_icons.ts";
import { contextsAt, matchesNodeContexts } from "../lib/node_contexts.ts";
import {
  type SlashMenuEntry,
  slashGroupName,
  sortSlashEntries,
} from "../plugos/hooks/slash_command.ts";
import { addTag, addTagAvailable } from "./add_tag.ts";
import { isCursorInRange } from "./util.ts";
import {
  blockDirectiveAt,
  blockDirectiveOnLine,
} from "./widgets/block_directive.ts";
import { blockActionEntries, joinGroups } from "./widgets/block_menu.ts";
import { deleteBlock, textBlockAt } from "./widgets/block_span.ts";
import type { DirectiveTarget } from "./widgets/directive_at.ts";
import { directiveMenu, directiveMenuCaps } from "./widgets/directive_menu.ts";
import { widgetMenuItem } from "./widgets/widget_menu.ts";

export type LineMenuOptions = {
  /** The custom task states for a task's "Set state", from `fetchTaskStates` */
  taskStates?: string[];
  /** How a picked entry runs, e.g. after moving the cursor; default: just runs */
  onRun?: (run: () => void) => void;
};

/**
 * The start of a line's text: past indentation, quote and list markers and a
 * task box
 */
function lineTextStart(state: EditorState, line: Line): number {
  let pos = line.from;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (
        (node.name === "ListMark" ||
          node.name === "TaskState" ||
          node.name === "QuoteMark") &&
        node.from >= line.from &&
        node.to <= line.to
      ) {
        pos = Math.max(pos, node.to);
      }
    },
  });
  const rest = state.doc.sliceString(pos, line.to);
  return pos + (rest.length - rest.trimStart().length);
}

/**
 * The contexts a line's buttons match: looking forward from the start of its
 * text, so inside a quote's or list item's paragraph, not between its marker
 * and its text
 */
function lineContexts(client: Client, state: EditorState, line: Line) {
  return contextsAt(client, state, lineTextStart(state, line), 1);
}

/**
 * A menu item's icon, at the size the widget menus use; made when its row
 * renders, so building entries touches no DOM
 */
function menuIcon(icon: string | undefined): string | Node {
  if (!icon) return "";
  const node = MarkupIcon({ icon, size: 15 });
  return node ? iconElement(node) : "";
}

/** The labels the "Set state" menu gives the built-in states */
const BUILTIN_TASK_STATES: [state: string, label: string, icon: string][] = [
  [" ", "To do", "square"],
  ["x", "Done", "check-square"],
];

/**
 * The task box on `line`, if it is a task: where its `TaskState` node starts,
 * and the state between its brackets
 */
export function taskStateOn(
  state: EditorState,
  line: Line,
): { from: number; current: string } | undefined {
  let found: { from: number; current: string } | undefined;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name !== "TaskState" || found !== undefined) return;
      if (node.from < line.from || node.to > line.to) return;
      found = {
        from: node.from,
        current: state.doc.sliceString(node.from + 1, node.to - 1),
      };
    },
  });
  return found;
}

/**
 * The "Set state" submenu of the task box `task`: to do, done, then the
 * custom `states` (as `knownTaskStates` lists them) and the box's own state if
 * it is none of those; the current one ticked. Picking one sets it.
 */
function taskStateEntries(
  client: Client,
  task: { from: number; current: string },
  states: string[],
  onRun: (run: () => void) => void,
): PopupEntry[] {
  const { current } = task;
  const isBuiltin = current === " " || current.toLowerCase() === "x";
  const custom =
    isBuiltin || states.includes(current) ? states : [...states, current];
  const all: [string, string, string][] = [
    ...BUILTIN_TASK_STATES,
    ...custom
      .filter((s) => s !== " " && s.toLowerCase() !== "x")
      .map((s): [string, string, string] => [s, s, "circle"]),
  ];
  return all.map(([state, label, icon]) => ({
    kind: "item",
    label,
    icon: () => menuIcon(icon),
    current: state === "x" ? current.toLowerCase() === "x" : state === current,
    run: () =>
      onRun(
        () =>
          void client.clientSystem.system
            .invokeFunction("index.setTaskStateAtPos", [task.from, state])
            .catch(console.error),
      ),
  }));
}

/** The custom task states to offer, from the index; none when it can't say */
export async function fetchTaskStates(client: Client): Promise<string[]> {
  try {
    const states = await client.clientSystem.system.invokeFunction(
      "index.knownTaskStates",
      [],
    );
    return Array.isArray(states) ? states : [];
  } catch {
    return [];
  }
}

/**
 * The handle menu of a line, from the sources `markupSurfaces` switches on:
 * "Add tag" on line 1 of a page without frontmatter, then "Set state" on a
 * task line and the `markupBar.line` buttons whose contexts match at the start
 * of its text, then on a blank line the blocks the slash menu offers there,
 * and last Delete for the line's block of text. Empty when no source is on (so no handle shows). Building it touches no DOM
 * and fetches nothing: cheap enough to ask on every measure whether a line has
 * a menu.
 */
export function lineMenuEntries(
  client: Client,
  state: EditorState,
  line: number,
  options: LineMenuOptions = {},
): PopupEntry[] {
  const { taskStates = [], onRun = (run) => run() } = options;
  const surfaces = markupSurfaces(client, state);
  const out = surfaces.addTag ? addTagEntries(client, state, line, onRun) : [];
  if (!surfaces.line) return out;
  const block = blockDirectiveOnLine(state, line);
  if (block) {
    return block.first
      ? [...out, ...directiveEntries(client, state, block.directive, onRun)]
      : out;
  }
  return joinGroups([
    [
      ...out,
      ...lineButtonEntries(client, state, line, taskStates, onRun),
      ...blankLineBlockEntries(client, state, line, onRun),
    ],
    deleteEntries(client, state, line, onRun),
  ]);
}

/**
 * Delete for the block of text the line is part of (`textBlockAt`), last as a
 * block widget's ⋮ has it; where the page can be edited
 */
function deleteEntries(
  client: Client,
  state: EditorState,
  line: number,
  onRun: (run: () => void) => void,
): PopupEntry[] {
  if (client.isReadOnlyMode() || state.readOnly) return [];
  if (!textBlockAt(state, line)) return [];
  const at = state.doc.line(line).from;
  return [
    {
      ...widgetMenuItem("remove", "Delete"),
      run: () =>
        onRun(() => {
          // Found again when picked: where the line is then
          const view = client.editorView;
          const now = view.state.doc.lineAt(
            Math.min(at, view.state.doc.length),
          );
          const span = textBlockAt(view.state, now.number);
          if (span) view.dispatch(deleteBlock(view.state, span));
          client.focus();
        }),
    },
  ];
}

/**
 * A block `${…}`'s menu, on its first line (its others have none): its own
 * (`directiveMenu`, with Show result while its source is being edited), then
 * Move up / Move down / Delete, as its rendered widget's ⋮ has them
 */
function directiveEntries(
  client: Client,
  state: EditorState,
  directive: DirectiveTarget,
  onRun: (run: () => void) => void,
): PopupEntry[] {
  const editing = isCursorInRange(state, [directive.from, directive.to]);
  const caps = directiveMenuCaps(client, directive, {
    copy: false,
    bake: true,
  });
  const entries = joinGroups<string>([
    directiveMenu(
      client,
      editing ? "editing" : "rendered",
      caps,
      () => directive,
    ),
    caps.edit
      ? blockActionEntries(client, () =>
          blockDirectiveAt(client.editorView.state, directive.from),
        )
      : [],
  ]);
  return entries.map((entry) => {
    const { run } = entry.kind === "item" ? entry : {};
    return run ? { ...entry, run: () => onRun(run) } : entry;
  });
}

/**
 * What the slash menu offers on blank `line` (as if `/` were typed at the
 * start of its text): the slash command hook's entries, unordered. None on a
 * line with text.
 */
function blankLineBlocks(
  client: Client,
  state: EditorState,
  line: Line,
): SlashMenuEntry[] {
  const hook = client.clientSystem.slashCommandHook;
  if (!hook || line.text.trim() !== "") return [];
  const pos = lineTextStart(state, line);
  return hook.entriesAt(state, pos, pos);
}

/**
 * A blank line's blocks as menu rows: one submenu per slash menu group (a
 * group of one is its entry itself), labelled and ordered as the slash menu's
 * sections, with the group's first icon. Picking an entry runs it as picking
 * it in the slash menu does, with the cursor on the line.
 */
function blankLineBlockEntries(
  client: Client,
  state: EditorState,
  line: number,
  onRun: (run: () => void) => void,
): PopupEntry[] {
  const groups = new Map<string, SlashMenuEntry[]>();
  const blocks = blankLineBlocks(client, state, state.doc.line(line));
  for (const entry of sortSlashEntries(blocks, false)) {
    const name = slashGroupName(entry.group);
    let group = groups.get(name);
    if (!group) {
      group = [];
      groups.set(name, group);
    }
    group.push(entry);
  }
  const item = (entry: SlashMenuEntry): PopupEntry => ({
    kind: "item",
    label: entry.label,
    icon: () => menuIcon(entry.icon),
    run: () => onRun(entry.apply),
  });
  return [...groups].map(([name, entries]) =>
    entries.length === 1
      ? item(entries[0])
      : {
          kind: "submenu",
          label: name,
          icon: () => menuIcon(entries.find((e) => e.icon)?.icon),
          entries: entries.map(item),
        },
  );
}

function addTagEntries(
  client: Client,
  state: EditorState,
  line: number,
  onRun: (run: () => void) => void,
): PopupEntry[] {
  if (line !== 1 || !addTagAvailable(client, state)) return [];
  return [
    {
      kind: "item",
      label: "Add tag",
      icon: () => menuIcon("tag"),
      run: () => onRun(() => addTag(client.editorView, client)),
    },
  ];
}

/**
 * "Set state" on a task line, then the line menu buttons. Buttons sharing a
 * `group` make one submenu row, where the first of them is; a button whose
 * `activeContexts` match is ticked.
 */
function lineButtonEntries(
  client: Client,
  state: EditorState,
  line: number,
  taskStates: string[],
  onRun: (run: () => void) => void,
): PopupEntry[] {
  const entries: PopupEntry[] = [];
  const target = state.doc.line(line);
  const nodes = lineContexts(client, state, target);
  const task = nodes.includes("Task") ? taskStateOn(state, target) : undefined;
  if (task) {
    entries.push({
      kind: "submenu",
      label: "Set state",
      icon: () => menuIcon("check-square"),
      entries: taskStateEntries(client, task, taskStates, onRun),
    });
  }
  const groups = new Map<string, PopupEntry[]>();
  for (const button of buttonsFor(markupButtons(client, "line"), nodes)) {
    const entry: PopupEntry = {
      kind: "item",
      label: buttonLabel(button),
      icon: () => menuIcon(button.icon),
      hint: buttonHint(client, button),
      current:
        !!button.activeContexts &&
        matchesNodeContexts({ onlyContexts: button.activeContexts }, nodes),
      run: () => onRun(() => runMarkupButton(client, button)),
    };
    if (!button.group) {
      entries.push(entry);
      continue;
    }
    let group = groups.get(button.group);
    if (!group) {
      group = [];
      groups.set(button.group, group);
      entries.push({
        kind: "submenu",
        label: button.group,
        icon: () => menuIcon(button.icon),
        entries: group,
      });
    }
    group.push(entry);
  }
  return entries;
}

/**
 * The selection to set before running a picked entry: none (leave it) when the
 * main selection touches the line, so a multi-line selection is acted on as a
 * whole; else a cursor at the start of the line's text.
 */
export function selectionForPick(
  state: EditorState,
  line: number,
): EditorSelection | undefined {
  const target = state.doc.line(line);
  const { from, to } = state.selection.main;
  if (from <= target.to && to >= target.from) return;
  return EditorSelection.single(lineTextStart(state, target));
}
